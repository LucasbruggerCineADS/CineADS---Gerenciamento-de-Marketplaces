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

async function fetchML(url: string, accessToken: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10000)))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return await res.json()
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

async function mapWithConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = []
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function fetchCategoryTree(
  categoryId: string, parentId: string | null, depth: number,
  pathFromRoot: Array<{ id: string; name: string }>, accessToken: string
): Promise<CategoryNode[]> {
  const result: CategoryNode[] = []
  try {
    const data = await fetchML(`https://api.mercadolibre.com/categories/${categoryId}`, accessToken)
    if (!data?.id) return result
    const currentPath = [...pathFromRoot, { id: data.id, name: data.name }]
    const children = data.children_categories || []
    result.push({
      id: data.id, name: data.name, parent_id: parentId,
      is_leaf: children.length === 0, depth,
      path_from_root: currentPath, site_id: "MLB",
      total_items_in_this_category: data.total_items_in_this_category || 0,
      updated_at: new Date().toISOString(),
    })
    if (children.length > 0) {
      const childResults = await mapWithConcurrency(
        children,
        (child: any) => fetchCategoryTree(child.id, data.id, depth + 1, currentPath, accessToken),
        3
      )
      for (const nodes of childResults) result.push(...nodes)
    }
  } catch (err) {
    console.error(`[MLB Sync] Error fetching ${categoryId}:`, err)
  }
  return result
}

async function runSync(supabase: any, accessToken: string, syncLogId: string | undefined) {
  const startTime = Date.now()
  try {
    const rootList = await fetchML("https://api.mercadolibre.com/sites/MLB/categories", accessToken)
    if (!Array.isArray(rootList) || rootList.length === 0) throw new Error("No root categories from ML API")

    const allCategories: CategoryNode[] = []
    const rootResults = await mapWithConcurrency(
      rootList,
      (root: any) => fetchCategoryTree(root.id, null, 0, [], accessToken),
      5
    )
    for (const nodes of rootResults) allCategories.push(...nodes)

    allCategories.sort((a, b) => a.depth - b.depth)

    const CHUNK = 500
    let totalUpserted = 0
    for (let i = 0; i < allCategories.length; i += CHUNK) {
      const { error } = await supabase.from("mlb_categories")
        .upsert(allCategories.slice(i, i + CHUNK), { onConflict: "id", ignoreDuplicates: false })
      if (error) throw error
      totalUpserted += Math.min(CHUNK, allCategories.length - i)
    }

    const durationSeconds = (Date.now() - startTime) / 1000
    if (syncLogId) {
      await supabase.from("mlb_sync_logs").update({
        status: "success", finished_at: new Date().toISOString(),
        total_processed: allCategories.length, total_upserted: totalUpserted,
        duration_seconds: durationSeconds,
      }).eq("id", syncLogId)
    }
    console.log(`[MLB Sync] ✅ Done in ${durationSeconds}s — ${totalUpserted} categories`)
  } catch (err) {
    const durationSeconds = (Date.now() - startTime) / 1000
    console.error("[MLB Sync] ❌ Error:", String(err))
    if (syncLogId) {
      await supabase.from("mlb_sync_logs").update({
        status: "error", finished_at: new Date().toISOString(),
        error_message: String(err), duration_seconds: durationSeconds,
      }).eq("id", syncLogId)
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: integrations } = await supabase
    .from("marketplace_integrations")
    .select("credentials")
    .eq("marketplace", "Mercado Livre")
    .eq("status", "connected")
    .limit(1)

  const accessToken = (integrations?.[0]?.credentials as any)?.access_token
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Nenhuma integração Mercado Livre conectada. Conecte sua conta em Integrações." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { data: syncLog } = await supabase
    .from("mlb_sync_logs")
    .insert({ status: "running", started_at: new Date().toISOString() })
    .select("id").single()

  // Run sync in background — avoids HTTP timeout on large category trees
  // @ts-ignore EdgeRuntime is available in Deno Deploy / Supabase Edge Functions
  EdgeRuntime.waitUntil(runSync(supabase, accessToken, syncLog?.id))

  return new Response(JSON.stringify({ success: true, message: "Sincronização iniciada em background", sync_id: syncLog?.id }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
