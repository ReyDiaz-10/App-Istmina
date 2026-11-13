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

    if (typeof body.orderId === "string") {
      const { data: order, error } = await admin
        .from("orders")
        .select("id, business_id, total_amount, status, payment_method")
        .eq("id", body.orderId)
        .eq("client_id", user.id)
        .maybeSingle();

      if (error) throw error;
      if (!order || order.status !== "pendiente" || order.payment_method !== "wompi") {
        return jsonResponse({ error: "Pending Wompi order not found" }, 404);
      }

      const cents = Math.round(Number(order.total_amount) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        return jsonResponse({ error: "Order total is invalid" }, 400);
      }

      purpose = "order";
      orderId = order.id;
      businessId = order.business_id;
      amountInCents = cents;
      description = `Pedido IstmiYa ${order.id.slice(0, 8)}`;
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
      const amountEnv = Deno.env.get(
        purpose === "subscription"
          ? "WOMPI_SUBSCRIPTION_AMOUNT_COP"
          : "WOMPI_WALLET_TOPUP_AMOUNT_COP",
      );
      const amountCop = amountEnv
        ? Number(amountEnv)
        : purpose === "subscription"
          ? 30000
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
    const paymentResponse = await fetch(`${baseUrl}/payment_links`, {
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
    const paymentBody = await paymentResponse.json();
    if (!paymentResponse.ok) {
      console.error("Wompi payment link creation failed", paymentBody);
      return jsonResponse({ error: "Wompi could not create the payment link" }, 502);
    }

    const paymentLinkId = paymentBody?.data?.id;
    if (typeof paymentLinkId !== "string" || !paymentLinkId) {
      throw new Error("Wompi response did not include a payment link id");
    }

    const { error: linkError } = await admin.from("wompi_payment_links").insert({
      payment_link_id: paymentLinkId,
      purpose,
      order_id: orderId,
      business_id: businessId,
      amount_in_cents: amountInCents,
    });
    if (linkError) throw linkError;

    return jsonResponse({
      payment_url: paymentBody.data.permalink || `https://checkout.wompi.co/l/${paymentLinkId}`,
      order_id: orderId,
      purpose,
    });
  } catch (error) {
    console.error("Error creating Wompi payment link:", error);
    return jsonResponse({ error: "Could not create the payment link" }, 500);
  }
});
