CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 160),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 5 AND 5000),
  category TEXT NOT NULL CHECK (category IN ('sugerencia', 'queja', 'felicitación', 'soporte')),
  context TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_revision', 'resuelto')),
  admin_reply TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx
  ON public.support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_requester_created_idx
  ON public.support_tickets (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_business_status_created_idx
  ON public.orders (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_driver_status_idx
  ON public.orders (driver_id, status);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;

DROP POLICY IF EXISTS support_tickets_insert_self ON public.support_tickets;
CREATE POLICY support_tickets_insert_self
  ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND status = 'pendiente'
    AND admin_reply IS NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.status = 'activo')
    AND (order_id IS NULL OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND (
        o.client_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = o.business_id AND b.profile_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = o.driver_id AND d.profile_id = auth.uid())
      )
    ))
  );

DROP POLICY IF EXISTS support_tickets_select_self_or_admin ON public.support_tickets;
CREATE POLICY support_tickets_select_self_or_admin
  ON public.support_tickets FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR public.is_superadmin());

DROP POLICY IF EXISTS support_tickets_update_admin ON public.support_tickets;
CREATE POLICY support_tickets_update_admin
  ON public.support_tickets FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

CREATE OR REPLACE FUNCTION public.set_support_ticket_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_updated_at ON public.support_tickets;
CREATE TRIGGER support_ticket_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_support_ticket_updated_at();

CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM public.profiles),
    'clients', (SELECT count(*) FROM public.profiles WHERE role::TEXT = 'cliente'),
    'orders', (SELECT count(*) FROM public.orders),
    'active_orders', (SELECT count(*) FROM public.orders WHERE status::TEXT IN ('pagado', 'preparando', 'listo_para_repartidor', 'en_camino')),
    'completed', (SELECT count(*) FROM public.orders WHERE status::TEXT = 'entregado'),
    'orders_last_7_days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', activity.day, 'orders', activity.orders) ORDER BY activity.day)
      FROM (
        SELECT days.day::DATE AS day, count(o.id) AS orders
        FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, INTERVAL '1 day') AS days(day)
        LEFT JOIN public.orders o ON (o.created_at AT TIME ZONE 'America/Bogota') >= days.day
          AND (o.created_at AT TIME ZONE 'America/Bogota') < days.day + INTERVAL '1 day'
        GROUP BY days.day
      ) activity
    ), '[]'::JSONB),
    'top_clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', p.id, 'full_name', p.full_name,
        'orders', c.order_count, 'spent', c.total_spent
      ) ORDER BY c.order_count DESC, c.total_spent DESC)
      FROM (
        SELECT client_id, count(*) AS order_count, sum(total_amount) AS total_spent
        FROM public.orders WHERE status::TEXT IN ('pagado', 'preparando', 'listo_para_repartidor', 'en_camino', 'entregado')
        GROUP BY client_id ORDER BY count(*) DESC, sum(total_amount) DESC LIMIT 10
      ) c
      JOIN public.profiles p ON p.id = c.client_id
    ), '[]'::JSONB),
    'businesses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'store_name', b.store_name, 'status', b.status,
        'orders', COALESCE(o.order_count, 0), 'sales', COALESCE(o.sales, 0)
      ) ORDER BY COALESCE(o.order_count, 0) DESC)
      FROM public.businesses b
      LEFT JOIN LATERAL (
        SELECT count(*) AS order_count, sum(total_amount) AS sales
        FROM public.orders WHERE business_id = b.id AND status::TEXT IN ('pagado', 'preparando', 'listo_para_repartidor', 'en_camino', 'entregado')
      ) o ON TRUE
    ), '[]'::JSONB),
    'drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'profile_id', d.profile_id, 'is_available', d.is_available,
        'full_name', p.full_name, 'deliveries', COALESCE(o.deliveries, 0)
      ) ORDER BY COALESCE(o.deliveries, 0) DESC)
      FROM public.drivers d
      LEFT JOIN public.profiles p ON p.id = d.profile_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS deliveries FROM public.orders
        WHERE driver_id = d.id AND status::TEXT = 'entregado'
      ) o ON TRUE
    ), '[]'::JSONB),
    'feedback', (SELECT count(*) FROM public.support_tickets WHERE category IN ('sugerencia', 'queja', 'felicitación'))
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary() TO authenticated, service_role;
