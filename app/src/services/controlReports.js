import { supabase } from '../api/supabaseClient';

export async function listControlReports(limit = 30) {
  const { data, error } = await supabase.from('admin_control_report_jobs')
    .select('id,report_kind,period_start,period_end,status,email_requested,email_sent_at,email_error,ai_summary,error_code,created_at,completed_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function requestControlReport({ start, end, emailRequested, email }) {
  const { data: jobId, error } = await supabase.rpc('admin_enqueue_control_report', {
    p_period_start: start, p_period_end: end, p_email_requested: Boolean(emailRequested), p_email_to: email || null,
  });
  if (error) throw error;
  if (!jobId) throw new Error('No se pudo poner el informe en cola.');
  const result = await processControlReport(jobId);
  return { jobId, result };
}

export async function processControlReport(jobId) {
  const { data, error } = await supabase.functions.invoke('control-istmiya-reports', {
    body: { action: 'process', job_id: jobId },
  });
  if (error) throw error;
  return data;
}

export async function createControlReportDownloadUrl(jobId) {
  const { data, error } = await supabase.functions.invoke('control-istmiya-reports', {
    body: { action: 'download', job_id: jobId },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('El PDF todavía no está disponible.');
  return data.url;
}
