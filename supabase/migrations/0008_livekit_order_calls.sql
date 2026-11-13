CREATE TABLE public.order_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL UNIQUE,
  caller_id UUID NOT NULL REFERENCES public.profiles(id),
  callee_id UUID NOT NULL REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'accepted', 'declined', 'ended', 'missed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX order_calls_order_status_created_idx
  ON public.order_calls (order_id, status, created_at DESC);

ALTER TABLE public.order_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_calls TO authenticated;

CREATE POLICY order_calls_select_participants
  ON public.order_calls FOR SELECT TO authenticated
  USING (caller_id = auth.uid() OR callee_id = auth.uid() OR public.is_superadmin());

CREATE OR REPLACE FUNCTION public.start_order_call(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_id UUID;
  v_business_id UUID;
  v_business_owner UUID;
  v_order_status TEXT;
  v_callee_id UUID;
  v_call_id UUID := gen_random_uuid();
  v_existing_id UUID;
  v_existing_caller UUID;
  v_existing_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT client_id, business_id, status::TEXT
    INTO v_client_id, v_business_id, v_order_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order_status NOT IN ('pagado', 'preparando', 'listo_para_repartidor', 'en_camino') THEN
    RAISE EXCEPTION 'Calls are unavailable for this order';
  END IF;

  SELECT profile_id INTO v_business_owner
  FROM public.businesses WHERE id = v_business_id;
  IF v_user_id = v_client_id THEN
    v_callee_id := v_business_owner;
  ELSIF v_user_id = v_business_owner THEN
    v_callee_id := v_client_id;
  ELSE
    RAISE EXCEPTION 'Only the customer or business can start this call' USING ERRCODE = '42501';
  END IF;

  UPDATE public.order_calls
  SET status = 'missed'
  WHERE order_id = p_order_id
    AND status = 'ringing'
    AND expires_at <= NOW();

  SELECT id, caller_id, status
    INTO v_existing_id, v_existing_caller, v_existing_status
  FROM public.order_calls
  WHERE order_id = p_order_id
    AND status IN ('ringing', 'accepted')
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_status = 'ringing' AND v_existing_caller = v_user_id THEN
      RETURN v_existing_id;
    END IF;
    RAISE EXCEPTION 'A call for this order is already in progress';
  END IF;

  INSERT INTO public.order_calls (
    id, order_id, room_name, caller_id, callee_id, status, expires_at
  )
  VALUES (
    v_call_id,
    p_order_id,
    'istmiya-call-' || v_call_id::TEXT,
    v_user_id,
    v_callee_id,
    'ringing',
    NOW() + INTERVAL '45 seconds'
  );
  RETURN v_call_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_order_call(
  p_call_id UUID,
  p_accept BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'A call response is required';
  END IF;

  UPDATE public.order_calls
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      expires_at = CASE WHEN p_accept THEN NOW() + INTERVAL '30 minutes' ELSE expires_at END
  WHERE id = p_call_id
    AND callee_id = auth.uid()
    AND status = 'ringing'
    AND expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incoming call is no longer available';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_order_call(p_call_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.order_calls
  SET status = 'ended'
  WHERE id = p_call_id
    AND (caller_id = auth.uid() OR callee_id = auth.uid())
    AND status IN ('ringing', 'accepted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call not found or already ended';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_order_call(p_call_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.order_calls
  SET status = 'missed'
  WHERE id = p_call_id
    AND (caller_id = auth.uid() OR callee_id = auth.uid())
    AND status = 'ringing'
    AND expires_at <= NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.start_order_call(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_order_call(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_order_call(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_order_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_order_call(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_order_call(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_order_call(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_order_call(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'order_calls'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_calls;
  END IF;
END;
$$;

ALTER TABLE public.order_calls REPLICA IDENTITY FULL;
