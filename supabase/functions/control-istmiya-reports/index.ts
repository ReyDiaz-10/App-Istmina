import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { sendTransactionalEmail } from "../_shared/email.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
  "cache-control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const REPORT_REQUEST_BUDGET_MS = 120_000;
const SUPABASE_FETCH_TIMEOUT_MS = 20_000;
let requestDeadline = 0;

async function fetchWithBudget(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = SUPABASE_FETCH_TIMEOUT_MS) {
  const remainingBudget = requestDeadline ? requestDeadline - Date.now() - 5_000 : timeoutMs;
  if (remainingBudget <= 0) throw new Error("report_time_budget_exhausted");
  const timeoutSignal = AbortSignal.timeout(Math.min(timeoutMs, remainingBudget));
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return await fetch(input, { ...init, signal });
}
const supabaseFetch = (input: RequestInfo | URL, init?: RequestInit) => fetchWithBudget(input, init, SUPABASE_FETCH_TIMEOUT_MS);

type ReportJob = {
  id: string; requested_by: string | null; report_kind: "manual" | "daily"; period_start: string; period_end: string;
  email_requested: boolean; email_to: string | null; attempts: number;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  requestDeadline = Date.now() + REPORT_REQUEST_BUDGET_MS;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_not_configured" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false }, global: { fetch: supabaseFetch } });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = body.action;
  const cronSecret = Deno.env.get("CONTROL_REPORT_CRON_SECRET");
  const isCron = Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
  let adminId: string | null = null;

  if (action === "daily") {
    if (!isCron) return json({ error: "unauthorized" }, 401);
    const { data: jobId, error } = await db.rpc("enqueue_daily_control_report");
    if (error || !jobId) return json({ error: "daily_report_enqueue_failed" }, 500);
    return await processJob(db, jobId);
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!token || !anonKey) return json({ error: "unauthorized" }, 401);
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` }, fetch: supabaseFetch }, auth: { persistSession: false } });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("role,status,account_deactivated_at").eq("id", auth.user.id).maybeSingle();
  if (profileError || !["admin", "superadmin"].includes(profile?.role)
    || profile.status !== "activo" || profile.account_deactivated_at) return json({ error: "admin_required" }, 403);
  adminId = auth.user.id;

  if (action === "download") {
    const jobId = validUuid(body.job_id);
    if (!jobId) return json({ error: "invalid_job_id" }, 400);
    const { data: job, error } = await db.from("admin_control_report_jobs").select("id,pdf_path,status").eq("id", jobId).maybeSingle();
    if (error || !job || job.status !== "ready" || !job.pdf_path) return json({ error: "report_not_available" }, 404);
    const { data: signed, error: signedError } = await db.storage.from("admin-control-reports").createSignedUrl(job.pdf_path, 60 * 60);
    if (signedError || !signed?.signedUrl) return json({ error: "report_link_failed" }, 502);
    return json({ status: "ready", url: signed.signedUrl });
  }

  if (action === "send_email") {
    const jobId = validUuid(body.job_id);
    const recipient = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!jobId || !isValidEmail(recipient)) return json({ error: "invalid_report_email" }, 400);
    const { data: report, error } = await db.from("admin_control_report_jobs")
      .select("id,requested_by,report_kind,period_start,period_end,status,pdf_path,metrics,email_sent_at")
      .eq("id", jobId).maybeSingle();
    if (error || !report) return json({ error: "report_not_found" }, 404);
    if (report.report_kind !== "daily" && report.requested_by !== adminId) return json({ error: "report_not_owned" }, 403);
    if (report.status !== "ready" || !report.pdf_path) return json({ error: "report_not_available" }, 409);
    if (report.email_sent_at) return json({ status: "sent", already_sent: true });
    try {
      const orders = (report.metrics as any)?.current?.orders || {};
      await sendReportEmail(report as ReportJob & { pdf_path: string }, orders, recipient);
      const { error: saveError } = await db.from("admin_control_report_jobs")
        .update({ email_to: recipient, email_sent_at: new Date().toISOString(), email_error: null }).eq("id", jobId);
      if (saveError) throw new Error("report_email_state_save_failed");
      return json({ status: "sent", job_id: jobId });
    } catch (error) {
      const code = error instanceof Error ? error.message : "report_email_failed";
      await db.from("admin_control_report_jobs").update({ email_to: recipient, email_error: code.slice(0, 120) }).eq("id", jobId);
      return json({ status: "ready", job_id: jobId, email_error: code }, 502);
    }
  }

  if (action === "retry_ai") {
    const jobId = validUuid(body.job_id);
    if (!jobId) return json({ error: "invalid_job_id" }, 400);
    const { data: report, error } = await db.from("admin_control_report_jobs")
      .select("id,requested_by,report_kind,period_start,period_end,status,pdf_path,metrics").eq("id", jobId).maybeSingle();
    if (error || !report) return json({ error: "report_not_found" }, 404);
    if (report.report_kind !== "daily" && report.requested_by !== adminId) return json({ error: "report_not_owned" }, 403);
    if (report.status !== "ready" || !report.pdf_path || !report.metrics) return json({ error: "report_not_available" }, 409);
    const { error: pendingError } = await db.from("admin_control_report_jobs")
      .update({ error_code: "gemini_pending" }).eq("id", jobId);
    if (pendingError) return json({ error: "report_ai_retry_state_failed" }, 500);
    scheduleAIEnrichment(report as StoredReportJob);
    return json({ status: "ai_processing", job_id: jobId }, 202);
  }

  if (action !== "process") return json({ error: "unsupported_action" }, 400);
  const jobId = validUuid(body.job_id);
  if (!jobId) return json({ error: "invalid_job_id" }, 400);
  const { data: requested, error: requestError } = await db.from("admin_control_report_jobs").select("requested_by,report_kind").eq("id", jobId).maybeSingle();
  if (requestError || !requested) return json({ error: "report_not_found" }, 404);
  if (requested.report_kind !== "daily" && requested.requested_by !== adminId) return json({ error: "report_not_owned" }, 403);
  return await processJob(db, jobId);
});

async function processJob(db: ReturnType<typeof createClient>, jobId: string) {
  console.info("control_report_stage_started", jobId, "claim");
  const { data: claimed, error: claimError } = await db.rpc("claim_admin_control_report", { p_job_id: jobId });
  const job = (claimed || [])[0] as ReportJob | undefined;
  if (claimError) return json({ error: "report_claim_failed" }, 500);
  if (!job) return json({ status: "processing", job_id: jobId, message: "El informe ya está siendo procesado." }, 202);
  console.info("control_report_stage_completed", job.id, "claim");

  let reportReady = false;
  try {
    console.info("control_report_stage_started", job.id, "metrics_current");
    const currentMetricsStartedAt = Date.now();
    const { data: metrics, error: metricsError } = await db.rpc("admin_control_report_metrics", {
      p_period_start: job.period_start, p_period_end: job.period_end,
    });
    if (metricsError) throw new Error("report_metrics_failed");
    console.info("control_report_stage_completed", job.id, "metrics_current", Date.now() - currentMetricsStartedAt);
    const previous = previousPeriod(job.period_start, job.period_end);
    console.info("control_report_stage_started", job.id, "metrics_previous");
    const previousMetricsStartedAt = Date.now();
    const { data: previousMetrics, error: previousError } = await db.rpc("admin_control_report_metrics", {
      p_period_start: previous.start, p_period_end: previous.end,
    });
    if (previousError) throw new Error("report_comparison_failed");
    console.info("control_report_stage_completed", job.id, "metrics_previous", Date.now() - previousMetricsStartedAt);

    console.info("control_report_stage_started", job.id, "pdf_generation");
    const pdfStartedAt = Date.now();
    const pdf = await createReportPdf(job, metrics, previousMetrics, null, null);
    console.info("control_report_stage_completed", job.id, "pdf_generation", Date.now() - pdfStartedAt, pdf.length);
    const pdfPath = `${job.period_start}/${job.id}.pdf`;
    console.info("control_report_stage_started", job.id, "storage_upload");
    const uploadStartedAt = Date.now();
    const { error: uploadError } = await db.storage.from("admin-control-reports").upload(pdfPath, pdf, {
      contentType: "application/pdf", upsert: true, cacheControl: "3600",
    });
    if (uploadError) throw new Error("report_pdf_upload_failed");
    console.info("control_report_stage_completed", job.id, "storage_upload", Date.now() - uploadStartedAt);

    const update: Record<string, unknown> = {
      status: "ready", metrics: { current: metrics, previous: previousMetrics }, ai_summary: null,
      pdf_path: pdfPath, completed_at: new Date().toISOString(), error_code: "gemini_pending", email_error: null,
    };
    console.info("control_report_stage_started", job.id, "save_pdf_ready");
    const saveStartedAt = Date.now();
    const { error: saveError } = await db.from("admin_control_report_jobs").update(update).eq("id", job.id);
    if (saveError) throw new Error("report_result_save_failed");
    reportReady = true;
    console.info("control_report_stage_completed", job.id, "save_pdf_ready", Date.now() - saveStartedAt);

    await notifyReportReadyInApp(db, job);
    scheduleAIEnrichment({ ...job, pdf_path: pdfPath, metrics: { current: metrics, previous: previousMetrics } });
    if (job.report_kind === "daily" && job.email_requested) scheduleDailyReportEmail(job, metrics, pdfPath);
    console.info("control_report_stage_started", job.id, "signed_url");
    const signed = await db.storage.from("admin-control-reports").createSignedUrl(pdfPath, 60 * 60);
    if (signed.error) console.warn("control_report_signed_url_failed", job.id);
    else console.info("control_report_stage_completed", job.id, "signed_url");
    return json({ status: "ready", job_id: job.id, url: signed.data?.signedUrl || null, ai_pending: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "report_processing_failed";
    if (reportReady) {
      console.error("control_report_post_ready_error", job.id, code);
      return json({ status: "ready", job_id: job.id, url: null, email_error: "report_post_processing_failed" });
    }
    const { error: saveError } = await db.from("admin_control_report_jobs").update({
      status: "error", error_code: code.slice(0, 120), completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (saveError) console.error("control_report_error_state_write_failed", job.id);
    console.error("control_report_processing_failed", job.id, code);
    return json({ status: "error", job_id: job.id, error: code }, 500);
  }
}

async function notifyReportReadyInApp(db: ReturnType<typeof createClient>, job: ReportJob) {
  try {
    let recipients: string[] = [];
    if (job.requested_by) recipients = [job.requested_by];
    else {
      const { data, error } = await db.from("profiles").select("id").in("role", ["admin", "superadmin"]).eq("status", "activo");
      if (error) throw error;
      recipients = (data || []).map((profile: { id: string }) => profile.id);
    }
    if (!recipients.length) return;
    const rows = recipients.map((recipientId) => ({
      recipient_id: recipientId,
      event_key: "control_report_ready",
      title: "Informe Control IstmiYa listo",
      body: "El PDF del periodo solicitado ya está disponible en el panel de Control IstmiYa.",
      idempotency_key: "control-report:" + job.id + ":admin:" + recipientId,
    }));
    const { error } = await db.from("user_notifications").upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw error;
  } catch (error) {
    console.warn("control_report_in_app_notification_failed", job.id, error instanceof Error ? error.message : "unknown");
  }
}

function scheduleBackground(task: Promise<unknown>, name: string) {
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  const safeTask = task.catch((error) => console.error(name, error instanceof Error ? error.message : "unknown"));
  if (runtime?.waitUntil) runtime.waitUntil(safeTask);
  else void safeTask;
}

type StoredReportJob = ReportJob & { pdf_path: string; metrics: { current: any; previous: any } };

function scheduleAIEnrichment(job: StoredReportJob) {
  const backgroundDb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  scheduleBackground((async () => {
    const startedAt = Date.now();
    try {
      const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
      const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
      const model = configuredModel?.replace(/^models\//i, "");
      if (!apiKey || !model) throw new Error(!apiKey ? "gemini_api_key_missing" : "gemini_model_missing");
      if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error("gemini_model_invalid");
      console.info("control_report_stage_started", job.id, "gemini_background");
      const summary = await summarizeWithAI(job.metrics.current, job.metrics.previous, apiKey, model);
      const pdf = await createReportPdf(job, job.metrics.current, job.metrics.previous, summary, null);
      const { error: uploadError } = await backgroundDb.storage.from("admin-control-reports").upload(job.pdf_path, pdf, {
        contentType: "application/pdf", upsert: true, cacheControl: "3600",
      });
      if (uploadError) throw new Error("report_ai_pdf_update_failed");
      const { error } = await backgroundDb.from("admin_control_report_jobs")
        .update({ ai_summary: summary, error_code: null }).eq("id", job.id).eq("status", "ready");
      if (error) throw new Error("report_ai_state_save_failed");
      console.info("control_report_stage_completed", job.id, "gemini_background", Date.now() - startedAt);
    } catch (error) {
      const code = error instanceof Error && (/^gemini_/.test(error.message) || error.message === "report_ai_pdf_update_failed" || error.message === "report_ai_state_save_failed")
        ? error.message : "gemini_request_failed";
      try {
        const fallbackPdf = await createReportPdf(job, job.metrics.current, job.metrics.previous, null, code);
        await backgroundDb.storage.from("admin-control-reports").upload(job.pdf_path, fallbackPdf, {
          contentType: "application/pdf", upsert: true, cacheControl: "3600",
        });
      } catch (fallbackError) {
        console.warn("control_report_fallback_pdf_update_failed", job.id, fallbackError instanceof Error ? fallbackError.message : "unknown");
      }
      await backgroundDb.from("admin_control_report_jobs").update({ error_code: code }).eq("id", job.id).eq("status", "ready");
      console.warn("control_report_stage_failed", job.id, "gemini_background", code, Date.now() - startedAt);
    }
  })(), "control_report_ai_background_failed");
}

function scheduleDailyReportEmail(job: ReportJob, metrics: any, pdfPath: string) {
  const backgroundDb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  scheduleBackground((async () => {
    try {
      await sendReportEmail({ ...job, pdf_path: pdfPath }, metrics?.orders || {}, job.email_to || Deno.env.get("ADMIN_ALERT_EMAIL") || "");
      await backgroundDb.from("admin_control_report_jobs").update({ email_sent_at: new Date().toISOString(), email_error: null }).eq("id", job.id);
    } catch (error) {
      const code = error instanceof Error ? error.message : "report_email_failed";
      await backgroundDb.from("admin_control_report_jobs").update({ email_error: code.slice(0, 120) }).eq("id", job.id);
      console.warn("control_report_stage_failed", job.id, "email_delivery_background", code);
    }
  })(), "control_report_daily_email_background_failed");
}

async function summarizeWithAI(current: unknown, previous: unknown, key: string, model: string): Promise<string> {
  let response: Response;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const requestBody = JSON.stringify({
    systemInstruction: {
      parts: [{ text: "Eres el analista interno de IstmiYa. Redacta en español un resumen ejecutivo para el administrador, destaca cambios relevantes y anomalías a revisar. Los valores ya fueron calculados por PostgreSQL: no recalcules ni inventes cifras. Aclara cuando un dato no está registrado y no llames utilidad a la liquidación neta." }],
    },
    contents: [{
      role: "user",
      parts: [{ text: JSON.stringify({ periodo_actual: aggregateForAI(current), periodo_anterior: aggregateForAI(previous) }) }],
    }],
    generationConfig: { maxOutputTokens: 700 },
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("gemini_timeout");
      throw new Error("gemini_request_failed");
    }

    if (response.status !== 503 || attempt === 3) break;
    const backoffMs = [2_000, 5_000, 12_000][attempt];
    console.warn("control_report_gemini_retry", attempt + 1, response.status, backoffMs);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  const data = await response.json();
  if (!response.ok) throw new Error(`gemini_http_${response.status}`);
  const output = (data.candidates || [])
    .flatMap((candidate: { content?: { parts?: Array<{ text?: string }> } }) => candidate.content?.parts || [])
    .map((part: { text?: string }) => part.text || "")
    .join("");
  if (!output.trim()) throw new Error("gemini_no_text_returned");
  return output.slice(0, 5000);
}
function aggregateForAI(value: any) {
  return {
    period: value?.period,
    orders: value?.orders,
    payments: value?.payments,
    refunds: value?.refunds,
    discounts: value?.discounts,
    business_commissions: value?.business_commissions,
    businesses: (Array.isArray(value?.businesses) ? value.businesses : []).map((row: any) => ({
      name: row.name,
      orders: row.orders,
      gross_cop: row.gross_cop,
      settlement_net_cop: row.settlement_net_cop,
      settlement_pending_cop: row.settlement_pending_cop,
    })),
    drivers: (Array.isArray(value?.drivers) ? value.drivers : []).map((row: any) => ({
      deliveries: row.deliveries,
      earned_cop: row.earned_cop,
      withdrawn_cop: row.withdrawn_cop,
    })),
    withdrawals: value?.withdrawals,
    business_payouts: value?.business_payouts,
    peak_hours: value?.peak_hours,
    reconciliation: value?.reconciliation,
    data_quality: value?.data_quality,
  };
}

async function sendReportEmail(job: ReportJob & { pdf_path: string }, orders: any, recipient: string) {
  const fallbackTo = Deno.env.get("ADMIN_ALERT_EMAIL")?.trim().toLowerCase();
  const allowlist = new Set([fallbackTo, ...(Deno.env.get("ADMIN_ALERT_EMAIL_ALLOWLIST") || "").split(",").map((value) => value.trim().toLowerCase())].filter(Boolean));
  if (!recipient) throw new Error("report_email_not_configured");
  if (!allowlist.has(recipient.toLowerCase())) throw new Error("report_email_recipient_not_allowlisted");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("server_not_configured");
  const link = await createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    .storage.from("admin-control-reports").createSignedUrl(job.pdf_path, 24 * 60 * 60);
  if (link.error || !link.data?.signedUrl) throw new Error("report_link_failed");
  const signedUrl = link.data.signedUrl;
  const subject = "IstmiYa - Informe " + job.period_start + " a " + job.period_end;
  const text = "El informe Control IstmiYa está listo.\n\nPedidos: " + (orders.total ?? 0)
    + "\nVentas brutas registradas: " + cop(orders.gross_cop)
    + "\n\nDescarga PDF (enlace válido por 24 horas): " + signedUrl
    + "\n\nSoporte: " + (Deno.env.get("SUPPORT_EMAIL") || "istmiyasoporte@gmail.com");
  const html = '<div style="font-family:Arial,sans-serif;color:#172033;max-width:600px;margin:auto"><h2 style="color:#e87518">Informe Control IstmiYa</h2><p>El informe del '
    + job.period_start + " al " + job.period_end + ' está listo.</p><p><b>Pedidos:</b> ' + (orders.total ?? 0)
    + "<br/><b>Ventas brutas registradas:</b> " + cop(orders.gross_cop)
    + '</p><p><a href="' + signedUrl + '" style="display:inline-block;background:#f58216;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Descargar informe PDF</a></p><p>El enlace vence en 24 horas.</p><small>Soporte: '
    + (Deno.env.get("SUPPORT_EMAIL") || "istmiyasoporte@gmail.com") + "</small></div>";
  await sendTransactionalEmail({ to: recipient, subject, text, html, idempotencyKey: "control-report/" + job.id });
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function createReportPdf(job: ReportJob, current: any, previous: any, summary: string | null, aiError: string | null) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 744;
  const left = 44;
  const addPage = () => { page = pdf.addPage([612, 792]); y = 744; };
  const draw = (text: string, options: { size?: number; color?: ReturnType<typeof rgb>; font?: typeof regular } = {}) => {
    if (y < 54) addPage();
    page.drawText(pdfSafe(text), { x: left, y, size: options.size || 10, font: options.font || regular, color: options.color || rgb(0.16,0.19,0.24), maxWidth: 522, lineHeight: 14 });
    y -= (options.size || 10) + 7;
  };
  const section = (text: string) => {
    y -= 7;
    page.drawRectangle({ x: left - 4, y: y - 4, width: 530, height: 24, color: rgb(0.10,0.23,0.49) });
    page.drawText(pdfSafe(text), { x: left + 5, y: y + 3, size: 12, font: bold, color: rgb(1,1,1) });
    y -= 25;
  };

  page.drawRectangle({ x: 0, y: 690, width: 612, height: 102, color: rgb(0.06,0.08,0.12) });
  page.drawText("ISTMIYA  |  CONTROL INTERNO", { x: left, y: 752, size: 10, font: bold, color: rgb(1,0.56,0.25) });
  page.drawText("Informe operativo y financiero", { x: left, y: 723, size: 22, font: bold, color: rgb(1,1,1) });
  page.drawText(`${job.period_start} a ${job.period_end}  ·  America/Bogota`, { x: left, y: 701, size: 10, font: regular, color: rgb(0.82,0.86,0.92) });
  y = 668;
  const pOrders = Number(current?.orders?.total || 0);
  const pGross = Number(current?.orders?.gross_cop || 0);
  const approved = Number(current?.payments?.APPROVED?.cop || current?.payments?.approved?.cop || 0);
  const refunded = Number(current?.refunds?.approved_cop || 0);
  const kpis = [
    ["Pedidos", String(pOrders)], ["Ventas brutas", cop(pGross)], ["Pagos aprobados", cop(approved)],
    ["Reembolsos aprobados", cop(refunded)], ["Comisiones registradas", cop(current?.business_commissions?.cop)],
  ];
  const kpiColors = [rgb(0.10,0.23,0.49), rgb(0.04,0.44,0.30), rgb(0.04,0.44,0.30), rgb(0.67,0.18,0.12), rgb(0.85,0.38,0.08)];
  kpis.forEach(([label, value], index) => {
    const x = left + (index % 2) * 265;
    const rowY = 622 - Math.floor(index / 2) * 76;
    page.drawRectangle({ x, y: rowY, width: 250, height: 62, color: rgb(0.95,0.96,0.98), borderColor: rgb(0.85,0.88,0.92), borderWidth: 0.8 });
    page.drawText(pdfSafe(label), { x: x + 12, y: rowY + 39, size: 9, font: regular, color: rgb(0.30,0.34,0.40) });
    page.drawText(pdfSafe(value), { x: x + 12, y: rowY + 15, size: 15, font: bold, color: kpiColors[index] });
  });
  y = 422;
  section("Resumen ejecutivo");
  draw(summary || "La síntesis ejecutiva se está preparando. Las cifras y alertas de este informe se calcularon en PostgreSQL.", { size: 10 });
  if (aiError) draw("Estado de IA: resumen no disponible; el informe determinístico se generó correctamente.", { size: 9, color: rgb(0.67,0.18,0.12) });
  section("Comparación con el periodo anterior");
  draw(`Pedidos: ${pOrders} vs. ${Number(previous?.orders?.total || 0)} · Ventas brutas: ${cop(pGross)} vs. ${cop(previous?.orders?.gross_cop || 0)}`);
  section("Pedidos por estado");
  Object.entries(current?.orders?.by_status || {}).forEach(([status, count]) => draw(`${status}: ${count}`));
  section("Conciliación Wompi, reembolsos y pagos a terceros");
  Object.entries(current?.payments || {}).forEach(([status, value]: [string, any]) => draw(`${status}: ${value.count ?? 0} transacciones · ${cop(value.cop)}`));
  draw(`Reembolsos aprobados: ${cop(refunded)} · Reembolsos en curso: ${current?.refunds?.pending_count ?? 0}`);
  const reconciliation = current?.reconciliation || {};
  draw(`Diferencias de pago: ${reconciliation.approved_payment_order_mismatches ?? 0} · Pedidos pagados sin aprobación Wompi: ${reconciliation.paid_orders_without_approved_payment ?? 0}`);
  draw(`Excepciones abiertas: pagos ${reconciliation.open_payment_exceptions ?? 0}, reembolsos ${reconciliation.open_refund_exceptions ?? 0}, comercios ${reconciliation.open_business_payout_exceptions ?? 0}, repartidores ${reconciliation.open_driver_payout_exceptions ?? 0}`);
  section("Negocios · ventas y liquidación neta registrada");
  for (const business of current?.businesses || []) draw(`${business.name} · ${business.orders} pedidos · ventas ${cop(business.gross_cop)} · liquidado ${cop(business.settlement_net_cop)} · pendiente ${cop(business.settlement_pending_cop)}`);
  section("Repartidores · entregas, ingresos y retiros");
  for (const driver of current?.drivers || []) draw(`${driver.name || "Repartidor"} · ${driver.deliveries} entregas · ingresos ${cop(driver.earned_cop)} · retiros pagados ${cop(driver.withdrawn_cop)}`);
  section("Horas pico y calidad de datos");
  const peaks = [...(current?.peak_hours || [])].sort((a: any,b: any) => Number(b.orders)-Number(a.orders)).slice(0,5);
  draw(peaks.length ? peaks.map((row: any) => `${String(row.hour).padStart(2,"0")}:00 (${row.orders})`).join(" · ") : "Sin pedidos registrados en el periodo.");
  for (const note of current?.data_quality || []) draw(`• ${note}`, { size: 9, color: rgb(0.38,0.40,0.44) });
  draw("Los valores de liquidación no representan utilidad real; no se registran costos de producto u operación.", { size: 9, color: rgb(0.67,0.18,0.12) });
  return await pdf.save();
}

function previousPeriod(startText: string, endText: string) {
  const days = Math.round((Date.parse(`${endText}T00:00:00Z`) - Date.parse(`${startText}T00:00:00Z`)) / 86400000) + 1;
  const priorEnd = new Date(Date.parse(`${startText}T00:00:00Z`) - 86400000);
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * 86400000);
  return { start: priorStart.toISOString().slice(0,10), end: priorEnd.toISOString().slice(0,10) };
}
function cop(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(amount)} COP` : "No registrado";
}
function pdfSafe(value: unknown) { return String(value ?? "").replace(/[^\u0020-\u00FF]/g, " ").slice(0, 400); }
function validUuid(value: unknown): string | null { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null; }
