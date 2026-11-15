import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY");
    const wompiEnvironment = Deno.env.get("WOMPI_ENVIRONMENT");
    const authorization = request.headers.get("Authorization");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization || !wompiPrivateKey) {
      return jsonResponse({ error: "Payment service is not configured" }, 503);
    }
    if (wompiEnvironment !== "sandbox" && wompiEnvironment !== "production") {
      return jsonResponse({ error: "WOMPI_ENVIRONMENT must be sandbox or production" }, 503);
    }
    if (
      (wompiEnvironment === "sandbox" && !wompiPrivateKey.startsWith("prv_test_")) ||
      (wompiEnvironment === "production" && !wompiPrivateKey.startsWith("prv_prod_"))
    ) {
      return jsonResponse({ error: "Wompi key does not match the selected environment" }, 503);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await request.json();
    let purpose: "order" | "wallet" | "subscription";
    let orderId: string | null = null;
    let businessId: string;
    let amountInCents: number;
    let description: string;
    let orderPaymentReservation = false;

    if (typeof body.orderId === "string") {
      const { data: reservation, error } = await admin.rpc("reserve_order_payment_link", {
        p_order_id: body.orderId,
        p_client_id: user.id,
      });
      if (error) throw error;
      if (reservation?.action === "reuse" && typeof reservation.payment_url === "string") {
        return jsonResponse({
          payment_url: reservation.payment_url,
          order_id: body.orderId,
          purpose: "order",
        });
      }
      if (reservation?.action === "wait") {
        return jsonResponse({
          error: "The payment link is being created or requires reconciliation. Do not retry yet.",
        }, 409);
      }
      if (reservation?.action !== "create") {
        return jsonResponse({ error: "Pending Wompi order not found" }, 404);
      }
      const cents = Number(reservation.amount_in_cents);
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        return jsonResponse({ error: "Order total is invalid" }, 400);
      }

      purpose = "order";
      orderId = body.orderId;
      businessId = reservation.business_id;
      amountInCents = cents;
      description = `Pedido IstmiYa ${orderId.slice(0, 8)}`;
      orderPaymentReservation = true;
    } else {
      if (body.purpose !== "wallet" && body.purpose !== "subscription") {
        return jsonResponse({ error: "A valid orderId or business payment purpose is required" }, 400);
      }

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile?.role !== "negocio") {
        return jsonResponse({ error: "Business account required" }, 403);
      }

      const { data: business, error: businessError } = await admin
        .from("businesses")
        .select("id")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (businessError) throw businessError;
      if (!business) return jsonResponse({ error: "Business profile not found" }, 404);

      purpose = body.purpose;
      businessId = business.id;
      const amountEnv = purpose === "wallet"
        ? Deno.env.get("WOMPI_WALLET_TOPUP_AMOUNT_COP")
        : Deno.env.get("WOMPI_SUBSCRIPTION_AMOUNT_COP");
      const amountCop = purpose === "subscription"
        ? Number(amountEnv || 35000)
        : amountEnv
          ? Number(amountEnv)
          : 50000;

      if (!Number.isSafeInteger(amountCop) || amountCop <= 0) {
        return jsonResponse({ error: "Configured payment amount is invalid" }, 503);
      }

      amountInCents = amountCop * 100;
      description = purpose === "subscription"
        ? "Suscripción mensual IstmiYa"
        : "Recarga de billetera IstmiYa";
    }

    const baseUrl = wompiEnvironment === "production"
      ? "https://production.wompi.co/v1"
      : "https://sandbox.wompi.co/v1";
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(`${baseUrl}/payment_links`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${wompiPrivateKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: description,
          description,
          single_use: true,
          collect_shipping: false,
          currency: "COP",
          amount_in_cents: amountInCents,
        }),
      });
    } catch (error) {
      if (orderPaymentReservation && orderId) {
        const { error: reservationError } = await admin.rpc("mark_order_payment_link_uncertain", {
          p_order_id: orderId,
          p_client_id: user.id,
          p_failure_reason: error instanceof Error ? error.message : "Network failure contacting Wompi",
        });
        if (reservationError) console.error("Could not mark uncertain payment link:", reservationError.message);
      }
      return jsonResponse({ error: "Payment link creation is uncertain; do not retry until reconciled." }, 502);
    }
    let paymentBody: Record<string, unknown>;
    try {
      const parsedBody: unknown = await paymentResponse.json();
      paymentBody = isRecord(parsedBody) ? parsedBody : {};
    } catch (error) {
      if (orderPaymentReservation && orderId) {
        const { error: reservationError } = await admin.rpc("mark_order_payment_link_uncertain", {
          p_order_id: orderId,
          p_client_id: user.id,
          p_failure_reason: "Wompi returned a response that could not be parsed",
        });
        if (reservationError) console.error("Could not mark invalid Wompi response:", reservationError.message);
      }
      console.error("Could not parse Wompi payment link response:", error);
      return jsonResponse({ error: "Payment link creation is uncertain; do not retry until reconciled." }, 502);
    }
    if (!paymentResponse.ok) {
      console.error("Wompi payment link creation failed", paymentBody);
      if (orderPaymentReservation && orderId) {
        const { error: reservationError } = await admin.rpc("fail_order_payment_link", {
          p_order_id: orderId,
          p_client_id: user.id,
          p_failure_reason: `Wompi returned HTTP ${paymentResponse.status}`,
        });
        if (reservationError) console.error("Could not release payment link reservation:", reservationError.message);
      }
      return jsonResponse({ error: "Wompi could not create the payment link" }, 502);
    }

    const paymentData = isRecord(paymentBody.data) ? paymentBody.data : {};
    const paymentLinkId = paymentData.id;
    if (typeof paymentLinkId !== "string" || !paymentLinkId) {
      if (orderPaymentReservation && orderId) {
        const { error: reservationError } = await admin.rpc("mark_order_payment_link_uncertain", {
          p_order_id: orderId,
          p_client_id: user.id,
          p_failure_reason: "Wompi returned a successful response without a payment link ID",
        });
        if (reservationError) console.error("Could not mark incomplete payment link response:", reservationError.message);
      }
      throw new Error("Wompi response did not include a payment link id");
    }

    const paymentUrl = typeof paymentData.permalink === "string" && paymentData.permalink
      ? paymentData.permalink
      : `https://checkout.wompi.co/l/${paymentLinkId}`;
    const { error: linkError } = orderPaymentReservation && orderId
      ? await admin.rpc("complete_order_payment_link", {
        p_order_id: orderId,
        p_client_id: user.id,
        p_payment_link_id: paymentLinkId,
        p_payment_url: paymentUrl,
      })
      : await admin.from("wompi_payment_links").insert({
        payment_link_id: paymentLinkId,
        purpose,
        order_id: orderId,
        business_id: businessId,
        amount_in_cents: amountInCents,
      });
    if (linkError && orderPaymentReservation && orderId) {
      const { error: reservationError } = await admin.rpc("mark_order_payment_link_uncertain", {
        p_order_id: orderId,
        p_client_id: user.id,
        p_failure_reason: `Could not persist Wompi link ${paymentLinkId}`,
      });
      if (reservationError) console.error("Could not mark unpersisted Wompi link:", reservationError.message);
    }
    if (linkError) throw linkError;

    return jsonResponse({
      payment_url: paymentUrl,
      order_id: orderId,
      purpose,
    });
  } catch (error) {
    console.error("Error creating Wompi payment link:", error);
    return jsonResponse({ error: "Could not create the payment link" }, 500);
  }
});
