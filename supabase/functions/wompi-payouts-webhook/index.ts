import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function valueAtPath(root: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, root);
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405 });
  const event = await request.json().catch(() => null);
  if (!event?.signature?.properties || event?.timestamp == null) return Response.json({ error: "Evento inválido" }, { status: 400 });
  const secret = Deno.env.get("WOMPI_PAYOUT_EVENT_SECRET");
  if (!secret) return Response.json({ error: "Webhook no configurado" }, { status: 503 });
  const data = event.data ?? {};
  const values = event.signature.properties.map((path: string) => valueAtPath(data, path));
  if (values.some((value: unknown) => value === undefined || value === null)) return Response.json({ error: "Firma incompleta" }, { status: 400 });
  const expected = await sha256(`${values.map((value: unknown) => String(value)).join("")}${event.timestamp}${secret}`);
  const supplied = request.headers.get("X-Event-Checksum") ?? event.signature.checksum ?? "";
  if (!equal(expected, supplied.toLowerCase())) return Response.json({ error: "Firma inválida" }, { status: 401 });

  let reference: string | null = null, payoutId: string | null = null, transactionId: string | null = null, amount: number | null = null, status: string | null = null, failure: string | null = null;
  if (event.event === "transaction.updated") {
    const trx = data.transaction ?? {};
    reference = trx.reference ?? null; payoutId = trx.payoutId ?? null; transactionId = trx.id ?? null; amount = Number(trx.amountInCents ?? trx.amount_in_cents); status = trx.status; failure = typeof trx.failureReason === 'object' ? trx.failureReason?.message : trx.failureReason ?? trx.statusMessage ?? null;
  } else if (event.event === "payout.updated") {
    const payout = data.payout ?? {};
    reference = payout.reference ?? null; payoutId = payout.id ?? null; amount = Number(payout.amountInCents ?? payout.amount_in_cents); status = payout.status;
    if (["REJECTED", "NOT_APPROVED", "CANCELLED"].includes(status)) status = "FAILED";
  } else return Response.json({ received: true, ignored: true });

  if (!Number.isFinite(amount) || !status || (!reference && !payoutId)) return Response.json({ error: "Faltan datos del pago" }, { status: 400 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await supabase.rpc("apply_wompi_payout_event", { p_reference: reference, p_provider_payout_id: payoutId, p_provider_transaction_id: transactionId, p_amount_in_cents: amount, p_status: status, p_failure_reason: failure });
  if (error) return Response.json({ error: "No se pudo aplicar el evento", detail: error.message }, { status: 500 });
  return Response.json({ received: true });
});
