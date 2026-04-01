import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
}

interface CategoryNode {
  id: string
  name: string
  parent_id: string | null
  is_leaf: boolean
  depth: number
  path_from_root: Array<{ id: string; name: string }>
  site_id: string
  total_items_in_this_category: number
  updated_at: string
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9",
          "Referer": "https://www.mercadolivre.com.br/",
          "Origin": "https://www.mercadolivre.com.br",
        },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status === 429) {
        const wait = Math.min(2000 * attempt, 10000)
        console.log(`[MLB Sync] Rate limited on ${url}, waiting ${wait}ms...`)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`)
      }
      return await res.json()
    } catch (err) {
      console.warn(`[MLB Sync] Attempt ${attempt}/${retries} failed for ${url}:`, String(err))
      if (attempt === retries) throw err
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

// Limited concurrency helper
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

async function fetchCategoryTree(
  categoryId: string,
  parentId: string | null,
  depth: number,
  pathFromRoot: Array<{ id: string; name: string }>
): Promise<CategoryNode[]> {
  const result: CategoryNode[] = []

  try {
    const data = await fetchWithRetry(`https://api.mercadolibre.com/categories/${categoryId}`)
    if (!data?.id) return result

    const currentPath = [...pathFromRoot, { id: data.id, name: data.name }]
    const children = data.children_categories || []
    const isLeaf = children.length === 0

    result.push({
      id: data.id,
      name: data.name,
      parent_id: parentId,
      is_leaf: isLeaf,
      depth,
      path_from_root: currentPath,
      site_id: "MLB",
      total_items_in_this_category: data.total_items_in_this_category || 0,
      updated_at: new Date().toISOString(),
    })

    if (children.length > 0) {
      // Fetch children with limited concurrency
      const childResults = await mapWithConcurrency(
        children,
        (child: any) => fetchCategoryTree(child.id, data.id, depth + 1, currentPath),
        3
      )
      for (const childNodes of childResults) {
        result.push(...childNodes)
      }
    }
  } catch (err) {
    console.error(`[MLB Sync] Error fetching category ${categoryId}:`, err)
  }

  return result
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: syncLog } = await supabase
    .from("mlb_sync_logs")
    .insert({ status: "running", started_at: new Date().toISOString() })
    .select()
    .single()

  const startTime = Date.now()

  try {
    console.log("[MLB Sync] Fetching root categories...")

    // Step 1: Get root categories list
    const rootList = await fetchWithRetry("https://api.mercadolibre.com/sites/MLB/categories")
    if (!Array.isArray(rootList) || rootList.length === 0) {
      throw new Error("No root categories returned from ML API")
    }

    console.log(`[MLB Sync] Found ${rootList.length} root categories. Fetching hierarchy...`)

    // Step 2: Fetch full tree for each root category with limited concurrency
    const allCategories: CategoryNode[] = []

    const rootResults = await mapWithConcurrency(
      rootList,
      (root: any) => {
        console.log(`[MLB Sync] Fetching tree for: ${root.name} (${root.id})`)
        return fetchCategoryTree(root.id, null, 0, [])
      },
      5 // max 5 concurrent root-level fetches
    )

    for (const rootNodes of rootResults) {
      allCategories.push(...rootNodes)
    }

    console.log(`[MLB Sync] ${allCategories.length} categories fetched. Upserting...`)

    // Step 3: Sort by depth so parent_id references exist before children
    allCategories.sort((a, b) => a.depth - b.depth)

    // Step 4: Upsert in chunks
    const CHUNK_SIZE = 500
    let totalUpserted = 0

    for (let i = 0; i < allCategories.length; i += CHUNK_SIZE) {
      const chunk = allCategories.slice(i, i + CHUNK_SIZE)
      const { error } = await supabase
        .from("mlb_categories")
        .upsert(chunk, { onConflict: "id", ignoreDuplicates: false })

      if (error) {
        console.error(`[MLB Sync] Upsert error at chunk ${i}-${i + CHUNK_SIZE}:`, error)
        throw error
      }
      totalUpserted += chunk.length
      console.log(`[MLB Sync] Chunk ${Math.ceil(i / CHUNK_SIZE) + 1}: ${totalUpserted}/${allCategories.length}`)
    }

    const durationSeconds = (Date.now() - startTime) / 1000

    if (syncLog) {
      await supabase.from("mlb_sync_logs").update({
        status: "success",
        finished_at: new Date().toISOString(),
        total_processed: allCategories.length,
        total_upserted: totalUpserted,
        duration_seconds: durationSeconds,
      }).eq("id", syncLog.id)
    }

    console.log(`[MLB Sync] ✅ Done in ${durationSeconds}s — ${totalUpserted} categories`)

    return new Response(JSON.stringify({
      success: true,
      total_processed: allCategories.length,
      total_upserted: totalUpserted,
      duration_seconds: durationSeconds,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })

  } catch (err) {
    const durationSeconds = (Date.now() - startTime) / 1000
    const errorMsg = String(err)

    if (syncLog) {
      await supabase.from("mlb_sync_logs").update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: errorMsg,
        duration_seconds: durationSeconds,
      }).eq("id", syncLog.id)
    }

    console.error("[MLB Sync] ❌ Error:", errorMsg)
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
