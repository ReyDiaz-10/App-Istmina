BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_order_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  author_role TEXT NOT NULL CHECK (author_role IN ('cliente', 'repartidor')),
  author_display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('calificacion', 'elogio', 'sugerencia', 'queja')),
  rating SMALLINT,
  message TEXT,
  driver_response_code TEXT,
  driver_responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, author_id, category),
  CHECK (author_id <> recipient_id),
  CHECK (
    (author_role = 'cliente' AND category IN ('calificacion', 'elogio', 'sugerencia', 'queja'))
    OR (author_role = 'repartidor' AND category IN ('calificacion', 'queja'))
  ),
  CHECK (
    (category = 'calificacion'
      AND rating IS NOT NULL
      AND rating BETWEEN 1 AND 5
      AND message IS NULL)
    OR (category <> 'calificacion'
      AND rating IS NULL
      AND message IS NOT NULL
      AND char_length(BTRIM(message)) BETWEEN 5 AND 2000)
  ),
  CHECK (
    (driver_response_code IS NULL AND driver_responded_at IS NULL)
    OR (
      category = 'elogio'
      AND driver_response_code IS NOT NULL
      AND driver_response_code IN ('thanks_for_praise', 'glad_to_help', 'appreciate_kindness')
      AND driver_responded_at IS NOT NULL
    )
    OR (
      category = 'sugerencia'
      AND driver_response_code IS NOT NULL
      AND driver_response_code IN ('thanks_will_improve', 'will_review', 'appreciate_feedback')
      AND driver_responded_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS delivery_order_feedback_recipient_recent_idx
  ON public.delivery_order_feedback (recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.delivery_order_feedback_closures (
  order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.delivery_order_feedback_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_order_feedback_closures FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS delivery_order_feedback_closures_driver_recent_idx
  ON public.delivery_order_feedback_closures (driver_profile_id, closed_at DESC, order_id DESC);

CREATE OR REPLACE FUNCTION public.capture_delivery_order_feedback_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status::TEXT IS DISTINCT FROM 'entregado'
    AND NEW.status::TEXT = 'entregado' THEN
    INSERT INTO public.delivery_order_feedback_closures (
      order_id, driver_profile_id, closed_at
    )
    SELECT NEW.id, d.profile_id, clock_timestamp()
    FROM public.drivers d
    WHERE d.id = NEW.driver_id
      AND d.profile_id IS NOT NULL
    ON CONFLICT (order_id) DO UPDATE
    SET driver_profile_id = EXCLUDED.driver_profile_id,
        closed_at = EXCLUDED.closed_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_delivery_order_feedback_closure()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_delivery_order_feedback_closure ON public.orders;
CREATE TRIGGER capture_delivery_order_feedback_closure
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.capture_delivery_order_feedback_closure();

ALTER TABLE public.delivery_order_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_order_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_order_feedback TO authenticated;

CREATE OR REPLACE FUNCTION public.is_delivered_order_assigned_to_current_driver(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.drivers d ON d.id = o.driver_id
    WHERE o.id = p_order_id
      AND o.status::TEXT = 'entregado'
      AND d.profile_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_delivered_order_assigned_to_current_driver(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_delivered_order_assigned_to_current_driver(UUID)
  TO authenticated;

CREATE POLICY delivery_order_feedback_limited_read
  ON public.delivery_order_feedback FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      author_id = auth.uid()
      AND author_role = 'cliente'
      AND category IN ('calificacion', 'elogio', 'sugerencia', 'queja')
    )
    OR (
      author_id = auth.uid()
      AND author_role = 'repartidor'
      AND category IN ('calificacion', 'queja')
    )
    OR (
      recipient_id = auth.uid()
      AND author_role = 'cliente'
      AND category IN ('elogio', 'sugerencia')
      AND public.is_delivered_order_assigned_to_current_driver(delivery_order_feedback.order_id)
    )
  );

CREATE OR REPLACE FUNCTION public.submit_order_feedback(
  p_order_id UUID,
  p_category TEXT,
  p_rating INTEGER DEFAULT NULL,
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_client_id UUID;
  v_driver_profile_id UUID;
  v_order_status TEXT;
  v_author_role TEXT;
  v_recipient_id UUID;
  v_author_name TEXT;
  v_message TEXT := NULLIF(BTRIM(p_message), '');
  v_feedback_id UUID;
  v_created BOOLEAN;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('calificacion', 'elogio', 'sugerencia', 'queja') THEN
    RAISE EXCEPTION 'Invalid feedback category';
  END IF;

  SELECT o.client_id, d.profile_id, o.status::TEXT
  INTO v_client_id, v_driver_profile_id, v_order_status
  FROM public.orders o
  JOIN public.drivers d ON d.id = o.driver_id
  WHERE o.id = p_order_id
  FOR SHARE OF o;

  IF NOT FOUND OR v_order_status <> 'entregado' THEN
    RAISE EXCEPTION 'Feedback is available only for a successfully delivered order';
  END IF;

  IF v_actor_id = v_client_id THEN
    v_author_role := 'cliente';
    v_recipient_id := v_driver_profile_id;
  ELSIF v_actor_id = v_driver_profile_id THEN
    v_author_role := 'repartidor';
    v_recipient_id := v_client_id;
    IF p_category NOT IN ('calificacion', 'queja') THEN
      RAISE EXCEPTION 'Drivers may only rate or report an issue for this completed order'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.delivery_order_feedback_closures current_closure
      WHERE current_closure.order_id = p_order_id
        AND current_closure.driver_profile_id = v_actor_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.delivery_order_feedback_closures newer_closure
          WHERE newer_closure.driver_profile_id = v_actor_id
            AND (newer_closure.closed_at, newer_closure.order_id)
              > (current_closure.closed_at, current_closure.order_id)
        )
    ) THEN
      RAISE EXCEPTION 'Drivers may only rate or report an issue for the order most recently closed'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Only the customer or assigned driver can submit order feedback'
      USING ERRCODE = '42501';
  END IF;

  IF p_category = 'calificacion' THEN
    IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 OR v_message IS NOT NULL THEN
      RAISE EXCEPTION 'A rating from 1 to 5 is required without a message';
    END IF;
  ELSIF p_rating IS NOT NULL OR v_message IS NULL
    OR char_length(v_message) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Feedback text must contain between 5 and 2000 characters';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Usuario IstmiYa')
  INTO v_author_name
  FROM public.profiles p
  WHERE p.id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.delivery_order_feedback (
    order_id, author_id, recipient_id, author_role, author_display_name,
    category, rating, message
  )
  VALUES (
    p_order_id, v_actor_id, v_recipient_id, v_author_role, v_author_name,
    p_category, p_rating::SMALLINT, v_message
  )
  ON CONFLICT (order_id, author_id, category) DO NOTHING
  RETURNING id INTO v_feedback_id;

  v_created := FOUND;
  IF v_feedback_id IS NULL THEN
    SELECT id INTO v_feedback_id
    FROM public.delivery_order_feedback
    WHERE order_id = p_order_id
      AND author_id = v_actor_id
      AND category = p_category;
  END IF;

  RETURN jsonb_build_object('id', v_feedback_id, 'created', v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_order_feedback(UUID, TEXT, INTEGER, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_order_feedback(UUID, TEXT, INTEGER, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_delivery_feedback(
  p_feedback_id UUID,
  p_response_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_response_code IS NULL OR p_response_code NOT IN (
    'thanks_for_praise', 'glad_to_help', 'appreciate_kindness',
    'thanks_will_improve', 'will_review', 'appreciate_feedback'
  ) THEN
    RAISE EXCEPTION 'Choose one of the predefined responses';
  END IF;

  UPDATE public.delivery_order_feedback f
  SET driver_response_code = p_response_code,
      driver_responded_at = NOW()
  FROM public.orders o
  JOIN public.drivers d ON d.id = o.driver_id
  WHERE f.id = p_feedback_id
    AND f.order_id = o.id
    AND f.recipient_id = auth.uid()
    AND f.author_role = 'cliente'
    AND f.category IN ('elogio', 'sugerencia')
    AND f.driver_response_code IS NULL
    AND o.status::TEXT = 'entregado'
    AND d.profile_id = auth.uid()
    AND (
      (f.category = 'elogio' AND p_response_code IN (
        'thanks_for_praise', 'glad_to_help', 'appreciate_kindness'
      ))
      OR
      (f.category = 'sugerencia' AND p_response_code IN (
        'thanks_will_improve', 'will_review', 'appreciate_feedback'
      ))
    )
  RETURNING f.id INTO v_updated_id;

  IF FOUND THEN RETURN TRUE; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.delivery_order_feedback f
    JOIN public.orders o ON o.id = f.order_id
    JOIN public.drivers d ON d.id = o.driver_id
    WHERE f.id = p_feedback_id
      AND f.recipient_id = auth.uid()
      AND f.author_role = 'cliente'
      AND f.category IN ('elogio', 'sugerencia')
      AND f.driver_response_code = p_response_code
      AND o.status::TEXT = 'entregado'
      AND d.profile_id = auth.uid()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_delivery_feedback(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_delivery_feedback(UUID, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_driver_chat_after_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.drivers d ON d.id = o.driver_id
    WHERE o.id = NEW.order_id
      AND o.status::TEXT = 'entregado'
      AND d.profile_id = NEW.sender_id
  ) THEN
    RAISE EXCEPTION 'DELIVERED_ORDER_DRIVER_CHAT_CLOSED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_driver_chat_after_delivery()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_driver_chat_after_delivery ON public.chats;
CREATE TRIGGER prevent_driver_chat_after_delivery
  BEFORE INSERT ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.prevent_driver_chat_after_delivery();

DROP POLICY IF EXISTS chats_restrict_closed_driver_read ON public.chats;
CREATE POLICY chats_restrict_closed_driver_read
  ON public.chats AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (
      public.is_delivered_order_assigned_to_current_driver(chats.order_id)
      AND EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.profile_id = auth.uid()
          AND d.id = (
            SELECT o.driver_id FROM public.orders o WHERE o.id = chats.order_id
          )
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
         AND tablename = 'delivery_order_feedback'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_order_feedback;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
