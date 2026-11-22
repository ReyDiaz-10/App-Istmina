import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
  "cache-control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
type ReportJob = {
  id: string; requested_by: string | null; report_kind: "manual" | "daily"; period_start: string; period_end: string;
  email_requested: boolean; email_to: string | null; attempts: number;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_not_configured" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
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
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
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

  if (action !== "process") return json({ error: "unsupported_action" }, 400);
  const jobId = validUuid(body.job_id);
  if (!jobId) return json({ error: "invalid_job_id" }, 400);
  const { data: requested, error: requestError } = await db.from("admin_control_report_jobs").select("requested_by,report_kind").eq("id", jobId).maybeSingle();
  if (requestError || !requested) return json({ error: "report_not_found" }, 404);
  if (requested.report_kind !== "daily" && requested.requested_by !== adminId) return json({ error: "report_not_owned" }, 403);
  return await processJob(db, jobId);
});

async function processJob(db: ReturnType<typeof createClient>, jobId: string) {
  const { data: claimed, error: claimError } = await db.rpc("claim_admin_control_report", { p_job_id: jobId });
  const job = (claimed || [])[0] as ReportJob | undefined;
  if (claimError) return json({ error: "report_claim_failed" }, 500);
  if (!job) return json({ status: "processing", job_id: jobId, message: "El informe ya está siendo procesado." }, 202);

  try {
    const { data: metrics, error: metricsError } = await db.rpc("admin_control_report_metrics", {
      p_period_start: job.period_start, p_period_end: job.period_end,
    });
    if (metricsError) throw new Error("report_metrics_failed");
    const previous = previousPeriod(job.period_start, job.period_end);
    const { data: previousMetrics, error: previousError } = await db.rpc("admin_control_report_metrics", {
      p_period_start: previous.start, p_period_end: previous.end,
    });
    if (previousError) throw new Error("report_comparison_failed");

    let aiSummary: string | null = null;
    let aiError: string | null = null;
    if (Deno.env.get("OPENAI_API_KEY") && Deno.env.get("OPENAI_MODEL")) {
      try { aiSummary = await summarizeWithAI(metrics, previousMetrics); }
      catch { aiError = "ai_summary_unavailable"; }
    }
    const pdf = await createReportPdf(job, metrics, previousMetrics, aiSummary, aiError);
    const pdfPath = `${job.period_start}/${job.id}.pdf`;
    const { error: uploadError } = await db.storage.from("admin-control-reports").upload(pdfPath, pdf, {
      contentType: "application/pdf", upsert: true, cacheControl: "3600",
    });
    if (uploadError) throw new Error("report_pdf_upload_failed");

    const update: Record<string, unknown> = {
      status: "ready", metrics: { current: metrics, previous: previousMetrics }, ai_summary: aiSummary,
      pdf_path: pdfPath, completed_at: new Date().toISOString(), error_code: null,
    };
    if (aiError) update.error_code = aiError;
    let emailError: string | null = null;
    if (job.email_requested) {
      try {
        const link = await db.storage.from("admin-control-reports").createSignedUrl(pdfPath, 24 * 60 * 60);
        if (link.error || !link.data?.signedUrl) throw new Error("report_link_failed");
        await sendReportEmail(job, metrics, link.data.signedUrl);
        update.email_sent_at = new Date().toISOString();
        update.email_error = null;
      } catch (error) {
        emailError = error instanceof Error ? error.message : "report_email_failed";
        update.email_error = emailError.slice(0, 120);
      }
    }
    const { error: saveError } = await db.from("admin_control_report_jobs").update(update).eq("id", job.id);
    if (saveError) throw new Error("report_result_save_failed");
    const signed = await db.storage.from("admin-control-reports").createSignedUrl(pdfPath, 60 * 60);
    return json({ status: "ready", job_id: job.id, url: signed.data?.signedUrl || null, email_error: emailError });
  } catch (error) {
    const code = error instanceof Error ? error.message : "report_processing_failed";
    const { error: saveError } = await db.from("admin_control_report_jobs").update({
      status: "error", error_code: code.slice(0, 120), completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (saveError) console.error("control_report_error_state_write_failed", job.id);
    console.error("control_report_processing_failed", job.id, code);
    return json({ status: "error", job_id: job.id, error: code }, 500);
  }
}

async function summarizeWithAI(current: unknown, previous: unknown): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY")!;
  const model = Deno.env.get("OPENAI_MODEL")!;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model, store: false, max_output_tokens: 700,
      instructions: "Eres el analista interno de IstmiYa. Redacta en español un resumen ejecutivo para el administrador, destaca cambios relevantes y anomalías a revisar. Los valores ya fueron calculados por PostgreSQL: no recalcules ni inventes cifras. Aclara cuando un dato no está registrado y no llames utilidad a la liquidación neta.",
      input: JSON.stringify({ periodo_actual: aggregateForAI(current), periodo_anterior: aggregateForAI(previous) }),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const output = (data.output || []).flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
    .find((item: { type?: string }) => item.type === "output_text")?.text;
  if (typeof output !== "string" || !output.trim()) throw new Error("openai_empty_summary");
  return output.slice(0, 5000);
}

function aggregateForAI(value: any) {
  const businesses = Array.isArray(value?.businesses) ? value.businesses : [];
  const drivers = Array.isArray(value?.drivers) ? value.drivers : [];
  return {
    period: value?.period,
    orders: value?.orders,
    payments: value?.payments,
    refunds: value?.refunds,
    discounts: value?.discounts,
    business_commissions: value?.business_commissions,
    businesses: {
      count: businesses.length,
      orders: businesses.reduce((sum: number, row: any) => sum + Number(row.orders || 0), 0),
      gross_cop: businesses.reduce((sum: number, row: any) => sum + Number(row.gross_cop || 0), 0),
      settlement_net_cop: businesses.reduce((sum: number, row: any) => sum + Number(row.settlement_net_cop || 0), 0),
      settlement_pending_cop: businesses.reduce((sum: number, row: any) => sum + Number(row.settlement_pending_cop || 0), 0),
    },
    drivers: {
      count: drivers.length,
      deliveries: drivers.reduce((sum: number, row: any) => sum + Number(row.deliveries || 0), 0),
      earned_cop: drivers.reduce((sum: number, row: any) => sum + Number(row.earned_cop || 0), 0),
      withdrawn_cop: drivers.reduce((sum: number, row: any) => sum + Number(row.withdrawn_cop || 0), 0),
    },
    withdrawals: value?.withdrawals,
    business_payouts: value?.business_payouts,
    peak_hours: value?.peak_hours,
    reconciliation: value?.reconciliation,
    data_quality: value?.data_quality,
  };
}

async function sendReportEmail(job: ReportJob, metrics: any, signedUrl: string) {
  const relay = Deno.env.get("SMTP_RELAY_URL");
  const secret = Deno.env.get("SMTP_RELAY_SECRET");
  const fallbackTo = Deno.env.get("ADMIN_ALERT_EMAIL");
  const recipient = job.email_to || fallbackTo;
  if (!relay || !secret || !recipient) throw new Error("report_email_not_configured");
  const allowlist = new Set([fallbackTo, ...(Deno.env.get("ADMIN_ALERT_EMAIL_ALLOWLIST") || "").split(",").map((value) => value.trim())].filter(Boolean));
  if (!allowlist.has(recipient)) throw new Error("report_email_recipient_not_allowlisted");
  const orders = metrics?.orders || {};
  const response = await fetch(relay, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      to: recipient,
      subject: `IstmiYa · Informe ${job.period_start} a ${job.period_end}`,
      text: `El informe Control IstmiYa está listo.\n\nPedidos: ${orders.total ?? 0}\nVentas brutas registradas: ${cop(orders.gross_cop)}\n\nDescarga PDF (enlace válido por 24 horas): ${signedUrl}\n\nSoporte: ${Deno.env.get("SUPPORT_EMAIL") || "istmiyasoporte@gmail.com"}`,
    }),
  });
  if (!response.ok) throw new Error(`report_relay_http_${response.status}`);
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
  draw(summary || "Resumen IA no disponible. Las cifras y alertas del PDF se calcularon en PostgreSQL.", { size: 10 });
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
