BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS business_prep_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS business_prep_eta_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_arrival_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS driver_arrival_eta_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::REGCLASS
      AND conname = 'orders_business_prep_eta_valid'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_business_prep_eta_valid
      CHECK (
        (business_prep_minutes IS NULL AND business_prep_eta_at IS NULL)
        OR (
          business_prep_minutes BETWEEN 1 AND 1440
          AND business_prep_eta_at IS NOT NULL
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::REGCLASS
      AND conname = 'orders_driver_arrival_eta_valid'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_driver_arrival_eta_valid
      CHECK (
        (driver_arrival_minutes IS NULL AND driver_arrival_eta_at IS NULL)
        OR (
          driver_arrival_minutes BETWEEN 1 AND 1440
          AND driver_arrival_eta_at IS NOT NULL
        )
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.order_delivery_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(BTRIM(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'returning'
    CHECK (status IN ('returning', 'returned', 'reassigned', 'cancelled')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at TIMESTAMPTZ,
  return_confirmed_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  CHECK (
    (status = 'returning' AND returned_at IS NULL AND resolved_at IS NULL)
    OR (status = 'returned' AND returned_at IS NOT NULL AND resolved_at IS NULL)
    OR (status IN ('reassigned', 'cancelled') AND returned_at IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS order_delivery_incidents_order_recent_idx
  ON public.order_delivery_incidents (order_id, reported_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS order_delivery_incidents_one_open_per_order_idx
  ON public.order_delivery_incidents (order_id)
  WHERE status IN ('returning', 'returned');

ALTER TABLE public.order_delivery_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_delivery_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_delivery_incidents TO authenticated;
CREATE POLICY order_delivery_incidents_participants_read
  ON public.order_delivery_incidents FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::TEXT = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_delivery_incidents.order_id
        AND (
          o.client_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id = o.business_id AND b.profile_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.drivers d
            WHERE d.id = order_delivery_incidents.driver_id AND d.profile_id = auth.uid()
          )
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.order_participant_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS order_participant_blocks_blocked_idx
  ON public.order_participant_blocks (blocked_id, blocker_id);

ALTER TABLE public.order_participant_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_participant_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_participant_blocks TO authenticated;
CREATE POLICY order_participant_blocks_involved_read
  ON public.order_participant_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_order_participant_block_state(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_id UUID;
  v_driver_profile_id UUID;
  v_business_owner UUID;
  v_other_id UUID;
  v_blocked_by_me BOOLEAN := FALSE;
  v_blocked_by_other BOOLEAN := FALSE;
BEGIN
  SELECT o.client_id, d.profile_id, b.profile_id
  INTO v_client_id, v_driver_profile_id, v_business_owner
  FROM public.orders o
  LEFT JOIN public.drivers d ON d.id = o.driver_id
  JOIN public.businesses b ON b.id = o.business_id
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Order participant not found' USING ERRCODE = '42501';
  END IF;

  IF v_user_id = v_client_id THEN
    v_other_id := v_driver_profile_id;
  ELSIF v_user_id = v_driver_profile_id THEN
    v_other_id := v_client_id;
  ELSIF v_user_id = v_business_owner THEN
    RETURN jsonb_build_object(
      'blocked_by_me', FALSE,
      'blocked_by_other', FALSE,
      'pair_blocked', FALSE
    );
  ELSE
    RAISE EXCEPTION 'Only an order participant can inspect this block state'
      USING ERRCODE = '42501';
  END IF;

  IF v_other_id IS NOT NULL THEN
    SELECT
      EXISTS (
        SELECT 1 FROM public.order_participant_blocks
        WHERE blocker_id = v_user_id AND blocked_id = v_other_id
      ),
      EXISTS (
        SELECT 1 FROM public.order_participant_blocks
        WHERE blocker_id = v_other_id AND blocked_id = v_user_id
      )
    INTO v_blocked_by_me, v_blocked_by_other;
  END IF;

  RETURN jsonb_build_object(
    'blocked_by_me', v_blocked_by_me,
    'blocked_by_other', v_blocked_by_other,
    'pair_blocked', v_blocked_by_me OR v_blocked_by_other
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_participant_block_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_participant_block_state(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_order_participant_block(
  p_order_id UUID,
  p_blocked BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_id UUID;
  v_driver_id UUID;
  v_driver_profile_id UUID;
  v_other_id UUID;
BEGIN
  IF v_user_id IS NULL OR p_blocked IS NULL THEN
    RAISE EXCEPTION 'Authenticated user and block action are required'
      USING ERRCODE = '42501';
  END IF;

  SELECT o.client_id, o.driver_id, d.profile_id
  INTO v_client_id, v_driver_id, v_driver_profile_id
  FROM public.orders o
  LEFT JOIN public.drivers d ON d.id = o.driver_id
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_user_id = v_client_id THEN
    v_other_id := v_driver_profile_id;
  ELSIF v_user_id = v_driver_profile_id THEN
    v_other_id := v_client_id;
  ELSE
    RAISE EXCEPTION 'Only the customer or assigned driver can manage this block'
      USING ERRCODE = '42501';
  END IF;
  IF v_other_id IS NULL THEN
    RAISE EXCEPTION 'A driver must be assigned before either participant can block the other';
  END IF;

  IF p_blocked THEN
    INSERT INTO public.order_participant_blocks (blocker_id, blocked_id, source_order_id)
    VALUES (v_user_id, v_other_id, p_order_id)
    ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET
      source_order_id = EXCLUDED.source_order_id,
      created_at = NOW();
  ELSE
    DELETE FROM public.order_participant_blocks
    WHERE blocker_id = v_user_id AND blocked_id = v_other_id;
  END IF;

  RETURN public.get_order_participant_block_state(p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_order_participant_block(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_participant_block(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.order_chat_peer_is_blocked(
  p_order_id UUID,
  p_sender_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_id UUID;
  v_driver_profile_id UUID;
BEGIN
  IF v_user_id IS NULL OR p_sender_id IS NULL THEN RETURN FALSE; END IF;

  SELECT o.client_id, d.profile_id
  INTO v_client_id, v_driver_profile_id
  FROM public.orders o
  LEFT JOIN public.drivers d ON d.id = o.driver_id
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_driver_profile_id IS NULL THEN RETURN FALSE; END IF;
  IF NOT (
    (v_user_id = v_client_id AND p_sender_id = v_driver_profile_id)
    OR (v_user_id = v_driver_profile_id AND p_sender_id = v_client_id)
  ) THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.order_participant_blocks
    WHERE (blocker_id = v_user_id AND blocked_id = p_sender_id)
       OR (blocker_id = p_sender_id AND blocked_id = v_user_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.order_chat_peer_is_blocked(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_chat_peer_is_blocked(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.business_mark_order_ready_with_eta(
  p_order_id UUID,
  p_minutes INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Preparation time must be between 1 and 1440 minutes';
  END IF;

  UPDATE public.orders o
  SET business_prep_minutes = p_minutes::SMALLINT,
      business_prep_eta_at = clock_timestamp() + make_interval(mins => p_minutes),
      status = CASE
        WHEN o.driver_id IS NULL THEN 'listo_para_repartidor'::public.order_status
        ELSE 'repartidor_asignado'::public.order_status
      END
  FROM public.businesses b
  WHERE o.id = p_order_id
    AND o.business_id = b.id
    AND b.profile_id = auth.uid()
    AND o.status::TEXT = 'preparando';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cannot be marked ready by this business';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.business_mark_order_ready_with_eta(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_mark_order_ready_with_eta(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.business_accept_order_with_prep_eta(
  p_order_id UUID,
  p_minutes INTEGER
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fee NUMERIC;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Preparation time must be between 1 and 1440 minutes';
  END IF;

  v_fee := public.accept_business_order(p_order_id);
  UPDATE public.orders o
  SET business_prep_minutes = p_minutes::SMALLINT,
      business_prep_eta_at = clock_timestamp() + make_interval(mins => p_minutes)
  FROM public.businesses b
  WHERE o.id = p_order_id
    AND o.business_id = b.id
    AND b.profile_id = auth.uid()
    AND o.status::TEXT = 'preparando';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preparation estimate could not be saved for this order';
  END IF;

  RETURN v_fee;
END;
$$;
REVOKE ALL ON FUNCTION public.business_accept_order_with_prep_eta(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_accept_order_with_prep_eta(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.business_update_prep_eta(
  p_order_id UUID,
  p_minutes INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Preparation time must be between 1 and 1440 minutes';
  END IF;

  UPDATE public.orders o
  SET business_prep_minutes = p_minutes::SMALLINT,
      business_prep_eta_at = clock_timestamp() + make_interval(mins => p_minutes)
  FROM public.businesses b
  WHERE o.id = p_order_id
    AND o.business_id = b.id
    AND b.profile_id = auth.uid()
    AND o.status::TEXT = 'preparando';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preparation time cannot be updated for this order';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.business_update_prep_eta(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_update_prep_eta(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_order_ready(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.orders o
  SET status = CASE
    WHEN o.driver_id IS NULL THEN 'listo_para_repartidor'::public.order_status
    ELSE 'repartidor_asignado'::public.order_status
  END
  FROM public.businesses b
  WHERE o.id = p_order_id
    AND o.business_id = b.id
    AND b.profile_id = auth.uid()
    AND o.status::TEXT = 'preparando'
    AND o.business_prep_minutes IS NOT NULL
    AND o.business_prep_eta_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cannot be marked ready without a preparation estimate';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_order_ready(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_order_ready(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_start_delivery_with_eta(
  p_order_id UUID,
  p_minutes INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Arrival time must be between 1 and 1440 minutes';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  JOIN public.drivers d ON d.id = o.driver_id AND d.profile_id = auth.uid()
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND
     OR v_order.status::TEXT <> 'recogido' THEN
    RAISE EXCEPTION 'Order cannot be started by this driver';
  END IF;

  UPDATE public.orders
  SET driver_arrival_minutes = p_minutes::SMALLINT,
      driver_arrival_eta_at = clock_timestamp() + make_interval(mins => p_minutes),
      status = 'en_camino'
  WHERE id = p_order_id AND status::TEXT = 'recogido';
  IF NOT FOUND THEN RAISE EXCEPTION 'Order status changed before delivery could start'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_start_delivery_with_eta(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_start_delivery_with_eta(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.report_order_delivery_failure(
  p_order_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_driver_id UUID;
  v_incident_id UUID;
  v_reason TEXT := BTRIM(p_reason);
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A reason of 1 to 500 characters is required';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders o
  JOIN public.drivers d ON d.id = o.driver_id AND d.profile_id = auth.uid()
  WHERE o.id = p_order_id
  FOR UPDATE OF o;

  IF NOT FOUND
     OR v_order.status::TEXT NOT IN ('recogido', 'en_camino') THEN
    RAISE EXCEPTION 'Only the assigned driver can report an undelivered order after pickup'
      USING ERRCODE = '42501';
  END IF;

  v_driver_id := v_order.driver_id;
  INSERT INTO public.order_delivery_incidents (order_id, driver_id, reason)
  VALUES (p_order_id, v_driver_id, v_reason)
  RETURNING id INTO v_incident_id;

  UPDATE public.orders
  SET status = 'no_entregado'
  WHERE id = p_order_id AND status::TEXT IN ('recogido', 'en_camino');
  IF NOT FOUND THEN RAISE EXCEPTION 'Order status changed while reporting the incident'; END IF;

  RETURN v_incident_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_order_delivery_failure(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_order_delivery_failure(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_undelivered_return(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_incident_id UUID;
BEGIN
  SELECT o.business_id INTO v_business_id
  FROM public.orders o
  WHERE o.id = p_order_id AND o.status::TEXT = 'no_entregado'
  FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = v_business_id AND b.profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the order business can confirm its return'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_incident_id
  FROM public.order_delivery_incidents
  WHERE order_id = p_order_id AND status = 'returning'
  ORDER BY reported_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending return exists for this order'; END IF;

  UPDATE public.order_delivery_incidents
  SET status = 'returned',
      returned_at = NOW(),
      return_confirmed_by = auth.uid()
  WHERE id = v_incident_id AND status = 'returning';
  IF NOT FOUND THEN RAISE EXCEPTION 'Return status changed before confirmation'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_undelivered_return(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_undelivered_return(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_returned_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_incident_id UUID;
  v_previous_pickup_code TEXT;
  v_previous_delivery_code TEXT;
  v_pickup_code TEXT;
  v_delivery_code TEXT;
BEGIN
  SELECT o.business_id INTO v_business_id
  FROM public.orders o
  WHERE o.id = p_order_id AND o.status::TEXT = 'no_entregado'
  FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = v_business_id AND b.profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the order business can reassign its returned order'
      USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_incident_id
  FROM public.order_delivery_incidents
  WHERE order_id = p_order_id AND status = 'returned'
  ORDER BY reported_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The business must confirm the return before reassignment'; END IF;

  UPDATE public.order_delivery_incidents
  SET status = 'reassigned', resolved_at = NOW()
  WHERE id = v_incident_id AND status = 'returned';

  SELECT pickup_code, delivery_code
  INTO v_previous_pickup_code, v_previous_delivery_code
  FROM public.order_verification_secrets
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification codes are missing; the order cannot be safely reassigned';
  END IF;

  LOOP
    v_pickup_code := substr(translate(md5(gen_random_uuid()::TEXT), 'abcdef', '123456'), 1, 6);
    v_delivery_code := substr(translate(md5(gen_random_uuid()::TEXT), 'abcdef', '123456'), 1, 6);
    EXIT WHEN v_pickup_code <> v_previous_pickup_code
      AND v_delivery_code <> v_previous_delivery_code
      AND v_pickup_code <> v_delivery_code;
  END LOOP;

  UPDATE public.order_verification_secrets
  SET pickup_code = v_pickup_code,
      pickup_code_hash = encode(extensions.digest(v_pickup_code, 'sha256'), 'hex'),
      delivery_code = v_delivery_code,
      delivery_code_hash = encode(extensions.digest(v_delivery_code, 'sha256'), 'hex'),
      created_at = NOW()
  WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification codes are missing; the order cannot be safely reassigned';
  END IF;

  UPDATE public.orders
  SET driver_id = NULL,
      driver_arrival_minutes = NULL,
      driver_arrival_eta_at = NULL,
      status = 'listo_para_repartidor'
  WHERE id = p_order_id AND status::TEXT = 'no_entregado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Order status changed before reassignment'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_returned_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_returned_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_driver_profile_id UUID;
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT id, profile_id INTO v_driver_id, v_driver_profile_id
  FROM public.drivers
  WHERE profile_id = auth.uid()
    AND is_available
    AND verification_status = 'aprobado'
  ORDER BY id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An approved, available driver profile is required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE driver_id = v_driver_id
      AND status::TEXT IN ('preparando', 'repartidor_asignado', 'recogido', 'en_camino', 'no_entregado')
  ) THEN
    RAISE EXCEPTION 'Driver already has an active delivery';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_order.status::TEXT NOT IN ('preparando', 'listo_para_repartidor')
     OR v_order.driver_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order is no longer available';
  END IF;
  IF v_order.status::TEXT = 'preparando'
     AND (v_order.business_prep_minutes IS NULL OR v_order.business_prep_eta_at IS NULL) THEN
    RAISE EXCEPTION 'The business must set a preparation estimate before dispatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_participant_blocks
    WHERE (blocker_id = v_driver_profile_id AND blocked_id = v_order.client_id)
       OR (blocker_id = v_order.client_id AND blocked_id = v_driver_profile_id)
  ) THEN
    RAISE EXCEPTION 'PARTICIPANT_BLOCKED: assignment is not allowed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_delivery_incidents
    WHERE order_id = p_order_id AND driver_id = v_driver_id
  ) THEN
    RAISE EXCEPTION 'A driver who reported a failed delivery cannot accept the same order again';
  END IF;

  UPDATE public.orders
  SET driver_id = v_driver_id,
      driver_arrival_minutes = NULL,
      driver_arrival_eta_at = NULL,
      status = CASE
        WHEN v_order.status::TEXT = 'preparando' THEN 'preparando'::public.order_status
        ELSE 'repartidor_asignado'::public.order_status
      END
  WHERE id = p_order_id
    AND status::TEXT IN ('preparando', 'listo_para_repartidor')
    AND driver_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order was already accepted by another driver'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_accept_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_accept_order(UUID) TO authenticated;

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
  v_incident_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN (
    'client_cancel', 'business_reject', 'business_stock_out', 'business_delivery_failed'
  ) THEN
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

    IF p_action = 'business_delivery_failed' THEN
      v_reason := 'Cancelado tras incidencia de entrega';
      IF v_already_cancelled THEN
        IF v_order.cancellation_reason IS DISTINCT FROM v_reason
           OR NOT EXISTS (
             SELECT 1 FROM public.order_delivery_incidents
             WHERE order_id = p_order_id AND status = 'cancelled'
           ) THEN
          RAISE EXCEPTION 'Order was cancelled by another party';
        END IF;
      ELSIF v_order.status::TEXT <> 'no_entregado' THEN
        RAISE EXCEPTION 'Only an undelivered order can be cancelled after an incident';
      ELSE
        SELECT id INTO v_incident_id
        FROM public.order_delivery_incidents
        WHERE order_id = p_order_id AND status = 'returned'
        ORDER BY reported_at DESC
        LIMIT 1
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'The business must confirm the returned order before cancelling it';
        END IF;
        UPDATE public.order_delivery_incidents
        SET status = 'cancelled', resolved_at = NOW()
        WHERE id = v_incident_id AND status = 'returned';
      END IF;
    ELSE
      IF v_order.status::TEXT NOT IN ('pendiente', 'pagado', 'preparando') THEN
        RAISE EXCEPTION 'The order can no longer be cancelled by the business';
      END IF;
      v_reason := CASE
        WHEN p_action = 'business_stock_out' THEN 'Cancelado por falta de stock'
        ELSE 'Rechazado por el comercio'
      END;
    END IF;
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
        WHEN p_action = 'business_delivery_failed' THEN 'business_delivery_failed'
        ELSE 'customer_cancelled'
      END,
      p_actor_id
    )
    ON CONFLICT (transaction_id) DO NOTHING;
    IF FOUND THEN v_refund_count := v_refund_count + 1; END IF;
  END LOOP;

  IF (
    v_order.status::TEXT IN ('pagado', 'preparando')
    OR (
      v_order.status::TEXT = 'no_entregado'
      AND v_order.payment_method::TEXT = 'wompi'
    )
  )
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
  v_order public.orders%ROWTYPE;
  v_sender_is_business BOOLEAN;
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

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.status::TEXT NOT IN (
    'pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado',
    'recogido', 'en_camino', 'no_entregado', 'entregado'
  ) THEN
    RAISE EXCEPTION 'Chat is not available for this order' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = v_order.business_id AND b.profile_id = v_sender_id
  ) INTO v_sender_is_business;

  IF v_order.client_id IS DISTINCT FROM v_sender_id
     AND NOT v_sender_is_business
     AND NOT EXISTS (
       SELECT 1 FROM public.drivers d
       WHERE d.id = v_order.driver_id AND d.profile_id = v_sender_id
     ) THEN
    RAISE EXCEPTION 'Chat is not available for this order' USING ERRCODE = '42501';
  END IF;

  IF NOT v_sender_is_business
     AND v_order.driver_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.drivers d
       JOIN public.order_participant_blocks block
         ON (block.blocker_id = v_order.client_id AND block.blocked_id = d.profile_id)
         OR (block.blocker_id = d.profile_id AND block.blocked_id = v_order.client_id)
       WHERE d.id = v_order.driver_id
     ) THEN
    RAISE EXCEPTION 'PARTICIPANT_BLOCKED: direct interaction is blocked'
      USING ERRCODE = '42501';
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
    NOT public.order_chat_peer_is_blocked(chats.order_id, chats.sender_id)
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = chats.order_id
        AND o.status::TEXT IN (
          'pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado',
          'recogido', 'en_camino', 'no_entregado', 'entregado'
        )
        AND (
          o.client_id = auth.uid()
          OR public.is_superadmin()
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::TEXT = 'admin')
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
    AND NOT public.order_chat_peer_is_blocked(chats.order_id, chats.sender_id)
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = chats.order_id
        AND o.status::TEXT IN (
          'pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado',
          'recogido', 'en_camino', 'no_entregado', 'entregado'
        )
        AND (
          o.client_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = o.business_id AND b.profile_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = o.driver_id AND d.profile_id = auth.uid())
        )
    )
  );

CREATE OR REPLACE FUNCTION public.validate_delivery_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status::TEXT = 'listo_para_repartidor'
     AND OLD.status::TEXT = 'preparando'
     AND (NEW.business_prep_minutes IS NULL OR NEW.business_prep_eta_at IS NULL) THEN
    RAISE EXCEPTION 'Preparation ETA must be recorded before dispatch';
  END IF;
  IF NEW.status::TEXT = 'repartidor_asignado'
     AND OLD.status::TEXT = 'preparando'
     AND (NEW.business_prep_minutes IS NULL OR NEW.business_prep_eta_at IS NULL) THEN
    RAISE EXCEPTION 'Preparation ETA must be recorded before dispatch';
  END IF;

  IF NEW.status::TEXT = 'en_camino'
     AND OLD.status::TEXT = 'recogido'
     AND (NEW.driver_arrival_minutes IS NULL OR NEW.driver_arrival_eta_at IS NULL) THEN
    RAISE EXCEPTION 'Driver arrival ETA must be recorded before delivery starts';
  END IF;

  IF NEW.status::TEXT = 'no_entregado'
     AND OLD.status::TEXT IS DISTINCT FROM 'no_entregado'
     AND NOT EXISTS (
       SELECT 1 FROM public.order_delivery_incidents i
       WHERE i.order_id = NEW.id
         AND i.driver_id = NEW.driver_id
         AND i.status = 'returning'
     ) THEN
    RAISE EXCEPTION 'A recorded delivery incident is required';
  END IF;

  IF OLD.status::TEXT = 'no_entregado'
     AND NEW.status::TEXT IS DISTINCT FROM 'no_entregado' THEN
    IF NEW.status::TEXT NOT IN ('cancelado', 'listo_para_repartidor') THEN
      RAISE EXCEPTION 'Undelivered orders must be returned before resolution';
    END IF;
    IF NEW.status::TEXT = 'cancelado'
       AND NOT EXISTS (
         SELECT 1 FROM public.order_delivery_incidents
         WHERE order_id = NEW.id AND status = 'cancelled' AND returned_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'The business must confirm the return before cancellation';
    END IF;
    IF NEW.status::TEXT = 'listo_para_repartidor'
       AND NOT EXISTS (
         SELECT 1 FROM public.order_delivery_incidents
         WHERE order_id = NEW.id AND status = 'reassigned' AND returned_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'The business must confirm the return before reassignment';
    END IF;
  END IF;

  IF OLD.status::TEXT = 'no_entregado' AND NEW.status::TEXT = 'entregado' THEN
    RAISE EXCEPTION 'An undelivered order cannot be marked delivered';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_delivery_lifecycle ON public.orders;
CREATE TRIGGER validate_delivery_lifecycle
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_lifecycle();

CREATE OR REPLACE FUNCTION public.require_delivered_order_for_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = NEW.order_id AND o.status::TEXT = 'entregado'
  ) THEN
    RAISE EXCEPTION 'Only successfully delivered orders can be settled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_delivered_order_for_settlement ON public.business_settlement_items;
CREATE TRIGGER require_delivered_order_for_settlement
  BEFORE INSERT OR UPDATE ON public.business_settlement_items
  FOR EACH ROW EXECUTE FUNCTION public.require_delivered_order_for_settlement();

CREATE OR REPLACE FUNCTION public.business_dashboard_summary()
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business profile not found' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'orders', count(*),
    'active_orders', count(*) FILTER (
      WHERE status::TEXT IN (
        'pendiente', 'pagado', 'preparando', 'listo_para_repartidor',
        'repartidor_asignado', 'recogido', 'en_camino', 'no_entregado'
      )
    ),
    'completed_orders', count(*) FILTER (WHERE status::TEXT = 'entregado'),
    'sales', COALESCE(sum(total_amount) FILTER (WHERE status::TEXT = 'entregado'), 0),
    'complaints', (
      SELECT count(*)
      FROM public.support_tickets st
      JOIN public.orders complaint_order ON complaint_order.id = st.order_id
      WHERE complaint_order.business_id = v_business_id
        AND st.category = 'queja'
    )
  )
  INTO v_summary
  FROM public.orders
  WHERE business_id = v_business_id;

  RETURN v_summary;
END;
$$;
REVOKE ALL ON FUNCTION public.business_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_dashboard_summary() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'order_delivery_incidents'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.order_delivery_incidents;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'order_participant_blocks'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.order_participant_blocks;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
