ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS phone_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'aprobado'
    CHECK (moderation_status IN ('aprobado', 'bloqueado'));

REVOKE INSERT ON public.chats FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS chats_insert_order_participants ON public.chats;

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
  IF v_message ~ '\+?[0-9][0-9 .()/-]{6,}[0-9]' AND COALESCE(p_phone_consent, false) = false THEN
    RAISE EXCEPTION 'PHONE_CONSENT_REQUIRED: confirm before sharing a phone number';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.status::TEXT IN (
        'pagado', 'preparando', 'listo_para_repartidor', 'en_camino', 'entregado'
      )
      AND (
        o.client_id = v_sender_id
        OR EXISTS (
          SELECT 1 FROM public.businesses b
          WHERE b.id = o.business_id AND b.profile_id = v_sender_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Chat is not available for this order' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chats (order_id, sender_id, message, phone_consent, moderation_status)
  VALUES (
    p_order_id,
    v_sender_id,
    v_message,
    COALESCE(p_phone_consent, false),
    'aprobado'
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_order_chat_message(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_order_chat_message(UUID, TEXT, BOOLEAN) TO authenticated;

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
      WHERE status::TEXT IN ('pendiente', 'pagado', 'preparando', 'listo_para_repartidor', 'en_camino')
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
