import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !url || !anonKey || !serviceKey) return json({ error: "Configuración de servidor incompleta" }, 503);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(url, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Sesión inválida" }, 401);

  const { data: actor } = await adminClient.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (actor?.role !== "admin") return json({ error: "Se requiere una cuenta administradora" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitud inválida" }, 400);
  }
  const targetId = typeof body.profileId === "string" ? body.profileId : "";
  const action = body.action;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!targetId || !["block", "deactivate", "activate"].includes(String(action))) {
    return json({ error: "Perfil o acción inválidos" }, 400);
  }
  if (targetId === authData.user.id) return json({ error: "No puedes cambiar el estado de tu propia cuenta" }, 400);

  const { data: target, error: targetError } = await adminClient
    .from("profiles")
    .select("id,role")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError || !target || target.role === "admin") return json({ error: "Perfil inexistente o no administrable" }, 404);

  let blockedUntil: string | null = null;
  let banDuration = "none";
  if (action === "block") {
    blockedUntil = typeof body.blockedUntil === "string" ? body.blockedUntil : null;
    const untilMs = blockedUntil ? Date.parse(blockedUntil) : NaN;
    const hours = (untilMs - Date.now()) / 3_600_000;
    if (!Number.isFinite(hours) || hours < 1 || hours > 30 * 24) {
      return json({ error: "El bloqueo debe durar entre 1 hora y 30 días" }, 400);
    }
    banDuration = `${Math.ceil(hours)}h`;
  } else if (action === "deactivate") {
    banDuration = "876000h";
  }

  const { data: targetAuth, error: targetAuthError } = await adminClient.auth.admin.getUserById(targetId);
  if (targetAuthError || !targetAuth.user) return json({ error: "No se encontró la cuenta de autenticación" }, 404);
  const oldBanUntil = targetAuth.user.banned_until ? Date.parse(targetAuth.user.banned_until) : NaN;
  const previousBanDuration = Number.isFinite(oldBanUntil) && oldBanUntil > Date.now()
    ? `${Math.max(1, Math.ceil((oldBanUntil - Date.now()) / 3_600_000))}h`
    : "none";

  const { error: banError } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: banDuration });
  if (banError) return json({ error: `No se pudo aplicar el bloqueo de acceso: ${banError.message}` }, 502);

  const { data, error } = await userClient.rpc("admin_set_profile_account_status", {
    p_profile_id: targetId,
    p_action: action,
    p_blocked_until: blockedUntil,
    p_reason: reason || null,
  });
  if (error) {
    const { error: rollbackError } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: previousBanDuration });
    if (rollbackError) console.error("Could not roll back Auth ban after account status RPC failure:", rollbackError.message);
    return json({ error: error.message }, 400);
  }

  return json({ success: true, account: data });
});
