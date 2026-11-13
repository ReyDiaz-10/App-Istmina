import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2.14.2";

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
    const livekitUrl = Deno.env.get("LIVEKIT_URL");
    const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
    const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");
    const authorization = request.headers.get("Authorization");
    if (
      !supabaseUrl || !anonKey || !serviceRoleKey || !authorization ||
      !livekitUrl || !livekitApiKey || !livekitApiSecret
    ) {
      return jsonResponse({ error: "LiveKit call service is not configured" }, 503);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Authentication required" }, 401);

    const { callId } = await request.json();
    if (typeof callId !== "string" || !/^[0-9a-f-]{36}$/i.test(callId)) {
      return jsonResponse({ error: "A valid callId is required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: call, error: callError } = await admin
      .from("order_calls")
      .select("id, room_name, caller_id, callee_id, status")
      .eq("id", callId)
      .maybeSingle();
    if (callError) throw callError;
    if (!call || (call.caller_id !== user.id && call.callee_id !== user.id)) {
      return jsonResponse({ error: "Call not found for this account" }, 404);
    }
    if (call.status !== "accepted") {
      return jsonResponse({ error: "The call must be accepted before joining" }, 409);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: user.id,
      name: profile?.full_name || "IstmiYa",
      ttl: "30m",
    });
    accessToken.addGrant({
      roomJoin: true,
      room: call.room_name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return jsonResponse({
      serverUrl: livekitUrl,
      token: await accessToken.toJwt(),
      roomName: call.room_name,
    });
  } catch (error) {
    console.error("Could not issue LiveKit call token:", error);
    return jsonResponse({ error: "Could not create call access token" }, 500);
  }
});
