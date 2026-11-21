BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS operating_timezone TEXT NOT NULL DEFAULT 'America/Bogota',
  ADD COLUMN IF NOT EXISTS operating_hours_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.business_operating_hours (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at TIME NOT NULL,
  closes_at TIME NOT NULL,
  is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, day_of_week),
  CHECK (opens_at < closes_at)
);

CREATE INDEX IF NOT EXISTS business_operating_hours_business_confirmed_idx
  ON public.business_operating_hours (business_id, is_confirmed, day_of_week);

ALTER TABLE public.business_operating_hours ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.business_operating_hours TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.business_operating_hours TO authenticated;

DROP POLICY IF EXISTS business_operating_hours_public_read ON public.business_operating_hours;
CREATE POLICY business_operating_hours_public_read
  ON public.business_operating_hours FOR SELECT TO anon, authenticated
  USING (is_confirmed);

DROP POLICY IF EXISTS business_operating_hours_owner_write ON public.business_operating_hours;
CREATE POLICY business_operating_hours_owner_write
  ON public.business_operating_hours FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_operating_hours.business_id
        AND b.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_operating_hours.business_id
        AND b.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.get_business_operating_status(
  p_business_id UUID,
  p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone TEXT;
  v_confirmed BOOLEAN;
  v_local TIMESTAMPTZ;
  v_local_time TIME;
  v_day SMALLINT;
  v_hours public.business_operating_hours%ROWTYPE;
BEGIN
  SELECT operating_timezone, operating_hours_confirmed
  INTO v_timezone, v_confirmed
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_open', FALSE, 'configured', FALSE, 'message', 'Negocio no encontrado');
  END IF;

  v_timezone := COALESCE(NULLIF(BTRIM(v_timezone), ''), 'America/Bogota');
  v_local := p_at AT TIME ZONE v_timezone;
  v_local_time := v_local::TIME;
  v_day := EXTRACT(DOW FROM v_local)::SMALLINT;

  IF NOT COALESCE(v_confirmed, FALSE) THEN
    RETURN jsonb_build_object(
      'is_open', TRUE,
      'configured', FALSE,
      'timezone', v_timezone,
      'opens_at', NULL,
      'closes_at', NULL,
      'message', 'Horario por confirmar'
    );
  END IF;

  SELECT * INTO v_hours
  FROM public.business_operating_hours
  WHERE business_id = p_business_id
    AND day_of_week = v_day
    AND is_confirmed
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'is_open', FALSE,
      'configured', TRUE,
      'timezone', v_timezone,
      'opens_at', NULL,
      'closes_at', NULL,
      'message', 'El negocio está cerrado hoy'
    );
  END IF;

  RETURN jsonb_build_object(
    'is_open', v_local_time >= v_hours.opens_at AND v_local_time < v_hours.closes_at,
    'configured', TRUE,
    'timezone', v_timezone,
    'opens_at', v_hours.opens_at::TEXT,
    'closes_at', v_hours.closes_at::TEXT,
    'message',
      CASE
        WHEN v_local_time >= v_hours.opens_at AND v_local_time < v_hours.closes_at
          THEN 'El negocio está abierto'
        WHEN v_local_time < v_hours.opens_at
          THEN 'Abre a las ' || to_char(v_hours.opens_at, 'HH24:MI')
        ELSE 'Cierra a las ' || to_char(v_hours.closes_at, 'HH24:MI')
      END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_business_operating_status(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_operating_status(UUID, TIMESTAMPTZ) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_business_operating_hours(
  p_hours JSONB,
  p_timezone TEXT DEFAULT 'America/Bogota'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_row JSONB;
  v_day SMALLINT;
  v_open TIME;
  v_close TIME;
  v_count INTEGER := 0;
BEGIN
  SELECT b.id INTO v_business_id
  FROM public.businesses b
  WHERE b.profile_id = auth.uid();

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Solo el propietario puede configurar los horarios'
      USING ERRCODE = '42501';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) < 1
     OR jsonb_array_length(p_hours) > 7 THEN
    RAISE EXCEPTION 'Horario inválido';
  END IF;

  IF COALESCE(NULLIF(BTRIM(p_timezone), ''), 'America/Bogota') <> 'America/Bogota'
     OR NOT EXISTS (
       SELECT 1 FROM pg_timezone_names
       WHERE name = COALESCE(NULLIF(BTRIM(p_timezone), ''), 'America/Bogota')
     ) THEN
    RAISE EXCEPTION 'Zona horaria no válida';
  END IF;

  DELETE FROM public.business_operating_hours
  WHERE business_id = v_business_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_hours)
  LOOP
    BEGIN
      v_day := (v_row ->> 'day_of_week')::SMALLINT;
      v_open := (v_row ->> 'opens_at')::TIME;
      v_close := (v_row ->> 'closes_at')::TIME;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Horario inválido';
    END;

    IF v_day NOT BETWEEN 0 AND 6 OR v_open >= v_close THEN
      RAISE EXCEPTION 'El cierre debe ser posterior a la apertura';
    END IF;

    INSERT INTO public.business_operating_hours (
      business_id, day_of_week, opens_at, closes_at,
      is_confirmed, confirmed_at, updated_at
    ) VALUES (
      v_business_id, v_day, v_open, v_close,
      TRUE, NOW(), NOW()
    )
    ON CONFLICT (business_id, day_of_week) DO UPDATE SET
      opens_at = EXCLUDED.opens_at,
      closes_at = EXCLUDED.closes_at,
      is_confirmed = TRUE,
      confirmed_at = NOW(),
      updated_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.businesses
  SET operating_timezone = 'America/Bogota',
      operating_hours_confirmed = TRUE
  WHERE id = v_business_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'business_id', v_business_id,
    'days_configured', v_count,
    'timezone', 'America/Bogota'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.save_business_operating_hours(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_business_operating_hours(JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_business_order_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status JSONB;
BEGIN
  v_status := public.get_business_operating_status(NEW.business_id, NOW());
  IF COALESCE((v_status ->> 'configured')::BOOLEAN, FALSE)
     AND NOT COALESCE((v_status ->> 'is_open')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'BUSINESS_CLOSED: %|Horario operativo: %',
      v_status ->> 'message',
      COALESCE(v_status ->> 'opens_at', 'cerrado');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_business_order_hours ON public.orders;
CREATE TRIGGER validate_business_order_hours
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_business_order_hours();

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
  v_status JSONB;
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

  v_status := public.get_business_operating_status(v_order.business_id, NOW());
  IF COALESCE((v_status ->> 'configured')::BOOLEAN, FALSE)
     AND NOT COALESCE((v_status ->> 'is_open')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'BUSINESS_CLOSED: %|Horario operativo: %',
      v_status ->> 'message',
      COALESCE(v_status ->> 'closes_at', v_status ->> 'opens_at');
  END IF;

  SELECT * INTO v_attempt
  FROM public.order_payment_attempts
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF FOUND AND v_attempt.status = 'ready' THEN
    RETURN jsonb_build_object('action', 'reuse', 'payment_url', v_attempt.payment_url);
  END IF;
  IF FOUND AND v_attempt.status IN ('creating', 'reconciliation_required') THEN
    RETURN jsonb_build_object('action', 'wait');
  END IF;

  INSERT INTO public.order_payment_attempts (
    order_id, client_id, business_id, amount_in_cents, status, failure_reason, created_at, updated_at
  ) VALUES (
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
  v_reason TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('client_cancel', 'business_reject', 'business_stock_out') THEN
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
    v_reason := 'Cancelado por el cliente';
  ELSE
    SELECT profile_id INTO v_business_owner
    FROM public.businesses WHERE id = v_order.business_id;
    IF v_role IS DISTINCT FROM 'negocio' OR v_business_owner IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'Only the business can cancel this order' USING ERRCODE = '42501';
    END IF;
    IF v_order.status::TEXT NOT IN ('pendiente', 'pagado', 'preparando') THEN
      RAISE EXCEPTION 'The order can no longer be cancelled by the business';
    END IF;
    v_reason := CASE
      WHEN p_action = 'business_stock_out' THEN 'Cancelado por falta de stock'
      ELSE 'Rechazado por el comercio'
    END;
  END IF;

  IF NOT v_already_cancelled THEN
    UPDATE public.orders
    SET status = 'cancelado',
        cancellation_reason = v_reason,
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
    ) VALUES (
      p_order_id, v_transaction.transaction_id, v_transaction.amount_in_cents,
      CASE
        WHEN p_action = 'business_stock_out' THEN 'business_stock_out'
        WHEN p_action = 'business_reject' THEN 'business_rejected'
        ELSE 'customer_cancelled'
      END,
      p_actor_id
    )
    ON CONFLICT (transaction_id) DO NOTHING;
    IF FOUND THEN v_refund_count := v_refund_count + 1; END IF;
  END LOOP;

  IF v_order.status::TEXT IN ('pagado', 'preparando')
     AND v_refund_count = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.order_refunds WHERE order_id = p_order_id
     ) THEN
    UPDATE public.order_payment_attempts
    SET status = 'reconciliation_required',
        failure_reason = 'Paid or referenced order cancelled; approved Wompi transaction not found',
        updated_at = NOW()
    WHERE order_id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'cancelado',
    'cancellation_reason', v_reason,
    'refund_count', v_refund_count,
    'reconciliation_required',
      EXISTS (
        SELECT 1 FROM public.order_payment_attempts
        WHERE order_id = p_order_id
          AND status = 'reconciliation_required'
      )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.request_order_cancellation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_order_cancellation(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
