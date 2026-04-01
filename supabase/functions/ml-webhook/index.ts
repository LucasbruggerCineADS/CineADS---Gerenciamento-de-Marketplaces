import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.cineads.com.br",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Verifica a assinatura HMAC-SHA256 enviada pelo Mercado Livre
async function verifyMLSignature(
  secret: string,
  xSignature: string,
  xRequestId: string,
  dataId: string | null
): Promise<boolean> {
  try {
    // Formato do manifesto conforme documentação do ML
    const parts: string[] = [];
    if (dataId) parts.push(`id:${dataId}`);
    if (xRequestId) parts.push(`request-id:${xRequestId}`);
    const tsMatch = xSignature.match(/ts=(\d+)/);
    if (tsMatch) parts.push(`ts:${tsMatch[1]}`);

    const manifest = parts.join(";");
    const hashMatch = xSignature.match(/v1=([a-f0-9]+)/);
    if (!hashMatch) return false;
    const receivedHash = hashMatch[1];

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
    const expectedHash = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expectedHash === receivedHash;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const bodyText = await req.text();
    const xSignature = req.headers.get("x-signature") || "";
    const xRequestId = req.headers.get("x-request-id") || "";

    // Verificar assinatura usando a mesma chave secreta do OAuth (ML_CLIENT_SECRET)
    const ML_WEBHOOK_SECRET = Deno.env.get("ML_CLIENT_SECRET");
    if (ML_WEBHOOK_SECRET && xSignature) {
      let dataId: string | null = null;
      try {
        const parsed = JSON.parse(bodyText);
        dataId = parsed?.id ? String(parsed.id) : null;
      } catch { /* ignora parse error aqui */ }

      const valid = await verifyMLSignature(ML_WEBHOOK_SECRET, xSignature, xRequestId, dataId);
      if (!valid) {
        console.warn("ML webhook: assinatura inválida rejeitada");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = JSON.parse(bodyText);
    const { resource, topic, user_id } = body;

    // Validar campos obrigatórios
    if (!topic || !resource || !user_id) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("ML webhook received:", JSON.stringify({ topic, resource, user_id }));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: integrations } = await supabase
      .from("marketplace_integrations")
      .select("id, tenant_id, credentials")
      .eq("marketplace", "Mercado Livre")
      .eq("status", "connected");

    const integration = (integrations || []).find((i: any) => {
      const creds = i.credentials as Record<string, string>;
      return creds?.ml_user_id === String(user_id);
    });

    if (!integration) {
      console.warn("No integration found for ML user_id:", user_id);
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenantId = integration.tenant_id;
    let jobType = "";
    let jobPayload: Record<string, unknown> = { topic, user_id };

    switch (topic) {
      case "orders_v2":
      case "orders": {
        const orderId = resource.replace("/orders/", "").trim();
        if (!/^\d+$/.test(orderId)) break;
        jobType = "SYNC_ORDERS";
        jobPayload.orderId = orderId;
        break;
      }
      case "items": {
        const itemId = resource.replace("/items/", "").trim();
        if (!/^[A-Z0-9]+$/.test(itemId)) break;
        jobType = "SYNC_LISTING";
        jobPayload.itemId = itemId;
        break;
      }
      case "shipments": {
        const shipmentId = resource.replace("/shipments/", "").trim();
        if (!/^\d+$/.test(shipmentId)) break;
        jobType = "SYNC_SHIPMENT";
        jobPayload.shipmentId = shipmentId;
        break;
      }
      case "questions":
        jobType = "SYNC_QUESTIONS";
        break;
      default:
        console.log("Unhandled ML webhook topic:", topic);
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    if (!jobType) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("sync_jobs").insert({
      tenant_id: tenantId,
      marketplace: "Mercado Livre",
      type: jobType,
      priority: topic === "orders_v2" || topic === "orders" ? "HIGH" : "MEDIUM",
      payload: jobPayload,
    });

    await supabase.from("integration_logs").insert({
      tenant_id: tenantId,
      marketplace: "Mercado Livre",
      type: "info",
      message: `Webhook recebido: ${topic}`,
      details: { resource, topic },
    });

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ml-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
