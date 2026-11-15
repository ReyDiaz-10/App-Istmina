ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_instructions TEXT,
  ADD COLUMN IF NOT EXISTS cancel_until_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.wompi_transactions
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id),
  ADD COLUMN IF NOT EXISTS amount_in_cents BIGINT,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.wompi_transactions t
SET order_id = l.order_id,
    amount_in_cents = l.amount_in_cents,
    updated_at = GREATEST(t.created_at, NOW())
FROM public.wompi_payment_links l
WHERE l.payment_link_id = t.payment_link_id
  AND (t.order_id IS NULL OR t.amount_in_cents IS NULL);

UPDATE public.wompi_transactions
SET applied_at = created_at
WHERE status = 'APPROVED' AND applied_at IS NULL;

UPDATE public.orders
SET cancel_until_at = created_at + INTERVAL '5 minutes'
WHERE status::TEXT = 'pagado' AND cancel_until_at IS NULL;

CREATE INDEX IF NOT EXISTS wompi_transactions_order_status_idx
  ON public.wompi_transactions (order_id, status);

CREATE TABLE IF NOT EXISTS public.order_payment_attempts (
  order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.profiles(id),
  business_id UUID NOT NULL REFERENCES public.businesses(id),
  amount_in_cents BIGINT NOT NULL CHECK (amount_in_cents > 0),
  payment_link_id TEXT UNIQUE,
  payment_url TEXT,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'ready', 'failed', 'reconciliation_required')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'ready' AND payment_link_id IS NOT NULL AND payment_url IS NOT NULL)
    OR status <> 'ready')
);

ALTER TABLE public.order_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payment_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.order_payment_attempts TO service_role;
GRANT SELECT ON public.order_payment_attempts TO authenticated;
CREATE POLICY order_payment_attempts_admin_read
  ON public.order_payment_attempts FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::TEXT = 'admin')
  );

INSERT INTO public.order_payment_attempts (
  order_id, client_id, business_id, amount_in_cents, payment_link_id, payment_url, status, created_at, updated_at
)
SELECT DISTINCT ON (l.order_id)
  l.order_id, o.client_id, l.business_id, l.amount_in_cents, l.payment_link_id,
  'https://checkout.wompi.co/l/' || l.payment_link_id,
  CASE WHEN l.status = 'pending' THEN 'ready' ELSE 'failed' END,
  l.created_at, NOW()
