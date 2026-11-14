CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Wompi bank IDs are opaque strings in its API; do not constrain them to UUID.

CREATE TABLE IF NOT EXISTS public.payout_accounts (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bank_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('AHORROS', 'CORRIENTE')),
  account_number_ciphertext BYTEA NOT NULL,
  account_number_last4 TEXT NOT NULL CHECK (account_number_last4 ~ '^[0-9]{4}$'),
  legal_id_type TEXT NOT NULL CHECK (legal_id_type IN ('CC', 'CE', 'NIT')),
  legal_id_ciphertext BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.payout_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT (profile_id, bank_name, account_type, account_number_last4, updated_at)
  ON public.payout_accounts TO authenticated;
DROP POLICY IF EXISTS payout_accounts_owner_read ON public.payout_accounts;
CREATE POLICY payout_accounts_owner_read ON public.payout_accounts
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.payout_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL UNIQUE REFERENCES public.driver_withdrawals(id) ON DELETE RESTRICT,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount_cop NUMERIC(12, 2) NOT NULL CHECK (amount_cop >= 20000),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'pending', 'success', 'failed', 'needs_review')),
  provider TEXT NOT NULL DEFAULT 'wompi',
  provider_payout_id TEXT,
  provider_transaction_id TEXT,
  bank_name TEXT,
  account_type TEXT,
  account_number_last4 TEXT CHECK (account_number_last4 IS NULL OR account_number_last4 ~ '^[0-9]{4}$'),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payout_transactions_profile_created_idx
  ON public.payout_transactions (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payout_transactions_status_created_idx
  ON public.payout_transactions (status, created_at);
ALTER TABLE public.payout_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, withdrawal_id, profile_id, amount_cop, reference, status, provider,
  provider_payout_id, bank_name, account_type, account_number_last4, failure_reason, created_at, updated_at, completed_at)
  ON public.payout_transactions TO authenticated;
DROP POLICY IF EXISTS payout_transactions_owner_or_admin_read ON public.payout_transactions;
CREATE POLICY payout_transactions_owner_or_admin_read ON public.payout_transactions
  FOR SELECT TO authenticated USING (profile_id = auth.uid() OR public.is_superadmin());

