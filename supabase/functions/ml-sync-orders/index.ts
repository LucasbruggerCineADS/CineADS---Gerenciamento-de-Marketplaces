import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STATUS_MAP: Record<string, string> = {
  payment_required: "pending",
  payment_in_process: "pending",
  paid: "paid",
  partially_paid: "paid",
  confirmed: "processing",
  cancelled: "cancelled",
};

async function mlFetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      console.log(`Rate limited, waiting ${60 * (i + 1)}s...`);
      await new Promise((r) => setTimeout(r, 60000 * (i + 1)));
      continue;
    }
    return res;
  }
  throw new Error("Rate limit exceeded after retries");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenantId } = await req.json();

    // 2. Verificar que o usuário pertence ao tenant
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

    const { data: integration } = await supabase
      .from("marketplace_integrations")
      .select("id, credentials, settings")
      .eq("tenant_id", tenantId)
      .eq("marketplace", "Mercado Livre")
      .single();

    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const creds = integration.credentials as Record<string, string>;
    let accessToken = creds.access_token;

    // Auto-refresh se token expirado
    if (creds.expires_at && new Date(creds.expires_at) <= new Date()) {
      console.log("Token expired, refreshing...");
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
      if (!newTokens.access_token) {
        await supabase
          .from("marketplace_integrations")
          .update({ status: "error" })
          .eq("id", integration.id);
        return new Response(
          JSON.stringify({ error: "Token expired and refresh failed" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      accessToken = newTokens.access_token;
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
        .eq("id", integration.id);
    }

    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const ordersRes = await mlFetchWithRetry(
      `https://api.mercadolibre.com/orders/search?seller=${creds.ml_user_id}&sort=date_desc&order.date_created.from=${yesterday}`,
      authHeaders
    );

    if (!ordersRes.ok) {
      const errBody = await ordersRes.text();
      console.error("ML orders API error:", ordersRes.status, errBody);
      return new Response(
        JSON.stringify({ error: "ML API error", status: ordersRes.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ordersData = await ordersRes.json();
    const mlOrders = ordersData.results || [];
    let synced = 0;

    for (const mlOrder of mlOrders) {
      const orderNumber = `ML-${mlOrder.id}`;

      const { data: existing } = await supabase
        .from("orders")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("order_number", orderNumber)
        .maybeSingle();

      if (existing) continue;

      const status = STATUS_MAP[mlOrder.status] || "pending";

      const { data: newOrder } = await supabase
        .from("orders")
        .insert({
          tenant_id: tenantId,
          order_number: orderNumber,
          marketplace: "Mercado Livre",
          status,
          total: mlOrder.total_amount,
          customer: {
            name: `${mlOrder.buyer?.first_name || ""} ${mlOrder.buyer?.last_name || ""}`.trim(),
            ml_id: mlOrder.buyer?.id,
          },
        })
        .select()
        .single();

      if (!newOrder) continue;

      for (const item of mlOrder.order_items || []) {
        await supabase.from("order_items").insert({
          order_id: newOrder.id,
          title: item.item?.title,
          quantity: item.quantity,
          price: item.unit_price,
        });
      }

      await supabase.from("order_timeline").insert({
        order_id: newOrder.id,
        status,
        message: `Pedido importado do Mercado Livre`,
      });

      synced++;
    }

    await supabase.from("integration_logs").insert({
      tenant_id: tenantId,
      marketplace: "Mercado Livre",
      type: "success",
      message: `Sincronização concluída: ${synced} novo(s) pedido(s)`,
      details: { orders_synced: synced, total_found: mlOrders.length },
    });

    return new Response(
      JSON.stringify({ success: true, synced }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ml-sync-orders error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
