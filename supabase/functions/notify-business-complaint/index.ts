import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTransactionalEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
    const authorization = request.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return jsonResponse({ error: "Complaint notification service is not configured" }, 503);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Authentication required" }, 401);

    const { ticketId } = await request.json();
    if (typeof ticketId !== "string" || !/^[0-9a-f-]{36}$/i.test(ticketId)) {
      return jsonResponse({ error: "A valid ticketId is required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ticket, error: ticketError } = await admin
      .from("support_tickets")
      .select("id, requester_id, order_id, subject, message, category, context")
      .eq("id", ticketId)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket || ticket.requester_id !== user.id) {
      return jsonResponse({ error: "Ticket not found for this account" }, 404);
    }
    const supportEmail = Deno.env.get("SUPPORT_EMAIL");
    if (!supportEmail) return jsonResponse({ error: "No support inbox is configured" }, 503);
    let recipient = supportEmail;
    let businessName = "IstmiYa";
    if (ticket.category === "queja" && ticket.order_id) {
      const { data: order, error: orderError } = await admin
        .from("orders")
        .select("business_id")
        .eq("id", ticket.order_id)
        .maybeSingle();
      if (orderError) throw orderError;
      if (order) {
        const { data: verification, error: verificationError } = await admin
          .from("business_verifications")
          .select("complaint_email, businesses(store_name)")
          .eq("business_id", order.business_id)
          .maybeSingle();
        if (verificationError) throw verificationError;
        if (verification?.complaint_email) {
          recipient = verification.complaint_email;
          businessName = verification.businesses?.store_name || businessName;
        }
      }
    }
    if (!recipient) {
      return jsonResponse({ error: "No complaint inbox is configured" }, 503);
    }
    const { data: admins, error: adminLookupError } = await admin.from("profiles")
      .select("id").in("role", ["admin", "superadmin"]).eq("status", "activo");
    if (adminLookupError) throw new Error("Admin notification recipients could not be loaded");
    if (admins?.length) {
      const { error: notificationError } = await admin.from("user_notifications").upsert(
        admins.map((profile: { id: string }) => ({
          recipient_id: profile.id,
          event_key: "support_ticket_received",
          title: "Nueva solicitud de soporte",
          body: "Llegó una queja o solicitud desde la app. Abre el panel para revisar el caso.",
          idempotency_key: "support-ticket:" + ticket.id + ":admin:" + profile.id,
        })),
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      if (notificationError) throw new Error("Admin in-app notification could not be saved");
    }
    const body = [
      `Hola ${businessName},`,
      "",
      `Recibiste una solicitud de ${ticket.category} enviada desde IstmiYa.`,
      `Asunto: ${ticket.subject}`,
      `Pedido: ${ticket.order_id || "No asociado a un pedido"}`,
      `Contexto: ${ticket.context || "General"}`,
      "",
      ticket.message,
      "",
      `Referencia del caso: ${ticket.id}`,
    ].join("\n");
    const deliveries: Promise<void>[] = [sendTransactionalEmail({
      to: supportEmail,
      subject: `Queja recibida en IstmiYa: ${ticket.subject}`,
      text: body,
      idempotencyKey: `support-ticket/${ticket.id}/support`,
    })];
    if (recipient !== supportEmail) {
      deliveries.push(sendTransactionalEmail({
        to: recipient,
        subject: `Queja recibida en IstmiYa: ${ticket.subject}`,
        text: body,
        idempotencyKey: `support-ticket/${ticket.id}/business`,
      }));
    }
    const outcomes = await Promise.allSettled(deliveries);
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      console.error("Complaint email delivery failed", outcomes.map((outcome) => outcome.status === "rejected" ? outcome.reason?.message : "sent"));
      return jsonResponse({ error: "The complaint was saved, but one or more email notifications failed" }, 502);
    }

    return jsonResponse({ sent: true });
  } catch (error) {
    console.error("Complaint notification failed:", error);
    return jsonResponse({ error: "Could not send complaint notification" }, 500);
  }
});
