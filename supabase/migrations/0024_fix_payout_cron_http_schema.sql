CREATE OR REPLACE FUNCTION public.invoke_daily_payouts()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions, pg_temp
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'istmiya_project_url')
      || '/functions/v1/process-payouts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'istmiya_supabase_secret_key'),
      'x-payout-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'istmiya_payout_cron_secret')
    ),
    body := jsonb_build_object('scheduled_at', NOW()),
    timeout_milliseconds := 10000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_daily_payouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_daily_payouts() TO postgres;

NOTIFY pgrst, 'reload schema';
