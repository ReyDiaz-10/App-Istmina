import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const secret = Deno.env.get("PAYOUT_CRON_SECRET") ?? "";
const safeEqual = (a: string, b: string) => {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aa.length; i++) mismatch |= aa[i] ^ bb[i];
  return mismatch === 0;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "MÃ©todo no permitido" }, 405);
  if (!secret || !safeEqual(request.headers.get("x-payout-cron-secret") ?? "", secret)) return json({ error: "No autorizado" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("WOMPI_PAYOUT_API_KEY"), principalId = Deno.env.get("WOMPI_PAYOUT_PRINCIPAL_ID"), accountId = Deno.env.get("WOMPI_PAYOUT_ACCOUNT_ID");
  if (!apiKey || !principalId || !accountId) return json({ error: "Falta configuraciÃ³n de Wompi Pagos a Terceros" }, 503);
  const base = Deno.env.get("WOMPI_PAYOUT_ENV") === "production" ? "https://api.payouts.wompi.co/v1" : "https://api.sandbox.payouts.wompi.co/v1";
  const results = [];
  // Reconcile accepted batches from previous days first; never resubmit an uncertain transfer after the provider's 24h idempotency window.
  const { data: pending, error: pendingError } = await supabase.from("payout_transactions")
    .select("reference,provider_payout_id,amount_cop,created_at,status")
    .in("status", ["pending", "processing", "needs_review"])
    .not("provider_payout_id", "is", null)
    .limit(100);
  if (pendingError) return json({ error: "No fue posible consultar retiros previos", detail: pendingError.message }, 500);
  for (const payout of pending ?? []) {
    try {
      const response = await fetch(`${base}/transactions/${encodeURIComponent(payout.reference)}?limit=1`, { headers: { "x-api-key": apiKey, "user-principal-id": principalId } });
      if (!response.ok) continue;
      const body = await response.json().catch(() => ({}));
      const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.data) ? body.data.data : [];
      const provider = rows.find((row: Record<string, unknown>) => row.reference === payout.reference) ?? (rows.length === 1 ? rows[0] : null);
      if (!provider) continue;
      const status = provider.status;
      if (!["APPROVED", "FAILED", "CANCELLED", "PENDING", "PROCESSING", "REJECTED"].includes(status)) continue;
      const normalized = status === "REJECTED" ? "FAILED" : status;
      const { error } = await supabase.rpc("apply_wompi_payout_event", { p_reference: payout.reference, p_provider_payout_id: payout.provider_payout_id, p_provider_transaction_id: provider.id ?? null, p_amount_in_cents: Math.round(Number(payout.amount_cop) * 100), p_status: normalized, p_failure_reason: provider.failureReason?.message ?? provider.failureReason ?? null });
      if (error) await supabase.rpc("set_payout_needs_review", { p_reference: payout.reference, p_reason: error.message });
    } catch { /* Webhook or next reconciliation will resolve temporary errors. */ }
  }

  const { data: payouts, error } = await supabase.rpc("claim_due_driver_payouts");
  if (error) return json({ error: "No fue posible reservar retiros", detail: error.message }, 500);
  for (const payout of payouts ?? []) {
    const amount = Math.round(Number(payout.amount_cop) * 100);
    const key = `istmiya-${payout.reference}`.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 64);
    const payload = { reference: payout.reference, accountId, paymentType: Deno.env.get("WOMPI_PAYOUT_PAYMENT_TYPE") ?? "OTHER", transactions: [{ legalIdType: payout.legal_id_type, legalId: payout.legal_id, bankId: payout.bank_id, accountType: payout.account_type, accountNumber: payout.account_number, name: payout.full_name, email: payout.email, amount, reference: payout.reference }] };
    try {
      const response = await fetch(`${base}/payouts`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "user-principal-id": principalId, "Idempotency-Key": key }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const providerId = body.data?.id ?? body.id ?? null;
        const { error: updateError } = await supabase.rpc("mark_payout_submission", { p_reference: payout.reference, p_provider_payout_id: providerId, p_status: "pending", p_failure_reason: null });
        if (updateError) throw updateError;
        const currentStatus = body.data?.status ?? body.status;
        if (["TOTAL_PAYMENT", "PARTIAL_PAYMENT", "REJECTED", "NOT_APPROVED", "CANCELLED", "PENDING"].includes(currentStatus)) {
          const normalized = ["REJECTED", "NOT_APPROVED", "CANCELLED"].includes(currentStatus) ? "FAILED" : currentStatus;
          const { error: eventError } = await supabase.rpc("apply_wompi_payout_event", { p_reference: payout.reference, p_provider_payout_id: providerId, p_provider_transaction_id: null, p_amount_in_cents: amount, p_status: normalized, p_failure_reason: null });
          if (eventError) await supabase.rpc("set_payout_needs_review", { p_reference: payout.reference, p_reason: eventError.message });
        }
        results.push({ reference: payout.reference, status: "pending", provider_id: providerId });
      } else {
        const reason = JSON.stringify(body).slice(0, 450);
        const { error: updateError } = await supabase.rpc("apply_wompi_payout_event", { p_reference: payout.reference, p_provider_payout_id: null, p_provider_transaction_id: null, p_amount_in_cents: amount, p_status: "FAILED", p_failure_reason: reason });
        if (updateError) throw updateError;
        results.push({ reference: payout.reference, status: "failed" });
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Error de red";
      await supabase.rpc("set_payout_needs_review", { p_reference: payout.reference, p_reason: reason });
      results.push({ reference: payout.reference, status: "needs_review" });
    }
  }
  return json({ processed: results.length, results });
});
