import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", claimsData.claims.sub)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: "Tenant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = profile.tenant_id;

    // Get integration status
    const { data: integration } = await supabase
      .from("marketplace_integrations")
      .select("id, status, credentials, settings, updated_at")
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre")
      .maybeSingle();

    if (!integration) {
      return new Response(
        JSON.stringify({
          connected: false,
          token_valid: false,
          categories_synced: 0,
          active_listings: 0,
          orders_synced: 0,
          last_sync: null,
          recent_errors: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const creds = integration.credentials as Record<string, string> | null;
    const expiresAt = creds?.expires_at ? new Date(creds.expires_at).getTime() : 0;
    const tokenValid = integration.status === "connected" && Date.now() < expiresAt;

    // Count categories synced
    const { count: categoriesCount } = await supabase
      .from("category_mappings")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre");

    // Count active listings
    const { count: listingsCount } = await supabase
      .from("marketplace_listings")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre")
      .eq("status", "active");

    // Count orders
    const { count: ordersCount } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre");

    // Last sync state
    const { data: syncState } = await supabase
      .from("sync_state")
      .select("last_synced_at")
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre")
      .eq("entity", "orders")
      .maybeSingle();

    // Recent errors
    const { count: errorsCount } = await supabase
      .from("integration_logs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre")
      .eq("type", "error")
      .eq("resolved", false);

    return new Response(
      JSON.stringify({
        connected: integration.status === "connected",
        token_valid: tokenValid,
        token_expires_at: creds?.expires_at || null,
        nickname: creds?.ml_nickname || (integration.settings as any)?.nickname || null,
        categories_synced: categoriesCount || 0,
        active_listings: listingsCount || 0,
        orders_synced: ordersCount || 0,
        last_sync: syncState?.last_synced_at || null,
        recent_errors: errorsCount || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ml-status error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
