CREATE TABLE IF NOT EXISTS public.business_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  amount_cop NUMERIC(12, 2) NOT NULL CHECK (amount_cop >= 50000),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'pending', 'success', 'failed', 'needs_review')),
  provider_payout_id TEXT,
  provider_transaction_id TEXT,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('AHORROS', 'CORRIENTE')),
  account_number_last4 TEXT NOT NULL CHECK (account_number_last4 ~ '^[0-9]{4}$'),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.business_settlement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  amount_cop NUMERIC(12, 2) NOT NULL CHECK (amount_cop >= 0),
  payout_id UUID REFERENCES public.business_payouts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'available' AND payout_id IS NULL)
    OR (status IN ('reserved', 'paid') AND payout_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS business_settlement_items_available_idx
  ON public.business_settlement_items (business_id, created_at)
  WHERE status = 'available';
CREATE INDEX IF NOT EXISTS business_payouts_business_created_idx
  ON public.business_payouts (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS business_payouts_status_created_idx
  ON public.business_payouts (status, created_at);

INSERT INTO public.business_settlement_items (order_id, business_id, amount_cop, created_at, updated_at)
SELECT o.id, o.business_id, COALESCE(o.product_subtotal_cop, o.total_amount), o.created_at, NOW()
FROM public.orders o
WHERE o.status::TEXT = 'entregado'
ON CONFLICT (order_id) DO NOTHING;

ALTER TABLE public.business_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settlement_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_payouts, public.business_settlement_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_payouts, public.business_settlement_items TO authenticated;

CREATE POLICY business_payouts_owner_or_admin_read
  ON public.business_payouts FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::TEXT = 'admin')
    OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.profile_id = auth.uid())
  );
CREATE POLICY business_settlement_items_owner_or_admin_read
  ON public.business_settlement_items FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::TEXT = 'admin')
    OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.profile_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.save_business_payout_account(
  p_bank_id TEXT,
  p_bank_name TEXT,
  p_account_type TEXT,
  p_account_number TEXT,
  p_legal_id_type TEXT,
  p_legal_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_profile_id UUID := auth.uid();
  v_key TEXT;
  v_account_number TEXT := REGEXP_REPLACE(COALESCE(p_account_number, ''), '[[:space:]]', '', 'g');
  v_legal_id TEXT := REGEXP_REPLACE(COALESCE(p_legal_id, ''), '[[:space:]]', '', 'g');
BEGIN
  IF v_profile_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles p
       JOIN public.businesses b ON b.profile_id = p.id
       JOIN public.business_verifications v ON v.business_id = b.id
       WHERE p.id = v_profile_id AND p.role::TEXT = 'negocio'
         AND v.verification_status = 'aprobado'
     ) THEN
    RAISE EXCEPTION 'Solo los negocios verificados pueden registrar una cuenta de liquidación'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(BTRIM(p_bank_id), '') IS NULL
     OR NULLIF(BTRIM(p_bank_name), '') IS NULL
     OR p_account_type IS NULL
     OR p_account_type NOT IN ('AHORROS', 'CORRIENTE')
     OR v_account_number !~ '^[0-9]{6,20}$'
     OR p_legal_id_type IS NULL
     OR p_legal_id_type NOT IN ('CC', 'CE', 'NIT')
     OR char_length(v_legal_id) < 5
     OR char_length(v_legal_id) > 20 THEN
    RAISE EXCEPTION 'Revisa el banco, tipo y número de cuenta y documento legal';
  END IF;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'istmiya_payout_encryption_key';
  IF NULLIF(v_key, '') IS NULL THEN
    RAISE EXCEPTION 'Falta configurar el cifrado seguro de cuentas de liquidación';
  END IF;

  INSERT INTO public.payout_accounts (
    profile_id, bank_id, bank_name, account_type, account_number_ciphertext,
    account_number_last4, legal_id_type, legal_id_ciphertext, updated_at
  )
  VALUES (
    v_profile_id, BTRIM(p_bank_id), LEFT(BTRIM(p_bank_name), 100), p_account_type,
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
END;
$$;
REVOKE ALL ON FUNCTION public.save_business_payout_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_business_payout_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.business_payout_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_summary JSONB;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE profile_id = auth.uid();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Perfil de negocio no encontrado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'available_balance', COALESCE((
      SELECT SUM(amount_cop) FROM public.business_settlement_items
      WHERE business_id = v_business_id AND status = 'available'
    ), 0),
    'reserved_balance', COALESCE((
      SELECT SUM(amount_cop) FROM public.business_settlement_items
      WHERE business_id = v_business_id AND status = 'reserved'
    ), 0),
    'paid_balance', COALESCE((
      SELECT SUM(amount_cop) FROM public.business_settlement_items
      WHERE business_id = v_business_id AND status = 'paid'
    ), 0),
    'minimum_payout_cop', 50000,
    'payout_account', (
      SELECT jsonb_build_object(
        'bank_name', bank_name,
        'account_type', account_type,
        'account_number_last4', account_number_last4,
        'updated_at', updated_at
      )
      FROM public.payout_accounts WHERE profile_id = auth.uid()
    ),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'amount_cop', amount_cop,
        'reference', reference,
        'status', status,
        'bank_name', bank_name,
        'account_number_last4', account_number_last4,
        'failure_reason', failure_reason,
        'created_at', created_at,
        'completed_at', completed_at
      ) ORDER BY created_at DESC)
      FROM public.business_payouts
      WHERE business_id = v_business_id
    ), '[]'::JSONB)
  ) INTO v_summary;
  RETURN v_summary;
