import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const SOUND: Record<string, string> = {
  business_new_order: "order-new.wav", order_available: "order-available.wav",
  profile_review_pending: "review-pending.wav", customer_registered: "customer-registered.wav",
  money_received: "money-received.wav", feedback_elogio: "feedback.wav", feedback_sugerencia: "feedback.wav",
  financial_exception: "review-pending.wav", inappropriate_language: "review-pending.wav",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("NOTIFICATION_DISPATCH_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "server_not_configured" }, 500);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: rows, error } = await db.rpc("claim_notification_batch", { p_channel: "push", p_limit: 100 });
  if (error) return json({ error: "outbox_read_failed" }, 500);
  let sent = 0; let failed = 0;
  for (const row of rows || []) {
    const { data: devices, error: deviceError } = await db.from("notification_devices")
      .select("id,expo_push_token").eq("user_id", row.recipient_id).is("disabled_at", null);
    if (deviceError) { failed++; await retry(db, row, "push", deviceError.message); continue; }
    if (!devices?.length) await finish(db, row, "push");
    else {
    let allSent = true;
    const messages = devices.map((device) => ({
      to: device.expo_push_token, title: row.title, body: row.body,
      sound: SOUND[row.event_key] || "default", channelId: channel(row.event_key),
      data: { notification_id: row.id, event_key: row.event_key, order_id: row.order_id },
    }));
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "gzip, deflate" },
        body: JSON.stringify(messages),
      });
      const result = await response.json();
      if (!response.ok || (result.data || []).length !== messages.length) throw new Error(`expo_push_${response.status}`);
      const tickets = result.data as Array<{ status?: string; details?: { error?: string } }>;
      for (let index = 0; index < tickets.length; index++) {
        const ticket = tickets[index];
        if (ticket.status === "error") {
          allSent = false;
          if (ticket.details?.error === "DeviceNotRegistered") await db.from("notification_devices").update({ disabled_at: new Date().toISOString() }).eq("id", devices[index].id);
        }
      }
      if (allSent) {
        await finish(db, row, "push");
        sent++;
      } else { failed++; await retry(db, row, "push", "expo_push_ticket_error"); }
    } catch (e) { failed++; await retry(db, row, "push", e instanceof Error ? e.message : "push_failed"); }
    }
  }
  const { data: emailRows, error: emailClaimError } = await db.rpc("claim_notification_batch", { p_channel: "email", p_limit: 100 });
  if (emailClaimError) return json({ error: "email_outbox_read_failed", sent, failed: failed + 1 }, 500);
  for (const row of emailRows || []) {
    try {
      const response = await fetch(`${url}/functions/v1/send-admin-notification-email`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, apikey: key },
        body: JSON.stringify({ notification_id: row.id }),
      });
      if (!response.ok) throw new Error(`email_function_http_${response.status}`);
      const result = await response.json();
      if (result.skipped) await finish(db, row, "email");
      else sent++;
    } catch (e) { failed++; await retry(db, row, "email", e instanceof Error ? e.message : "email_delivery_failed"); }
  }
  return json({ scanned: (rows?.length || 0) + (emailRows?.length || 0), sent, failed });
});

function channel(event: string) {
  if (event === "business_new_order") return "orders";
  if (event === "order_available") return "available";
  if (event === "profile_review_pending" || event === "customer_registered" || event === "financial_exception" || event === "inappropriate_language") return "admin";
  if (event === "money_received") return "money";
  return "default";
}

async function retry(db: ReturnType<typeof createClient>, row: { id: string; attempts: number }, channelName: string, message: string) {
  const attempts = row.attempts + 1;
  const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
  const { error } = await db.rpc("release_notification_batch", { p_id: row.id, p_channel: channelName, p_attempts: attempts, p_error: message.slice(0, 300), p_delay_seconds: delayMinutes * 60, p_sent: false });
  if (error) console.error("notification_outbox_retry_update_failed", row.id, error.message);
}

async function finish(db: ReturnType<typeof createClient>, row: { id: string; attempts: number }, channelName: string) {
  const { error } = await db.rpc("release_notification_batch", { p_id: row.id, p_channel: channelName, p_attempts: row.attempts + 1, p_error: "", p_delay_seconds: 60, p_sent: true });
  if (error) console.error("notification_outbox_finish_failed", row.id, error.message);
}
