import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY");
    const environment = Deno.env.get("WOMPI_ENVIRONMENT");
    const authorization = request.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return jsonResponse({ error: "Cancellation service is not configured" }, 503);
    }
    if (environment !== "sandbox" && environment !== "production") {
      return jsonResponse({ error: "WOMPI_ENVIRONMENT must be sandbox or production" }, 503);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Authentication required" }, 401);

    const body = await request.json();
    if (
      typeof body.orderId !== "string" ||
      (
        body.action !== "client_cancel" &&
        body.action !== "business_reject" &&
        body.action !== "business_stock_out" &&
        body.action !== "business_delivery_failed"
      )
    ) {
      return jsonResponse({ error: "A valid orderId and action are required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: cancellation, error: cancelError } = await admin.rpc("request_order_cancellation", {
      p_order_id: body.orderId,
      p_actor_id: user.id,
      p_action: body.action,
    });
    if (cancelError) {
      return jsonResponse({ error: cancelError.message }, 400);
    }

    const { data: refunds, error: refundsError } = await admin
      .from("order_refunds")
      .select("transaction_id, status")
      .eq("order_id", body.orderId)
      .in("status", ["requested", "pending", "uncertain", "submitting", "error"]);
    if (refundsError) throw refundsError;

    const refundResults: Array<{ transaction_id: string; status: string }> = [];
    for (const refund of refunds || []) {
      if (refund.status !== "requested") {
        refundResults.push({ transaction_id: refund.transaction_id, status: refund.status });
        continue;
      }

      const { data: claim, error: claimError } = await admin.rpc("claim_order_refund", {
        p_transaction_id: refund.transaction_id,
      });
      if (claimError) throw claimError;
      if (!claim) continue;

      if (!wompiPrivateKey) {
        const { error } = await admin.rpc("record_order_refund_submission", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: null,
          p_status: "error",
          p_status_message: "WOMPI_PRIVATE_KEY is not configured",
        });
        if (error) throw error;
        refundResults.push({ transaction_id: refund.transaction_id, status: "error" });
        continue;
      }
      if (
        (environment === "sandbox" && !wompiPrivateKey.startsWith("prv_test_")) ||
        (environment === "production" && !wompiPrivateKey.startsWith("prv_prod_"))
      ) {
        const { error } = await admin.rpc("record_order_refund_submission", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: null,
          p_status: "error",
          p_status_message: "Wompi key does not match the selected environment",
        });
        if (error) throw error;
        refundResults.push({ transaction_id: refund.transaction_id, status: "error" });
        continue;
      }

      const baseUrl = environment === "production"
        ? "https://production.wompi.co/v1"
        : "https://sandbox.wompi.co/v1";
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/refunds`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${wompiPrivateKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transaction_id: claim.transaction_id,
            amount_in_cents: claim.amount_in_cents,
            references: [`ORDER-${String(claim.order_id).slice(0, 30)}`],
          }),
        });
      } catch (error) {
        const { error: recordError } = await admin.rpc("record_order_refund_submission", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: null,
          p_status: "uncertain",
          p_status_message: error instanceof Error ? error.message : "Network failure contacting Wompi",
        });
        if (recordError) throw recordError;
        refundResults.push({ transaction_id: refund.transaction_id, status: "uncertain" });
        continue;
      }

      let responseBody: Record<string, unknown>;
      try {
        const parsedBody: unknown = await response.json();
        responseBody = isRecord(parsedBody) ? parsedBody : {};
      } catch {
        const { error } = await admin.rpc("record_order_refund_submission", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: null,
          p_status: "uncertain",
          p_status_message: "Could not parse Wompi response; reconcile before retrying",
        });
        if (error) throw error;
        refundResults.push({ transaction_id: refund.transaction_id, status: "uncertain" });
        continue;
      }
      const wompiRefund = isRecord(responseBody.data) ? responseBody.data : null;
      if (
        !response.ok ||
        !wompiRefund ||
        (typeof wompiRefund.id !== "string" && typeof wompiRefund.id !== "number") ||
        !Number.isSafeInteger(wompiRefund.amount_in_cents) ||
        typeof wompiRefund.status !== "string"
      ) {
        const { error: recordError } = await admin.rpc("record_order_refund_submission", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: wompiRefund?.id == null ? null : String(wompiRefund.id),
          p_status: response.ok || response.status >= 500 ? "uncertain" : "error",
          p_status_message: isRecord(responseBody.error) && typeof responseBody.error.message === "string"
            ? responseBody.error.message
            : `Wompi returned HTTP ${response.status}`,
        });
        if (recordError) throw recordError;
        refundResults.push({
          transaction_id: refund.transaction_id,
          status: response.ok || response.status >= 500 ? "uncertain" : "error",
        });
        continue;
      }

      if (wompiRefund.status === "PENDING") {
        const { error } = await admin.rpc("record_order_refund_submission", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: String(wompiRefund.id),
          p_status: "pending",
          p_status_message: typeof wompiRefund.status_message === "string" ? wompiRefund.status_message : null,
        });
        if (error) throw error;
        refundResults.push({ transaction_id: refund.transaction_id, status: "pending" });
      } else {
        const { error } = await admin.rpc("apply_wompi_refund_event", {
          p_transaction_id: refund.transaction_id,
          p_wompi_refund_id: String(wompiRefund.id),
          p_amount_in_cents: Number(wompiRefund.amount_in_cents),
          p_status: wompiRefund.status,
          p_status_message: typeof wompiRefund.status_message === "string" ? wompiRefund.status_message : null,
        });
        if (error) throw error;
        refundResults.push({ transaction_id: refund.transaction_id, status: String(wompiRefund.status).toLowerCase() });
      }
    }

    return jsonResponse({ ...cancellation, refunds: refundResults });
  } catch (error) {
    console.error("Could not cancel order or process refund:", error);
    return jsonResponse({ error: "Could not complete the order cancellation request" }, 500);
  }
});