FROM public.wompi_payment_links l
JOIN public.orders o ON o.id = l.order_id
WHERE l.purpose = 'order'
ORDER BY l.order_id, l.created_at DESC
ON CONFLICT (order_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.order_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES public.wompi_transactions(transaction_id) ON DELETE RESTRICT,
  wompi_refund_id TEXT UNIQUE,
  amount_in_cents BIGINT NOT NULL CHECK (amount_in_cents > 0),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'submitting', 'pending', 'uncertain', 'error', 'approved', 'declined', 'cancelled')),
  reason TEXT NOT NULL,
  status_message TEXT,
  requested_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS order_refunds_order_created_idx
  ON public.order_refunds (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_refunds_status_created_idx
  ON public.order_refunds (status, created_at);

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_refunds TO authenticated;
CREATE POLICY order_refunds_select_order_participants
  ON public.order_refunds FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::TEXT = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_refunds.order_id
        AND (
          o.client_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id = o.business_id AND b.profile_id = auth.uid()
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION public.reserve_order_payment_link(
  p_order_id UUID,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_attempt public.order_payment_attempts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND client_id = p_client_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.status::TEXT <> 'pendiente'
     OR v_order.payment_method::TEXT IS DISTINCT FROM 'wompi' THEN
    RAISE EXCEPTION 'Pending Wompi order not found';
  END IF;

  SELECT * INTO v_attempt
  FROM public.order_payment_attempts
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF FOUND AND v_attempt.status = 'ready' THEN
    RETURN jsonb_build_object(
      'action', 'reuse',
      'payment_url', v_attempt.payment_url
    );
  END IF;

  IF FOUND AND v_attempt.status IN ('creating', 'reconciliation_required') THEN
    RETURN jsonb_build_object('action', 'wait');
  END IF;

  INSERT INTO public.order_payment_attempts (
    order_id, client_id, business_id, amount_in_cents, status, failure_reason, created_at, updated_at
  )
  VALUES (
    p_order_id, p_client_id, v_order.business_id,
    ROUND(v_order.total_amount * 100)::BIGINT, 'creating', NULL, NOW(), NOW()
  )
  ON CONFLICT (order_id) DO UPDATE SET
    client_id = EXCLUDED.client_id,
    business_id = EXCLUDED.business_id,
    amount_in_cents = EXCLUDED.amount_in_cents,
    payment_link_id = NULL,
    payment_url = NULL,
    status = 'creating',
    failure_reason = NULL,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'action', 'create',
    'amount_in_cents', ROUND(v_order.total_amount * 100)::BIGINT,
    'business_id', v_order.business_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_order_payment_link(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_order_payment_link(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_order_payment_link(
  p_order_id UUID,
  p_client_id UUID,
  p_payment_link_id TEXT,
  p_payment_url TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.order_payment_attempts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_attempt
  FROM public.order_payment_attempts
  WHERE order_id = p_order_id AND client_id = p_client_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'creating' THEN
    RAISE EXCEPTION 'Payment link reservation not found';
  END IF;

  INSERT INTO public.wompi_payment_links (
    payment_link_id, purpose, order_id, business_id, amount_in_cents, status
  )
  VALUES (
    p_payment_link_id, 'order', p_order_id, v_attempt.business_id, v_attempt.amount_in_cents, 'pending'
  );

  UPDATE public.order_payment_attempts
  SET payment_link_id = p_payment_link_id,
      payment_url = p_payment_url,
      status = 'ready',
      updated_at = NOW()
  WHERE order_id = p_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_order_payment_link(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_payment_link(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_order_payment_link(
  p_order_id UUID,
  p_client_id UUID,
  p_failure_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.order_payment_attempts
  SET status = 'failed',
      failure_reason = LEFT(NULLIF(BTRIM(p_failure_reason), ''), 500),
      updated_at = NOW()
  WHERE order_id = p_order_id AND client_id = p_client_id AND status = 'creating';
END;
$$;
REVOKE ALL ON FUNCTION public.fail_order_payment_link(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_order_payment_link(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_order_payment_link_uncertain(
  p_order_id UUID,
  p_client_id UUID,
  p_failure_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.order_payment_attempts
  SET status = 'reconciliation_required',
      failure_reason = LEFT(NULLIF(BTRIM(p_failure_reason), ''), 500),
      updated_at = NOW()
  WHERE order_id = p_order_id AND client_id = p_client_id AND status = 'creating';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment link reservation not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_order_payment_link_uncertain(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_payment_link_uncertain(UUID, UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_order_with_delivery_v2(
  p_business_id UUID,
  p_items JSONB,
  p_delivery_latitude DOUBLE PRECISION,
  p_delivery_longitude DOUBLE PRECISION,
  p_delivery_address TEXT,
  p_delivery_instructions TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_client_id UUID := auth.uid();
  v_role TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_quantity INTEGER;
  v_price NUMERIC(12, 2);
  v_product_subtotal NUMERIC(12, 2) := 0;
  v_delivery_fee INTEGER;
  v_distance_meters INTEGER;
  v_order_id UUID;
  v_subscribed BOOLEAN;
  v_wallet_balance NUMERIC(12, 2);
  v_address TEXT := NULLIF(BTRIM(p_delivery_address), '');
  v_instructions TEXT := NULLIF(BTRIM(p_delivery_instructions), '');
BEGIN
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = v_client_id;
  IF v_role IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'Only client accounts can place orders' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Invalid order item list';
  END IF;
  IF v_address IS NULL OR char_length(v_address) > 300 THEN
    RAISE EXCEPTION 'A delivery address of at most 300 characters is required';
  END IF;
  IF v_instructions IS NOT NULL AND char_length(v_instructions) > 500 THEN
    RAISE EXCEPTION 'Delivery instructions must be at most 500 characters';
  END IF;
  IF p_delivery_latitude IS NULL OR p_delivery_longitude IS NULL
     OR p_delivery_latitude NOT BETWEEN -90 AND 90
     OR p_delivery_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'A valid GPS delivery location is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND status = 'activo'
  ) THEN
    RAISE EXCEPTION 'Business is not accepting orders';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_product_id := (v_item ->> 'product_id')::UUID;
      v_quantity := (v_item ->> 'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Invalid product or quantity in order';
    END;
    IF v_quantity < 1 OR v_quantity > 50 THEN
      RAISE EXCEPTION 'Order quantity must be between 1 and 50';
    END IF;
    SELECT price INTO v_price
    FROM public.products
    WHERE id = v_product_id AND business_id = p_business_id
    FOR SHARE;
    IF NOT FOUND OR v_price <= 0 THEN
      RAISE EXCEPTION 'Product is unavailable for this business';
    END IF;
    v_product_subtotal := v_product_subtotal + v_price * v_quantity;
  END LOOP;

  SELECT q.distance_meters, q.delivery_fee_cop
  INTO v_distance_meters, v_delivery_fee
  FROM public.quote_delivery_fee(p_business_id, p_delivery_latitude, p_delivery_longitude) q;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = p_business_id AND is_active
      AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
  ) INTO v_subscribed;
  IF NOT v_subscribed THEN
    SELECT COALESCE(balance, 0) INTO v_wallet_balance
    FROM public.wallets WHERE business_id = p_business_id
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR v_wallet_balance < ROUND(v_product_subtotal * 0.10, 2) THEN
      RAISE EXCEPTION 'WALLET_INSUFFICIENT: Business wallet cannot cover the 10%% commission';
    END IF;
  END IF;

  INSERT INTO public.orders (
    client_id, business_id, total_amount, product_subtotal_cop, delivery_fee_cop,
    distance_meters, delivery_latitude, delivery_longitude, delivery_address,
    delivery_instructions, payment_method, status
  )
  VALUES (
    v_client_id, p_business_id, v_product_subtotal + v_delivery_fee, v_product_subtotal,
    v_delivery_fee, v_distance_meters, p_delivery_latitude, p_delivery_longitude,
    v_address, v_instructions, 'wompi', 'pendiente'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::UUID;
    v_quantity := (v_item ->> 'quantity')::INTEGER;
    SELECT price INTO v_price FROM public.products WHERE id = v_product_id;
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_price);
  END LOOP;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_order_with_delivery_v2(UUID, JSONB, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_delivery_v2(UUID, JSONB, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.create_order(UUID, JSONB, public.payment_method) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_order_with_delivery(UUID, JSONB, public.payment_method, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_order_cancellation(
  p_order_id UUID,
  p_actor_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_role TEXT;
  v_business_owner UUID;
  v_transaction RECORD;
  v_refund_count INTEGER := 0;
  v_already_cancelled BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('client_cancel', 'business_reject') THEN
    RAISE EXCEPTION 'Invalid cancellation action';
  END IF;

  SELECT * INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = p_actor_id;
  v_already_cancelled := v_order.status::TEXT = 'cancelado';

  IF p_action = 'client_cancel' THEN
    IF v_role IS DISTINCT FROM 'cliente' OR v_order.client_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'Only the order customer can cancel it' USING ERRCODE = '42501';
    END IF;
    IF v_already_cancelled THEN
      IF v_order.cancellation_reason IS DISTINCT FROM 'Cancelado por el cliente' THEN
        RAISE EXCEPTION 'Order was cancelled by another party';
      END IF;
    ELSIF v_order.status::TEXT <> 'pendiente'
      AND NOT (
        v_order.status::TEXT = 'pagado'
        AND v_order.cancel_until_at IS NOT NULL
        AND v_order.cancel_until_at > NOW()
      ) THEN
      RAISE EXCEPTION 'Cancellation window has closed';
    END IF;
  ELSE
    SELECT profile_id INTO v_business_owner
    FROM public.businesses WHERE id = v_order.business_id;
    IF v_role IS DISTINCT FROM 'negocio' OR v_business_owner IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'Only the business can reject a paid, unaccepted order' USING ERRCODE = '42501';
    END IF;
    IF v_already_cancelled THEN
      IF v_order.cancellation_reason IS DISTINCT FROM 'Rechazado por el comercio' THEN
        RAISE EXCEPTION 'Order was cancelled by another party';
      END IF;
    ELSIF v_order.status::TEXT <> 'pagado' THEN
      RAISE EXCEPTION 'Only the business can reject a paid, unaccepted order';
    END IF;
  END IF;

  IF NOT v_already_cancelled THEN
    UPDATE public.orders
    SET status = 'cancelado',
        cancellation_reason = CASE
          WHEN p_action = 'business_reject' THEN 'Rechazado por el comercio'
          ELSE 'Cancelado por el cliente'
        END,
        cancelled_at = NOW()
    WHERE id = p_order_id;
  END IF;

  UPDATE public.order_refunds
  SET status = 'uncertain',
      status_message = COALESCE(status_message, 'Previous submission did not finish; reconcile before retrying'),
      updated_at = NOW()
  WHERE order_id = p_order_id
    AND status = 'submitting'
    AND updated_at < NOW() - INTERVAL '5 minutes';

  FOR v_transaction IN
    SELECT t.transaction_id, t.amount_in_cents
    FROM public.wompi_transactions t
    WHERE t.order_id = p_order_id
      AND t.status = 'APPROVED'
      AND t.applied_at IS NOT NULL
  LOOP
    INSERT INTO public.order_refunds (
      order_id, transaction_id, amount_in_cents, reason, requested_by
    )
    VALUES (
      p_order_id, v_transaction.transaction_id, v_transaction.amount_in_cents,
      CASE WHEN p_action = 'business_reject' THEN 'business_rejected' ELSE 'customer_cancelled' END,
      p_actor_id
    )
    ON CONFLICT (transaction_id) DO NOTHING;
    IF FOUND THEN v_refund_count := v_refund_count + 1; END IF;
  END LOOP;

  IF v_order.status::TEXT = 'pagado' AND v_refund_count = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.order_refunds WHERE order_id = p_order_id
     ) THEN
    RAISE EXCEPTION 'No approved Wompi transaction exists for this paid order';
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', 'cancelado',
    'refund_count', v_refund_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.request_order_cancellation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_order_cancellation(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_order_refund(p_transaction_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.order_refunds%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.order_refunds
  SET status = 'submitting', updated_at = NOW()
  WHERE transaction_id = p_transaction_id AND status = 'requested'
  RETURNING * INTO v_refund;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'order_id', v_refund.order_id,
    'transaction_id', v_refund.transaction_id,
    'amount_in_cents', v_refund.amount_in_cents
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_order_refund(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_refund(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_order_refund_submission(
  p_transaction_id TEXT,
  p_wompi_refund_id TEXT,
  p_status TEXT,
  p_status_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR p_status NOT IN ('pending', 'uncertain', 'error') THEN
    RAISE EXCEPTION 'Invalid refund submission update' USING ERRCODE = '42501';
  END IF;
  UPDATE public.order_refunds
  SET wompi_refund_id = COALESCE(NULLIF(p_wompi_refund_id, ''), wompi_refund_id),
      status = p_status,
      status_message = LEFT(NULLIF(p_status_message, ''), 500),
      updated_at = NOW()
  WHERE transaction_id = p_transaction_id AND status = 'submitting';
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request is not awaiting submission'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_order_refund_submission(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_refund_submission(TEXT, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_wompi_refund_event(
  p_transaction_id TEXT,
  p_wompi_refund_id TEXT,
  p_amount_in_cents BIGINT,
  p_status TEXT,
  p_status_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.order_refunds%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_refund
  FROM public.order_refunds
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_refund.amount_in_cents <> p_amount_in_cents
     OR p_status NOT IN ('APPROVED', 'DECLINED', 'ERROR', 'CANCELLED') THEN
    RAISE EXCEPTION 'Refund transaction, amount or status mismatch';
  END IF;
  IF v_refund.status IN ('approved', 'declined', 'cancelled', 'error') THEN
    RETURN TRUE;
  END IF;
  UPDATE public.order_refunds
  SET wompi_refund_id = COALESCE(NULLIF(p_wompi_refund_id, ''), wompi_refund_id),
      status = LOWER(p_status),
      status_message = LEFT(NULLIF(p_status_message, ''), 500),
      updated_at = NOW(),
      completed_at = NOW()
  WHERE transaction_id = p_transaction_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_wompi_refund_event(TEXT, TEXT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wompi_refund_event(TEXT, TEXT, BIGINT, TEXT, TEXT)
  TO service_role;

DROP FUNCTION IF EXISTS public.apply_wompi_payment(TEXT, TEXT, BIGINT, TEXT, TEXT);
CREATE FUNCTION public.apply_wompi_payment(
  p_transaction_id TEXT,
  p_payment_link_id TEXT,
  p_amount_in_cents BIGINT,
  p_currency TEXT,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.wompi_payment_links%ROWTYPE;
  v_transaction public.wompi_transactions%ROWTYPE;
  v_order_status TEXT;
  v_subscription_id UUID;
  v_subscription_end DATE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_payment_link_id IS NULL
     OR p_amount_in_cents IS NULL OR p_currency IS NULL OR p_status IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_link
  FROM public.wompi_payment_links
  WHERE payment_link_id = p_payment_link_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF p_amount_in_cents <> v_link.amount_in_cents OR p_currency <> 'COP' THEN
    RAISE EXCEPTION 'Wompi payment amount or currency does not match';
  END IF;

  INSERT INTO public.wompi_transactions (
    transaction_id, payment_link_id, order_id, amount_in_cents, status, created_at, updated_at
  )
  VALUES (
    p_transaction_id, p_payment_link_id, v_link.order_id, p_amount_in_cents, p_status, NOW(), NOW()
  )
  ON CONFLICT (transaction_id) DO UPDATE
  SET status = CASE
        WHEN public.wompi_transactions.applied_at IS NOT NULL
          AND EXCLUDED.status <> 'APPROVED'
        THEN public.wompi_transactions.status
        ELSE EXCLUDED.status
      END,
      updated_at = NOW()
  WHERE public.wompi_transactions.payment_link_id = EXCLUDED.payment_link_id
  RETURNING * INTO v_transaction;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wompi transaction is already linked to another payment';
  END IF;

  UPDATE public.wompi_payment_links
  SET status = LOWER(p_status)
  WHERE payment_link_id = p_payment_link_id;

  IF v_link.purpose = 'order' AND p_status IN ('DECLINED', 'ERROR', 'VOIDED') THEN
    UPDATE public.order_payment_attempts
    SET status = 'failed', updated_at = NOW()
    WHERE order_id = v_link.order_id AND payment_link_id = p_payment_link_id;
  END IF;

  IF p_status <> 'APPROVED' OR v_transaction.applied_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  IF v_link.purpose = 'order' THEN
    SELECT status::TEXT INTO v_order_status
    FROM public.orders WHERE id = v_link.order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wompi order not found'; END IF;

    IF v_order_status = 'pendiente' THEN
      UPDATE public.orders
      SET status = 'pagado',
          cancel_until_at = NOW() + INTERVAL '5 minutes'
      WHERE id = v_link.order_id
        AND business_id = v_link.business_id
        AND payment_method::TEXT = 'wompi'
        AND status::TEXT = 'pendiente'
        AND ROUND(total_amount * 100)::BIGINT = v_link.amount_in_cents;
      IF NOT FOUND THEN RAISE EXCEPTION 'Wompi payment does not match a pending order'; END IF;
      UPDATE public.wompi_transactions
      SET applied_at = NOW(), updated_at = NOW()
      WHERE transaction_id = p_transaction_id;
      RETURN TRUE;
    END IF;

    INSERT INTO public.order_refunds (
      order_id, transaction_id, amount_in_cents, reason
    )
    VALUES (
      v_link.order_id, p_transaction_id, p_amount_in_cents,
      CASE WHEN v_order_status = 'cancelado' THEN 'payment_after_cancellation' ELSE 'duplicate_payment' END
    )
    ON CONFLICT (transaction_id) DO NOTHING;
    UPDATE public.wompi_transactions
    SET applied_at = NOW(), updated_at = NOW()
    WHERE transaction_id = p_transaction_id;
    RETURN FALSE;
  ELSIF v_link.purpose = 'wallet' THEN
    UPDATE public.wallets
    SET balance = balance + (v_link.amount_in_cents::NUMERIC / 100),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM public.wallets
      WHERE business_id = v_link.business_id
      ORDER BY id LIMIT 1 FOR UPDATE
    );
    IF NOT FOUND THEN
      INSERT INTO public.wallets (business_id, balance)
      VALUES (v_link.business_id, v_link.amount_in_cents::NUMERIC / 100);
    END IF;
    UPDATE public.businesses
    SET status = 'activo'
    WHERE id = v_link.business_id AND status = 'fuera_de_servicio';
  ELSE
    PERFORM 1 FROM public.businesses WHERE id = v_link.business_id FOR UPDATE;
    SELECT id, end_date INTO v_subscription_id, v_subscription_end
    FROM public.subscriptions
    WHERE business_id = v_link.business_id
    ORDER BY end_date DESC, id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.subscriptions
      SET is_active = TRUE,
          start_date = CASE WHEN end_date >= CURRENT_DATE THEN start_date ELSE CURRENT_DATE END,
          end_date = GREATEST(end_date, CURRENT_DATE) + 30
      WHERE id = v_subscription_id;
    ELSE
      INSERT INTO public.subscriptions (business_id, start_date, end_date, is_active)
      VALUES (v_link.business_id, CURRENT_DATE, CURRENT_DATE + 30, TRUE);
    END IF;
    UPDATE public.businesses
    SET status = 'activo'
    WHERE id = v_link.business_id AND status = 'fuera_de_servicio';
  END IF;

  UPDATE public.wompi_transactions
  SET applied_at = NOW(), updated_at = NOW()
  WHERE transaction_id = p_transaction_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_wompi_payment(TEXT, TEXT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wompi_payment(TEXT, TEXT, BIGINT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order_status TEXT;
BEGIN
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE profile_id = auth.uid()
    AND is_available
    AND verification_status = 'aprobado'
  ORDER BY id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An approved, available driver profile is required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE driver_id = v_driver_id
      AND status::TEXT IN ('repartidor_asignado', 'recogido', 'en_camino')
  ) THEN
    RAISE EXCEPTION 'Driver already has an active delivery';
  END IF;

  SELECT status::TEXT INTO v_order_status
  FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order_status <> 'listo_para_repartidor' THEN
    RAISE EXCEPTION 'Order is no longer available';
  END IF;

  UPDATE public.orders
  SET driver_id = v_driver_id, status = 'repartidor_asignado'
  WHERE id = p_order_id
    AND status::TEXT = 'listo_para_repartidor'
    AND driver_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order was already accepted by another driver'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_mark_order_picked_up(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.orders o
  SET status = 'recogido'
  FROM public.drivers d
  WHERE o.id = p_order_id
    AND o.driver_id = d.id
    AND d.profile_id = auth.uid()
    AND o.status::TEXT = 'repartidor_asignado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Order cannot be marked picked up by this driver'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_start_delivery(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.orders o
  SET status = 'en_camino'
  FROM public.drivers d
  WHERE o.id = p_order_id
    AND o.driver_id = d.id
    AND d.profile_id = auth.uid()
    AND o.status::TEXT = 'recogido';
  IF NOT FOUND THEN RAISE EXCEPTION 'Order cannot be started by this driver'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_complete_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.orders o
  SET status = 'entregado'
  FROM public.drivers d
  WHERE o.id = p_order_id
    AND o.driver_id = d.id
    AND d.profile_id = auth.uid()
    AND o.status::TEXT = 'en_camino';
  IF NOT FOUND THEN RAISE EXCEPTION 'Order cannot be completed by this driver'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_accept_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_mark_order_picked_up(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_start_delivery(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_complete_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_accept_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_mark_order_picked_up(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_start_delivery(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_complete_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_order_chat_message(
  p_order_id UUID,
  p_message TEXT,
  p_phone_consent BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_id UUID := auth.uid();
  v_message TEXT := BTRIM(p_message);
  v_message_id UUID;
BEGIN
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_message IS NULL OR char_length(v_message) < 1 OR char_length(v_message) > 1000 THEN
    RAISE EXCEPTION 'Message must contain between 1 and 1000 characters';
  END IF;
  IF v_message ~ '\+?[0-9][0-9 .()/-]{6,}[0-9]'
     AND COALESCE(p_phone_consent, false) = false THEN
    RAISE EXCEPTION 'PHONE_CONSENT_REQUIRED: confirm before sharing a phone number';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = p_order_id
      AND o.status::TEXT IN (
        'pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado',
        'recogido', 'en_camino', 'entregado'
      )
      AND (
        o.client_id = v_sender_id
        OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = o.business_id AND b.profile_id = v_sender_id)
        OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = o.driver_id AND d.profile_id = v_sender_id)
      )
  ) THEN
    RAISE EXCEPTION 'Chat is not available for this order' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.chats (order_id, sender_id, message, phone_consent, moderation_status)
  VALUES (p_order_id, v_sender_id, v_message, COALESCE(p_phone_consent, false), 'aprobado')
  RETURNING id INTO v_message_id;
  RETURN v_message_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_order_chat_message(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_order_chat_message(UUID, TEXT, BOOLEAN) TO authenticated;

DROP POLICY IF EXISTS chats_select_order_participants ON public.chats;
CREATE POLICY chats_select_order_participants
  ON public.chats FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = chats.order_id
        AND o.status::TEXT IN (
          'pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado',
          'recogido', 'en_camino', 'entregado'
        )
        AND (
          o.client_id = auth.uid()
          OR public.is_superadmin()
          OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = o.business_id AND b.profile_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = o.driver_id AND d.profile_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS chats_insert_order_participants ON public.chats;
CREATE POLICY chats_insert_order_participants
  ON public.chats FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = chats.order_id
        AND o.status::TEXT IN (
          'pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado',
          'recogido', 'en_camino', 'entregado'
        )
        AND (
          o.client_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = o.business_id AND b.profile_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = o.driver_id AND d.profile_id = auth.uid())
        )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'order_refunds'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_refunds;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