END;
$$;
REVOKE ALL ON FUNCTION public.business_payout_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_payout_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_due_business_payouts()
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_business RECORD;
  v_item RECORD;
  v_item_ids UUID[];
  v_amount NUMERIC(12, 2);
  v_key TEXT;
  v_reference TEXT;
  v_payout_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'America/Bogota')) <> 1 THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'istmiya_payout_encryption_key';
  IF NULLIF(v_key, '') IS NULL THEN
    RAISE EXCEPTION 'Payout encryption is not configured';
  END IF;

  FOR v_business IN
    SELECT b.id AS business_id, b.profile_id, p.full_name, u.email,
      a.bank_name, a.account_type, a.account_number_last4, a.bank_id,
      a.legal_id_type,
      extensions.pgp_sym_decrypt(a.legal_id_ciphertext, v_key) AS legal_id,
      extensions.pgp_sym_decrypt(a.account_number_ciphertext, v_key) AS account_number
    FROM public.businesses b
    JOIN public.profiles p ON p.id = b.profile_id
    JOIN auth.users u ON u.id = p.id
    JOIN public.business_verifications bv
      ON bv.business_id = b.id AND bv.verification_status = 'aprobado'
    JOIN public.payout_accounts a ON a.profile_id = b.profile_id
    WHERE p.role::TEXT = 'negocio'
      AND EXISTS (
        SELECT 1 FROM public.business_settlement_items i
        WHERE i.business_id = b.id AND i.status = 'available'
      )
    ORDER BY b.id
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    v_item_ids := ARRAY[]::UUID[];
    v_amount := 0;
    FOR v_item IN
      SELECT id, amount_cop
      FROM public.business_settlement_items
      WHERE business_id = v_business.business_id AND status = 'available'
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
    LOOP
      v_item_ids := array_append(v_item_ids, v_item.id);
      v_amount := v_amount + v_item.amount_cop;
    END LOOP;

    IF v_amount < 50000 THEN
      CONTINUE;
    END IF;

    v_reference := 'istmiya-business-' || REPLACE(gen_random_uuid()::TEXT, '-', '');
    INSERT INTO public.business_payouts (
      business_id, amount_cop, reference, status, bank_name, account_type, account_number_last4
    )
    VALUES (
      v_business.business_id, v_amount, v_reference, 'processing',
      v_business.bank_name, v_business.account_type, v_business.account_number_last4
    )
    RETURNING id INTO v_payout_id;

    UPDATE public.business_settlement_items
    SET payout_id = v_payout_id, status = 'reserved', updated_at = NOW()
    WHERE id = ANY(v_item_ids);

    RETURN NEXT jsonb_build_object(
      'business_payout_id', v_payout_id,
      'business_id', v_business.business_id,
      'profile_id', v_business.profile_id,
      'full_name', v_business.full_name,
      'email', v_business.email,
      'amount_cop', v_amount,
      'reference', v_reference,
      'bank_id', v_business.bank_id,
      'bank_name', v_business.bank_name,
      'account_type', v_business.account_type,
      'account_number', v_business.account_number,
      'legal_id_type', v_business.legal_id_type,
      'legal_id', v_business.legal_id
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_business_payouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_business_payouts() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_business_payout_submission(
  p_reference TEXT,
  p_provider_payout_id TEXT,
  p_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR p_status NOT IN ('pending', 'processing', 'needs_review', 'failed') THEN
    RAISE EXCEPTION 'Invalid business payout update' USING ERRCODE = '42501';
  END IF;
  UPDATE public.business_payouts
  SET provider_payout_id = COALESCE(NULLIF(p_provider_payout_id, ''), provider_payout_id),
      status = p_status,
      failure_reason = LEFT(NULLIF(p_failure_reason, ''), 500),
      updated_at = NOW()
  WHERE reference = p_reference AND status NOT IN ('success', 'failed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Business payout not found or already final'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_business_payout_submission(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_business_payout_submission(TEXT, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_business_payout_needs_review(p_reference TEXT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.business_payouts
  SET status = 'needs_review',
      failure_reason = LEFT(NULLIF(p_reason, ''), 500),
      updated_at = NOW()
  WHERE reference = p_reference AND status NOT IN ('success', 'failed');
END;
$$;
REVOKE ALL ON FUNCTION public.set_business_payout_needs_review(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_business_payout_needs_review(TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_wompi_business_payout_event(
  p_reference TEXT,
  p_provider_payout_id TEXT,
  p_provider_transaction_id TEXT,
  p_amount_in_cents BIGINT,
  p_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payout public.business_payouts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_reference IS NOT NULL THEN
    SELECT * INTO v_payout
    FROM public.business_payouts WHERE reference = p_reference FOR UPDATE;
  ELSIF p_provider_payout_id IS NOT NULL THEN
    SELECT * INTO v_payout
    FROM public.business_payouts
    WHERE provider_payout_id = p_provider_payout_id
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF ROUND(v_payout.amount_cop * 100)::BIGINT <> p_amount_in_cents
     OR (p_provider_payout_id IS NOT NULL
       AND v_payout.provider_payout_id IS NOT NULL
       AND v_payout.provider_payout_id <> p_provider_payout_id) THEN
    RAISE EXCEPTION 'Business payout reference, provider id or amount mismatch';
  END IF;
  IF v_payout.status IN ('success', 'failed') THEN RETURN TRUE; END IF;

  UPDATE public.business_payouts
  SET provider_payout_id = COALESCE(provider_payout_id, p_provider_payout_id),
      provider_transaction_id = COALESCE(provider_transaction_id, p_provider_transaction_id),
      updated_at = NOW()
  WHERE id = v_payout.id;

  IF p_status = 'APPROVED' THEN
    UPDATE public.business_payouts
    SET status = 'success', failure_reason = NULL, updated_at = NOW(), completed_at = NOW()
    WHERE id = v_payout.id;
    UPDATE public.business_settlement_items
    SET status = 'paid', updated_at = NOW()
    WHERE payout_id = v_payout.id AND status = 'reserved';
  ELSIF p_status IN ('FAILED', 'REJECTED', 'CANCELLED', 'NOT_APPROVED') THEN
    UPDATE public.business_payouts
    SET status = 'failed',
        failure_reason = LEFT(NULLIF(p_failure_reason, ''), 500),
        updated_at = NOW(),
        completed_at = NOW()
    WHERE id = v_payout.id;
    UPDATE public.business_settlement_items
    SET payout_id = NULL, status = 'available', updated_at = NOW()
    WHERE payout_id = v_payout.id AND status = 'reserved';
  ELSIF p_status IN ('TOTAL_PAYMENT', 'PARTIAL_PAYMENT') THEN
    UPDATE public.business_payouts
    SET status = 'needs_review',
        failure_reason = 'Lote final; requiere validar la transacción individual del comercio.',
        updated_at = NOW()
    WHERE id = v_payout.id;
  ELSE
    UPDATE public.business_payouts
    SET status = 'pending', updated_at = NOW()
    WHERE id = v_payout.id;
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_wompi_business_payout_event(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wompi_business_payout_event(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.driver_complete_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_product_subtotal NUMERIC(12, 2);
BEGIN
  UPDATE public.orders o
  SET status = 'entregado'
  FROM public.drivers d
  WHERE o.id = p_order_id
    AND o.driver_id = d.id
    AND d.profile_id = auth.uid()
    AND o.status::TEXT = 'en_camino'
  RETURNING o.business_id, o.product_subtotal_cop
  INTO v_business_id, v_product_subtotal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cannot be completed by this driver';
  END IF;

  INSERT INTO public.business_settlement_items (order_id, business_id, amount_cop)
  VALUES (p_order_id, v_business_id, v_product_subtotal)
  ON CONFLICT (order_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_complete_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_complete_order(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'business_payouts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.business_payouts;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'business_settlement_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.business_settlement_items;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
