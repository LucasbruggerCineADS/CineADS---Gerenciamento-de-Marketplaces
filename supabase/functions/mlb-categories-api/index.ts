import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  )

  const url = new URL(req.url)
  const action = url.searchParams.get("action")

  try {
    if (action === "roots") {
      const { data, error } = await supabase
        .from("mlb_categories")
        .select("id, name, is_leaf, depth")
        .is("parent_id", null)
        .eq("site_id", "MLB")
        .order("name")
      if (error) throw error
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (action === "children") {
      const id = url.searchParams.get("id")
      const { data, error } = await supabase
        .from("mlb_categories")
        .select("id, name, is_leaf, depth, path_from_root")
        .eq("parent_id", id!)
        .order("name")
      if (error) throw error
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (action === "detail") {
      const id = url.searchParams.get("id")
      const { data, error } = await supabase
        .from("mlb_categories")
        .select("*")
        .eq("id", id!)
        .single()
      if (error) throw error
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (action === "search") {
      const q = url.searchParams.get("q") || ""
      const page = parseInt(url.searchParams.get("page") || "1") - 1
      const limit = parseInt(url.searchParams.get("limit") || "20")

      const { data, count, error } = await supabase
        .from("mlb_categories")
        .select("id, name, is_leaf, depth, path_from_root", { count: "exact" })
        .ilike("name", `%${q}%`)
        .eq("site_id", "MLB")
        .order("depth")
        .order("name")
        .range(page * limit, (page + 1) * limit - 1)
      if (error) throw error

      return new Response(JSON.stringify({ data, total: count, page: page + 1, limit }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (action === "sync-status") {
      const { data, error } = await supabase
        .from("mlb_sync_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(5)
      if (error) throw error
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    if (action === "count") {
      const { count, error } = await supabase
        .from("mlb_categories")
        .select("id", { count: "exact", head: true })
        .eq("site_id", "MLB")
      if (error) throw error
      return new Response(JSON.stringify({ total: count }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    return new Response(JSON.stringify({ error: "action not found" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
