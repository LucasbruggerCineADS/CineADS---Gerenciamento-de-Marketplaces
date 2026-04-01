import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getAccessToken(supabase: any, tenantId: string) {
  const { data, error } = await supabase
    .from("marketplace_integrations")
    .select("id, credentials, status")
    .eq("tenant_id", tenantId)
    .eq("marketplace", "Mercado Livre")
    .single();
  if (error || !data) throw new Error("ML integration not found");
  if (data.status !== "connected") throw new Error("ML not connected");
  const creds = data.credentials as Record<string, string>;
  if (!creds?.access_token) throw new Error("No access token");

  // Check expiry
  const expiresAt = creds.expires_at ? new Date(creds.expires_at).getTime() : 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    // Refresh inline
    const ML_CLIENT_ID = Deno.env.get("ML_CLIENT_ID")!;
    const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET")!;
    const refreshRes = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: creds.refresh_token,
      }),
    });
    const newTokens = await refreshRes.json();
    if (!newTokens.access_token) throw new Error("Token refresh failed");
    await supabase
      .from("marketplace_integrations")
      .update({
        credentials: {
          ...creds,
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        },
        status: "connected",
      })
      .eq("id", data.id);
    return { token: newTokens.access_token, integrationId: data.id, userId: creds.ml_user_id };
  }
  return { token: creds.access_token, integrationId: data.id, userId: creds.ml_user_id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Verificar autenticação
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenantId, action, payload } = await req.json();
    if (!tenantId || !action) {
      return new Response(JSON.stringify({ error: "Missing tenantId or action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 2. Verificar que o usuário pertence ao tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    if (!profile || profile.tenant_id !== tenantId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token, integrationId, userId } = await getAccessToken(supabase, tenantId);
    const mlApi = "https://api.mercadolibre.com";
    let result: any = null;

    switch (action) {
      case "CREATE_LISTING": {
        const res = await fetch(`${mlApi}/items`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload.item),
        });
        result = await res.json();
        if (result.id) {
          await supabase.from("marketplace_listings").upsert({
            tenant_id: tenantId,
            product_id: payload.productId,
            marketplace: "Mercado Livre",
            integration_id: integrationId,
            listing_id: result.id,
            status: result.status === "active" ? "active" : "inactive",
            price: result.price,
            stock: result.available_quantity,
            url: result.permalink,
          }, { onConflict: "tenant_id,product_id,marketplace" });
        }
        break;
      }

      case "UPDATE_PRICE": {
        const res = await fetch(`${mlApi}/items/${payload.listingId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ price: payload.price }),
        });
        result = await res.json();
        if (res.ok) {
          await supabase
            .from("marketplace_listings")
            .update({ price: payload.price })
            .eq("listing_id", payload.listingId)
            .eq("tenant_id", tenantId);
        }
        break;
      }

      case "UPDATE_STOCK": {
        const res = await fetch(`${mlApi}/items/${payload.listingId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ available_quantity: payload.quantity }),
        });
        result = await res.json();
        if (res.ok) {
          await supabase
            .from("marketplace_listings")
            .update({ stock: payload.quantity })
            .eq("listing_id", payload.listingId)
            .eq("tenant_id", tenantId);
        }
        break;
      }

      case "PAUSE_LISTING": {
        const res = await fetch(`${mlApi}/items/${payload.listingId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        });
        result = await res.json();
        if (res.ok) {
          await supabase
            .from("marketplace_listings")
            .update({ status: "paused" })
            .eq("listing_id", payload.listingId)
            .eq("tenant_id", tenantId);
        }
        break;
      }

      case "RESUME_LISTING": {
        const res = await fetch(`${mlApi}/items/${payload.listingId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        });
        result = await res.json();
        if (res.ok) {
          await supabase
            .from("marketplace_listings")
            .update({ status: "active" })
            .eq("listing_id", payload.listingId)
            .eq("tenant_id", tenantId);
        }
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    await supabase.from("integration_logs").insert({
      tenant_id: tenantId,
      marketplace: "Mercado Livre",
      type: result?.error ? "error" : "success",
      message: `${action} ${result?.error ? "failed" : "completed"}`,
      details: { action, result },
    });

    return new Response(JSON.stringify({ success: !result?.error, data: result }), {
      status: result?.error ? 400 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ml-listing-ops error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