DROP POLICY IF EXISTS driver_withdrawals_owner_read ON public.driver_withdrawals;
CREATE POLICY driver_withdrawals_owner_read ON public.driver_withdrawals
  FOR SELECT TO authenticated USING (
    public.is_superadmin()
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_withdrawals.driver_id AND d.profile_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.save_driver_payout_account(
  p_bank_id TEXT,
  p_bank_name TEXT,
  p_account_type TEXT,
  p_account_number TEXT,
  p_legal_id_type TEXT,
  p_legal_id TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault, pg_temp AS $$
DECLARE
  v_profile_id UUID := auth.uid();
  v_key TEXT;
  v_account_number TEXT := REGEXP_REPLACE(COALESCE(p_account_number, ''), '[[:space:]]', '', 'g');
  v_legal_id TEXT := REGEXP_REPLACE(COALESCE(p_legal_id, ''), '[[:space:]]', '', 'g');
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_profile_id AND role::TEXT = 'repartidor'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.drivers WHERE profile_id = v_profile_id AND verification_status = 'aprobado'
  ) THEN
    RAISE EXCEPTION 'Solo los repartidores verificados pueden registrar una cuenta de retiro' USING ERRCODE = '42501';
  END IF;
  IF p_bank_id IS NULL OR NULLIF(BTRIM(p_bank_name), '') IS NULL
     OR p_account_type IS NULL OR p_account_type NOT IN ('AHORROS', 'CORRIENTE')
     OR v_account_number !~ '^[0-9]{6,20}$'
     OR p_legal_id_type IS NULL OR p_legal_id_type NOT IN ('CC', 'CE', 'NIT')
     OR char_length(v_legal_id) < 5 OR char_length(v_legal_id) > 20 THEN
    RAISE EXCEPTION 'Revisa el banco, el tipo de cuenta, el nÃºmero y el documento';
  END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
  WHERE name = 'istmiya_payout_encryption_key';
  IF NULLIF(v_key, '') IS NULL THEN
    RAISE EXCEPTION 'Falta configurar el cifrado seguro de cuentas de retiro';
  END IF;
  INSERT INTO public.payout_accounts (
    profile_id, bank_id, bank_name, account_type, account_number_ciphertext,
    account_number_last4, legal_id_type, legal_id_ciphertext, updated_at
  ) VALUES (
    v_profile_id, p_bank_id, LEFT(BTRIM(p_bank_name), 100), p_account_type,
    extensions.pgp_sym_encrypt(v_account_number, v_key), RIGHT(v_account_number, 4),
    p_legal_id_type, extensions.pgp_sym_encrypt(v_legal_id, v_key), NOW()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    bank_id = EXCLUDED.bank_id,
    bank_name = EXCLUDED.bank_name,
    account_type = EXCLUDED.account_type,
    account_number_ciphertext = EXCLUDED.account_number_ciphertext,
    account_number_last4 = EXCLUDED.account_number_last4,
    legal_id_type = EXCLUDED.legal_id_type,
    legal_id_ciphertext = EXCLUDED.legal_id_ciphertext,
    updated_at = NOW();
END; $$;
REVOKE ALL ON FUNCTION public.save_driver_payout_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_driver_payout_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_payout_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_driver_id UUID;
  v_earned NUMERIC(12, 2);
  v_withdrawn NUMERIC(12, 2);
  v_reserved NUMERIC(12, 2);
  v_summary JSONB;
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE profile_id = auth.uid();
  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'Perfil de repartidor no encontrado' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(amount_cop), 0) INTO v_earned
  FROM public.driver_wallet_entries WHERE driver_id = v_driver_id;
  SELECT COALESCE(SUM(amount_cop) FILTER (WHERE status = 'paid'), 0),
         COALESCE(SUM(amount_cop) FILTER (WHERE status IN ('scheduled','processing')), 0)
  INTO v_withdrawn, v_reserved
  FROM public.driver_withdrawals WHERE driver_id = v_driver_id;
  SELECT jsonb_build_object(
    'available_balance', v_earned - v_withdrawn - v_reserved,
    'reserved_balance', v_reserved,
    'withdrawn_balance', v_withdrawn,
    'threshold_cop', 20000,
    'payout_account', (SELECT jsonb_build_object('bank_name', bank_name, 'account_type', account_type,
      'account_number_last4', account_number_last4, 'updated_at', updated_at)
      FROM public.payout_accounts WHERE profile_id = auth.uid()),
    'scheduled', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', w.id, 'amount_cop', w.amount_cop, 'scheduled_for', w.scheduled_for, 'status', w.status,
      'payout_status', t.status, 'bank_name', COALESCE(t.bank_name, a.bank_name),
      'account_number_last4', COALESCE(t.account_number_last4, a.account_number_last4)
    ) ORDER BY w.scheduled_for) FROM public.driver_withdrawals w
      LEFT JOIN public.payout_transactions t ON t.withdrawal_id = w.id
      LEFT JOIN public.payout_accounts a ON a.profile_id = auth.uid()
      WHERE w.driver_id = v_driver_id AND w.status IN ('scheduled','processing')), '[]'::JSONB),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', w.id, 'amount_cop', w.amount_cop, 'paid_at', w.paid_at, 'status', w.status,
      'provider_reference', t.reference, 'provider_payout_id', t.provider_payout_id,
      'bank_name', COALESCE(t.bank_name, a.bank_name),
      'account_number_last4', COALESCE(t.account_number_last4, a.account_number_last4)
    ) ORDER BY COALESCE(w.paid_at, w.created_at) DESC) FROM public.driver_withdrawals w
      LEFT JOIN public.payout_transactions t ON t.withdrawal_id = w.id
      LEFT JOIN public.payout_accounts a ON a.profile_id = auth.uid()
      WHERE w.driver_id = v_driver_id AND w.status IN ('paid','failed','cancelled')), '[]'::JSONB)
  ) INTO v_summary;
  RETURN v_summary;
