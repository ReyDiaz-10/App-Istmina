import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const getProperty = (root: unknown, path: string) =>
  path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);

const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
};

serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const eventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const environment = Deno.env.get("WOMPI_ENVIRONMENT");
    if (
      !eventsSecret || !supabaseUrl || !serviceRoleKey ||
      (environment !== "sandbox" && environment !== "production")
    ) {
      console.error("Wompi webhook secrets are not configured");
      return new Response("Webhook is not configured", { status: 503 });
    }

    const event = await request.json();
    const properties = event?.signature?.properties;
    const data = event?.data;
    const timestamp = event?.timestamp;
    const checksum = event?.signature?.checksum;

    if (!Array.isArray(properties) || properties.length === 0 ||
        typeof timestamp !== "number" || typeof checksum !== "string" || !data) {
      return new Response("Invalid Wompi event", { status: 400 });
    }

    const values: string[] = [];
    for (const property of properties) {
      if (typeof property !== "string") {
        return new Response("Invalid Wompi signature properties", { status: 400 });
      }
      const value = getProperty(data, property);
      if (value === undefined || value === null) {
        return new Response("Incomplete Wompi event", { status: 400 });
      }
      values.push(String(value));
    }

    const signedValue = `${values.join("")}${timestamp}${eventsSecret}`;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(signedValue),
    );
    const computedChecksum = hex(digest).toUpperCase();
    const headerChecksum = request.headers.get("X-Event-Checksum");
    if (
      !timingSafeEqual(computedChecksum, checksum.toUpperCase()) ||
      (headerChecksum && !timingSafeEqual(computedChecksum, headerChecksum.toUpperCase()))
    ) {
      return new Response("Invalid Wompi signature", { status: 401 });
    }

    if (
      (environment === "sandbox" && event.environment !== "test") ||
      (environment === "production" && event.environment !== "prod")
    ) {
      return new Response("Wompi environment mismatch", { status: 401 });
    }

    if (event.event !== "transaction.updated" && event.event !== "refund.updated") {
      return new Response("Event ignored", { status: 200 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const processQueuedRefund = async (transactionId: string) => {
      const { data: claim, error: claimError } = await supabase.rpc("claim_order_refund", {
        p_transaction_id: transactionId,
      });
      if (claimError) return claimError.message;
      if (!claim) return null;

      const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY");
      const recordSubmission = async (
        status: "pending" | "uncertain" | "error",
        refundId: string | null,
        message: string | null,
      ) => {
        const { error } = await supabase.rpc("record_order_refund_submission", {
          p_transaction_id: transactionId,
          p_wompi_refund_id: refundId,
          p_status: status,
          p_status_message: message,
        });
        return error?.message ?? null;
      };

      if (!wompiPrivateKey) {
        return await recordSubmission("error", null, "WOMPI_PRIVATE_KEY is not configured");
      }
      if (
        (environment === "sandbox" && !wompiPrivateKey.startsWith("prv_test_")) ||
        (environment === "production" && !wompiPrivateKey.startsWith("prv_prod_"))
      ) {
        return await recordSubmission("error", null, "Wompi key does not match the selected environment");
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
        return await recordSubmission(
          "uncertain",
          null,
          error instanceof Error ? error.message : "Network failure contacting Wompi",
        );
      }

      let responseBody: Record<string, unknown>;
      try {
        const parsedBody: unknown = await response.json();
        responseBody = typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)
          ? parsedBody as Record<string, unknown>
          : {};
      } catch {
        return await recordSubmission("uncertain", null, "Could not parse Wompi response; reconcile before retrying");
      }
      const refund = typeof responseBody.data === "object" && responseBody.data !== null
        && !Array.isArray(responseBody.data)
        ? responseBody.data as Record<string, unknown>
        : null;
      const refundId = typeof refund?.id === "string" || typeof refund?.id === "number"
        ? String(refund.id)
        : null;
      if (!response.ok || !refund || !refundId || !Number.isSafeInteger(refund.amount_in_cents)
          || typeof refund.status !== "string") {
        const message = typeof responseBody.error === "object" && responseBody.error !== null
          && typeof (responseBody.error as Record<string, unknown>).message === "string"
          ? String((responseBody.error as Record<string, unknown>).message)
          : `Wompi returned HTTP ${response.status}`;
        return await recordSubmission(
          response.ok || response.status >= 500 ? "uncertain" : "error",
          refundId,
          message,
        );
      }
      const statusMessage = typeof refund.status_message === "string" ? refund.status_message : null;
      if (refund.status === "PENDING") {
        return await recordSubmission("pending", refundId, statusMessage);
      }
      const { error } = await supabase.rpc("apply_wompi_refund_event", {
        p_transaction_id: transactionId,
        p_wompi_refund_id: refundId,
        p_amount_in_cents: Number(refund.amount_in_cents),
        p_status: refund.status,
        p_status_message: statusMessage,
      });
      return error?.message ?? null;
    };

    if (event.event === "refund.updated") {
      const refund = data.refund;
      if (
        typeof refund?.transaction_id !== "string" ||
        typeof refund?.id !== "string" && typeof refund?.id !== "number" ||
        !Number.isSafeInteger(refund?.amount_in_cents) ||
        typeof refund?.status !== "string"
      ) {
        return new Response("Invalid Wompi refund", { status: 400 });
      }
      const { error } = await supabase.rpc("apply_wompi_refund_event", {
        p_transaction_id: refund.transaction_id,
        p_wompi_refund_id: String(refund.id),
        p_amount_in_cents: refund.amount_in_cents,
        p_status: refund.status,
        p_status_message: typeof refund.status_message === "string" ? refund.status_message : null,
      });
      if (error) {
        console.error("Wompi refund could not be applied:", error.message);
        return new Response("Could not apply Wompi refund", { status: 500 });
      }
      return new Response("OK", { status: 200 });
    }

    const transaction = data.transaction;
    if (
      typeof transaction?.id !== "string" ||
      typeof transaction?.payment_link_id !== "string" ||
      !Number.isSafeInteger(transaction?.amount_in_cents) ||
      typeof transaction?.currency !== "string" ||
      typeof transaction?.status !== "string"
    ) {
      return new Response("Invalid Wompi transaction", { status: 400 });
    }

    const { error } = await supabase.rpc("apply_wompi_payment", {
      p_transaction_id: transaction.id,
      p_payment_link_id: transaction.payment_link_id,
      p_amount_in_cents: transaction.amount_in_cents,
      p_currency: transaction.currency,
      p_status: transaction.status,
    });

    if (error) {
      console.error("Wompi payment could not be applied:", error.message);
      return new Response("Could not apply Wompi payment", { status: 500 });
    }

    const refundError = await processQueuedRefund(transaction.id);
    if (refundError) {
      console.error("Queued Wompi refund could not be submitted:", refundError);
      return new Response("Could not submit queued Wompi refund", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Wompi webhook error:", error);
    return new Response("Invalid webhook request", { status: 400 });
  }
});
