import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate the user's JWT using the anon client
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;

    const { code, tenantId } = await req.json();

    if (!code || !tenantId) {
      return new Response(
        JSON.stringify({ error: "Missing code or tenantId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!UUID_REGEX.test(tenantId)) {
      return new Response(
        JSON.stringify({ error: "Invalid tenantId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ML_CLIENT_ID = Deno.env.get("ML_CLIENT_ID");
    const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET");
    const ML_REDIRECT_URI = "https://cineads.lovable.app/auth/mercadolivre/callback";

    if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
      console.error("Missing ML env vars:", { ML_CLIENT_ID: !!ML_CLIENT_ID, ML_CLIENT_SECRET: !!ML_CLIENT_SECRET });
      return new Response(
        JSON.stringify({ error: "Server configuration incomplete" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user belongs to the tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();

    if (!profile?.tenant_id || profile.tenant_id !== tenantId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized tenant access" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("ML OAuth: exchanging code for token", { tenantId, userId, redirectUri: ML_REDIRECT_URI });

    const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ML_CLIENT_ID,
        client_secret: ML_CLIENT_SECRET,
        code,
        redirect_uri: ML_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("Token exchange failed:", JSON.stringify(tokenData));
      return new Response(
        JSON.stringify({ error: "Token exchange failed", details: tokenData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userRes = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const mlUser = await userRes.json();

    if (!userRes.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch Mercado Livre user", details: mlUser }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: dbError } = await supabase
      .from("marketplace_integrations")
      .upsert(
        {
          tenant_id: tenantId,
          marketplace: "Mercado Livre",
          status: "connected",
          credentials: {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(
              Date.now() + tokenData.expires_in * 1000
            ).toISOString(),
            ml_user_id: String(tokenData.user_id),
            ml_nickname: mlUser.nickname || "",
            ml_email: mlUser.email || "",
          },
          settings: {
            ml_user_id: String(tokenData.user_id),
            nickname: mlUser.nickname || "",
            site_id: mlUser.site_id || "MLB",
            auto_sync: false,
          },
        },
        { onConflict: "tenant_id,marketplace" }
      );

    if (dbError) {
      console.error("DB save error:", JSON.stringify(dbError));
      return new Response(
        JSON.stringify({ error: "DB save failed", details: dbError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("integration_logs").insert({
      tenant_id: tenantId,
      marketplace: "Mercado Livre",
      type: "success",
      message: `Conta ${mlUser.nickname || "desconhecida"} conectada com sucesso`,
    });

    console.log("ML OAuth success", { tenantId, userId, nickname: mlUser.nickname });

    return new Response(
      JSON.stringify({ success: true, nickname: mlUser.nickname || "" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ML OAuth failure", { error: String(err) });
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