END; $$;
REVOKE ALL ON FUNCTION public.driver_payout_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_payout_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_due_driver_payouts()
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault, pg_temp AS $$
DECLARE
  v_row RECORD;
  v_key TEXT;
  v_transaction_id UUID;
  v_reference TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
  WHERE name = 'istmiya_payout_encryption_key';
  IF NULLIF(v_key, '') IS NULL THEN RAISE EXCEPTION 'Payout encryption is not configured'; END IF;

  FOR v_row IN
    SELECT w.id AS withdrawal_id, w.driver_id, w.amount_cop, d.profile_id,
      p.full_name, u.email, a.bank_id, a.bank_name, a.account_type, a.account_number_last4,
      a.legal_id_type, extensions.pgp_sym_decrypt(a.legal_id_ciphertext, v_key) AS legal_id,
      extensions.pgp_sym_decrypt(a.account_number_ciphertext, v_key) AS account_number
    FROM public.driver_withdrawals w
    JOIN public.drivers d ON d.id = w.driver_id
    JOIN public.profiles p ON p.id = d.profile_id
    JOIN auth.users u ON u.id = p.id
    JOIN public.payout_accounts a ON a.profile_id = p.id
    WHERE w.status = 'scheduled' AND w.scheduled_for <= NOW() AND w.amount_cop >= 20000
      AND NOT EXISTS (SELECT 1 FROM public.payout_transactions pt WHERE pt.withdrawal_id = w.id)
    ORDER BY w.scheduled_for
    LIMIT 100
    FOR UPDATE OF w SKIP LOCKED
  LOOP
    v_reference := 'istmiya-' || REPLACE(gen_random_uuid()::TEXT, '-', '');
    INSERT INTO public.payout_transactions (
      withdrawal_id, driver_id, profile_id, amount_cop, reference, status,
      bank_name, account_type, account_number_last4
    ) VALUES (
      v_row.withdrawal_id, v_row.driver_id, v_row.profile_id, v_row.amount_cop, v_reference, 'processing',
      v_row.bank_name, v_row.account_type, v_row.account_number_last4
    ) RETURNING id INTO v_transaction_id;
    UPDATE public.driver_withdrawals SET status = 'processing' WHERE id = v_row.withdrawal_id;
    RETURN NEXT jsonb_build_object(
      'payout_transaction_id', v_transaction_id,
      'withdrawal_id', v_row.withdrawal_id,
      'profile_id', v_row.profile_id,
      'full_name', v_row.full_name,
      'email', v_row.email,
      'amount_cop', v_row.amount_cop,
      'reference', v_reference,
      'bank_id', v_row.bank_id,
      'bank_name', v_row.bank_name,
      'account_type', v_row.account_type,
      'account_number', v_row.account_number,
      'legal_id_type', v_row.legal_id_type,
      'legal_id', v_row.legal_id
    );
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.claim_due_driver_payouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_driver_payouts() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_payout_submission(
  p_reference TEXT,
  p_provider_payout_id TEXT,
  p_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_status NOT IN ('pending','processing','needs_review','failed') THEN
    RAISE EXCEPTION 'Invalid payout update' USING ERRCODE = '42501';
  END IF;
  UPDATE public.payout_transactions SET
    provider_payout_id = COALESCE(NULLIF(p_provider_payout_id, ''), provider_payout_id),
    status = p_status,
    failure_reason = LEFT(NULLIF(p_failure_reason, ''), 500),
    updated_at = NOW()
  WHERE reference = p_reference AND status NOT IN ('success','failed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout transaction not found or already final'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.mark_payout_submission(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_submission(TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.set_payout_needs_review(p_reference TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  UPDATE public.payout_transactions SET status = 'needs_review', failure_reason = LEFT(NULLIF(p_reason, ''), 500), updated_at = NOW()
  WHERE reference = p_reference AND status NOT IN ('success', 'failed');
END; $$;
REVOKE ALL ON FUNCTION public.set_payout_needs_review(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payout_needs_review(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_wompi_payout_event(
  p_reference TEXT,
  p_provider_payout_id TEXT,
  p_provider_transaction_id TEXT,
  p_amount_in_cents BIGINT,
  p_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_transaction public.payout_transactions%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_reference IS NOT NULL THEN
    SELECT * INTO v_transaction
    FROM public.payout_transactions
    WHERE reference = p_reference
    FOR UPDATE;
  ELSIF p_provider_payout_id IS NOT NULL THEN
    SELECT * INTO v_transaction
    FROM public.payout_transactions
    WHERE provider_payout_id = p_provider_payout_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;
  IF NOT FOUND OR ROUND(v_transaction.amount_cop * 100)::BIGINT <> p_amount_in_cents
     OR (p_provider_payout_id IS NOT NULL AND v_transaction.provider_payout_id IS NOT NULL AND v_transaction.provider_payout_id <> p_provider_payout_id) THEN
    RAISE EXCEPTION 'Payout reference, provider id or amount mismatch';
  END IF;
  UPDATE public.payout_transactions SET provider_payout_id = COALESCE(provider_payout_id, p_provider_payout_id),
    provider_transaction_id = COALESCE(provider_transaction_id, p_provider_transaction_id)
  WHERE id = v_transaction.id;
  IF v_transaction.status IN ('success','failed') THEN RETURN; END IF;
  IF p_status = 'APPROVED' THEN
    UPDATE public.payout_transactions SET status = 'success', failure_reason = NULL, updated_at = NOW(), completed_at = NOW() WHERE id = v_transaction.id;
    UPDATE public.driver_withdrawals SET status = 'paid', paid_at = NOW(), provider = 'wompi', provider_reference = v_transaction.reference
    WHERE id = v_transaction.withdrawal_id AND status IN ('processing','scheduled');
  ELSIF p_status IN ('FAILED','REJECTED','CANCELLED','NOT_APPROVED') THEN
    UPDATE public.payout_transactions SET status = 'failed', failure_reason = LEFT(NULLIF(p_failure_reason, ''), 500), updated_at = NOW(), completed_at = NOW() WHERE id = v_transaction.id;
    UPDATE public.driver_withdrawals SET status = 'failed', failure_reason = LEFT(NULLIF(p_failure_reason, ''), 500)
    WHERE id = v_transaction.withdrawal_id AND status IN ('processing','scheduled');
  ELSIF p_status IN ('TOTAL_PAYMENT','PARTIAL_PAYMENT') THEN
    UPDATE public.payout_transactions SET status = 'needs_review', failure_reason = 'Lote final; requiere validar la transacciÃ³n individual del destinatario.', updated_at = NOW()
    WHERE id = v_transaction.id;
  ELSE
    UPDATE public.payout_transactions SET status = 'pending', updated_at = NOW() WHERE id = v_transaction.id;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.apply_wompi_payout_event(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wompi_payout_event(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_daily_payouts()
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions, pg_temp AS $$
DECLARE v_request_id BIGINT;
BEGIN
  SELECT extensions.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'istmiya_project_url') || '/functions/v1/process-payouts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'istmiya_supabase_secret_key'),
      'x-payout-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'istmiya_payout_cron_secret')
    ),
    body := jsonb_build_object('scheduled_at', NOW()),
    timeout_milliseconds := 10000
  ) INTO v_request_id;
  RETURN v_request_id;
END; $$;
REVOKE ALL ON FUNCTION public.invoke_daily_payouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_daily_payouts() TO postgres;

DO $$
BEGIN
  PERFORM cron.schedule('istmiya-daily-payouts-3am-bogota', '0 8 * * *',
    'SELECT public.invoke_daily_payouts()');
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_withdrawals') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_withdrawals;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payout_transactions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payout_transactions;
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
