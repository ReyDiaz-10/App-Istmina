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

    if (event.event !== "transaction.updated") {
      return new Response("Event ignored", { status: 200 });
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

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Wompi webhook error:", error);
    return new Response("Invalid webhook request", { status: 400 });
  }
});
