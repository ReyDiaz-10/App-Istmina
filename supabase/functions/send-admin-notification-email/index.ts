import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTransactionalEmail } from "../_shared/email.ts";

const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { "content-type":"application/json", "cache-control":"no-store" } });
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error:"method_not_allowed" },405);
  const secret=Deno.env.get("NOTIFICATION_DISPATCH_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error:"unauthorized" },401);
  const url=Deno.env.get("SUPABASE_URL"); const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error:"server_not_configured" },503);
  const { notification_id }=await req.json();
  if (typeof notification_id!=="string" || !/^[0-9a-f-]{36}$/i.test(notification_id)) return json({ error:"invalid_notification_id" },400);
  const db=createClient(url,key,{auth:{persistSession:false}});
  const {data: row,error}=await db.from("user_notifications").select("id,recipient_id,event_key,title,body,email_requested,email_sent_at,attempts").eq("id",notification_id).maybeSingle();
  if (error) return json({ error:"notification_read_failed" },500);
  if (!row || !row.email_requested || row.email_sent_at) return json({ ok:true, skipped:true });
  const prefColumn = row.event_key === 'financial_exception' ? 'email_financial_exception' : row.event_key === 'inappropriate_language' ? 'email_inappropriate_language' : 'email_profile_pending';
  const {data: pref,error: preferenceError}=await db.from("notification_preferences").select(`email_enabled,${prefColumn},admin_alert_email`).eq("user_id",row.recipient_id).maybeSingle();
  if (preferenceError) return json({error:"email_preference_read_failed"},500);
  if (pref?.email_enabled === false || pref?.[prefColumn] === false) return json({ ok:true, skipped:true });
  const {data: authData,error: authError}=await db.auth.admin.getUserById(row.recipient_id);
  const email=authData?.user?.email;
  if (authError || !email) return json({ error:"admin_email_unavailable" },409);
  try {
    await sendTransactionalEmail({
      to:pref?.admin_alert_email || Deno.env.get('ADMIN_ALERT_EMAIL') || email,
      subject:`IstmiYa: ${row.title}`,
      text:`${row.body}\n\nAbre el panel administrativo de IstmiYa para revisar el aviso.\n\nSoporte: ${Deno.env.get("SUPPORT_EMAIL") || "istmiyasoporte@gmail.com"}`,
      idempotencyKey:`notification/${row.id}`,
    });
    const {error:updateError}=await db.rpc('release_notification_batch',{p_id:row.id,p_channel:'email',p_attempts:row.attempts+1,p_error:'',p_delay_seconds:60,p_sent:true});
    if (updateError) throw new Error("email_delivery_record_failed");
    return json({ok:true});
  } catch (error) {
    console.error("admin_notification_email_failed",row.id,error instanceof Error?error.message:"unknown");
    return json({error:"email_delivery_failed"},502);
  }
});
