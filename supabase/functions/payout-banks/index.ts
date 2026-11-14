import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return Response.json({ error: "Método no permitido" }, { status: 405, headers: cors });
  const auth = request.headers.get("Authorization");
  if (!auth) return Response.json({ error: "Debes iniciar sesión" }, { status: 401, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, serviceKey);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return Response.json({ error: "Sesión inválida" }, { status: 401, headers: cors });
  const { data: driver } = await admin.from("drivers").select("id,verification_status").eq("profile_id", user.id).maybeSingle();
  if (!driver || driver.verification_status !== "aprobado") return Response.json({ error: "Solo repartidores verificados pueden configurar retiros" }, { status: 403, headers: cors });

  const apiKey = Deno.env.get("WOMPI_PAYOUT_API_KEY");
  const principalId = Deno.env.get("WOMPI_PAYOUT_PRINCIPAL_ID");
  if (!apiKey || !principalId) return Response.json({ error: "Pagos a terceros aún no está configurado" }, { status: 503, headers: cors });
  const base = Deno.env.get("WOMPI_PAYOUT_ENV") === "production" ? "https://api.payouts.wompi.co/v1" : "https://api.sandbox.payouts.wompi.co/v1";
  const response = await fetch(`${base}/banks`, { headers: { "x-api-key": apiKey, "user-principal-id": principalId } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return Response.json({ error: "No se pudo consultar los bancos", provider_status: response.status }, { status: 502, headers: cors });
  const rawBanks = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  const banks = rawBanks.flatMap((bank: Record<string, unknown>) => Array.isArray(bank.accounts) ? bank.accounts.map((account: Record<string, unknown>) => ({ ...account, name: `${bank.name ?? bank.bankName ?? bank.description ?? ''} — ${account.accountType ?? account.type ?? ''}` })) : [bank]);
  return Response.json({ banks: banks.map((bank: Record<string, unknown>) => ({ id: bank.id ?? bank.code ?? bank.bankCode, name: bank.name ?? bank.bankName ?? bank.description ?? bank.bankCode })).filter((bank: { id?: unknown; name?: unknown }) => bank.id && bank.name) }, { headers: cors });
});
