BEGIN;

-- Additive Control IstmiYa report queue. No existing tables, routes or RPCs are renamed.
CREATE TABLE IF NOT EXISTS public.admin_control_report_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  report_kind TEXT NOT NULL CHECK (report_kind IN ('manual', 'daily')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  daily_key DATE,
  email_requested BOOLEAN NOT NULL DEFAULT FALSE,
  email_to TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'error')),
  metrics JSONB,
  ai_summary TEXT,
  pdf_path TEXT,
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT admin_control_report_period_check CHECK (period_end >= period_start AND period_end - period_start <= 366),
  CONSTRAINT admin_control_report_daily_key_check CHECK ((report_kind = 'daily' AND daily_key IS NOT NULL) OR (report_kind = 'manual' AND daily_key IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_control_report_daily_key_uidx
  ON public.admin_control_report_jobs (daily_key) WHERE report_kind = 'daily';
CREATE INDEX IF NOT EXISTS admin_control_report_jobs_recent_idx
  ON public.admin_control_report_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_control_report_jobs_queue_idx
  ON public.admin_control_report_jobs (created_at) WHERE status = 'queued';
ALTER TABLE public.admin_control_report_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_control_report_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_control_report_jobs TO authenticated;
DROP POLICY IF EXISTS admin_control_report_jobs_admin_read ON public.admin_control_report_jobs;
CREATE POLICY admin_control_report_jobs_admin_read ON public.admin_control_report_jobs
  FOR SELECT TO authenticated USING (public.is_admin());

-- The historical schema does not record discounts or operating costs. They remain explicitly
-- unreported instead of being inferred as zero/profit. Commission rows are captured going forward.
CREATE TABLE IF NOT EXISTS public.business_commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  amount_cop NUMERIC(12,2) NOT NULL CHECK (amount_cop >= 0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_commission_ledger_captured_idx
  ON public.business_commission_ledger (captured_at DESC);
ALTER TABLE public.business_commission_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_commission_ledger FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_business_commission_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_subscribed BOOLEAN;
BEGIN
  IF OLD.status::TEXT = 'pagado' AND NEW.status::TEXT = 'preparando' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.business_id = NEW.business_id AND s.is_active
        AND s.start_date <= CURRENT_DATE AND s.end_date >= CURRENT_DATE
    ) INTO v_subscribed;
    IF NOT v_subscribed THEN
      INSERT INTO public.business_commission_ledger (order_id, business_id, amount_cop)
      VALUES (NEW.id, NEW.business_id, ROUND(NEW.total_amount * 0.10, 2))
      ON CONFLICT (order_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_business_commission_ledger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_business_commission_ledger ON public.orders;
CREATE TRIGGER capture_business_commission_ledger
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.capture_business_commission_ledger();

-- Additional case ownership/SLA fields and an append-only timeline for existing support cases.
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
DROP POLICY IF EXISTS support_tickets_admin_read_control ON public.support_tickets;
CREATE POLICY support_tickets_admin_read_control ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_admin());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.support_tickets'::regclass AND conname='support_tickets_priority_check') THEN
    ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_priority_check
      CHECK (priority IN ('low','normal','high','urgent')) NOT VALID;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.support_ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','status_changed','reply_added','assigned','priority_changed','due_date_changed')),
  detail JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS support_ticket_events_ticket_created_idx
  ON public.support_ticket_events (ticket_id, created_at DESC);
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_ticket_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_ticket_events TO authenticated;
DROP POLICY IF EXISTS support_ticket_events_requester_or_admin_read ON public.support_ticket_events;
CREATE POLICY support_ticket_events_requester_or_admin_read ON public.support_ticket_events
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.requester_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.capture_support_ticket_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.support_ticket_events(ticket_id, actor_id, event_type, detail)
    VALUES (NEW.id, COALESCE(auth.uid(), NEW.requester_id), 'created', jsonb_build_object('status', NEW.status));
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.support_ticket_events(ticket_id, actor_id, event_type, detail)
      VALUES (NEW.id, auth.uid(), 'status_changed', jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    IF NEW.admin_reply IS DISTINCT FROM OLD.admin_reply AND NULLIF(BTRIM(NEW.admin_reply), '') IS NOT NULL THEN
      INSERT INTO public.support_ticket_events(ticket_id, actor_id, event_type, detail)
      VALUES (NEW.id, auth.uid(), 'reply_added', jsonb_build_object('reply', LEFT(NEW.admin_reply, 2000)));
    END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      INSERT INTO public.support_ticket_events(ticket_id, actor_id, event_type, detail)
      VALUES (NEW.id, auth.uid(), 'assigned', jsonb_build_object('assigned_to', NEW.assigned_to));
    END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN
      INSERT INTO public.support_ticket_events(ticket_id, actor_id, event_type, detail)
      VALUES (NEW.id, auth.uid(), 'priority_changed', jsonb_build_object('from', OLD.priority, 'to', NEW.priority));
    END IF;
    IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
      INSERT INTO public.support_ticket_events(ticket_id, actor_id, event_type, detail)
      VALUES (NEW.id, auth.uid(), 'due_date_changed', jsonb_build_object('due_at', NEW.due_at));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_support_ticket_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_support_ticket_event ON public.support_tickets;
CREATE TRIGGER capture_support_ticket_event
  AFTER INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.capture_support_ticket_event();

CREATE OR REPLACE FUNCTION public.admin_update_support_ticket(
  p_ticket_id UUID, p_status TEXT, p_reply TEXT DEFAULT NULL,
  p_assigned_to UUID DEFAULT NULL, p_priority TEXT DEFAULT NULL, p_due_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('pendiente','en_revision','resuelto')
     OR (p_priority IS NOT NULL AND p_priority NOT IN ('low','normal','high','urgent'))
     OR (p_reply IS NOT NULL AND char_length(p_reply) > 5000) THEN
    RAISE EXCEPTION 'Invalid support case update' USING ERRCODE='22023';
  END IF;
  IF p_assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=p_assigned_to AND role::TEXT IN ('admin','superadmin')
  ) THEN RAISE EXCEPTION 'Case owner must be an administrator' USING ERRCODE='22023'; END IF;
  UPDATE public.support_tickets SET
    status = p_status,
    admin_reply = COALESCE(NULLIF(BTRIM(p_reply), ''), admin_reply),
    assigned_to = p_assigned_to,
    priority = COALESCE(p_priority, priority),
    due_at = p_due_at,
    resolved_at = CASE WHEN p_status = 'resuelto' THEN COALESCE(resolved_at, NOW()) ELSE NULL END
  WHERE id = p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support case not found' USING ERRCODE='P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_support_ticket(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_support_ticket(UUID,TEXT,TEXT,UUID,TEXT,TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_enqueue_control_report(
  p_period_start DATE, p_period_end DATE, p_email_requested BOOLEAN DEFAULT FALSE, p_email_to TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT; v_id UUID;
BEGIN
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start
     OR p_period_end - p_period_start > 366 THEN RAISE EXCEPTION 'Report range must be between 1 and 367 days' USING ERRCODE='22023'; END IF;
  IF p_email_requested AND COALESCE(NULLIF(BTRIM(p_email_to), ''), '') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'A valid report destination email is required' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.admin_control_report_jobs(requested_by,report_kind,period_start,period_end,email_requested,email_to)
  VALUES(auth.uid(),'manual',p_period_start,p_period_end,p_email_requested,NULLIF(BTRIM(p_email_to),'')) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_enqueue_control_report(DATE,DATE,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_control_report(DATE,DATE,BOOLEAN,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_daily_control_report()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_day DATE := (NOW() AT TIME ZONE 'America/Bogota')::DATE - 1; v_id UUID;
BEGIN
  INSERT INTO public.admin_control_report_jobs(report_kind,period_start,period_end,daily_key,email_requested,email_to)
  VALUES('daily',v_day,v_day,v_day,TRUE,COALESCE((SELECT np.admin_alert_email FROM public.notification_preferences np
    JOIN public.profiles p ON p.id=np.user_id WHERE p.role::TEXT IN ('admin','superadmin') AND np.email_enabled ORDER BY p.created_at LIMIT 1),
    current_setting('app.settings.admin_alert_email',TRUE)))
  ON CONFLICT (daily_key) WHERE report_kind='daily' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.admin_control_report_jobs WHERE report_kind='daily' AND daily_key=v_day; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_daily_control_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_control_report() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_admin_control_report(p_job_id UUID DEFAULT NULL)
RETURNS SETOF public.admin_control_report_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.admin_control_report_jobs
    WHERE (p_job_id IS NULL OR id=p_job_id)
      AND (status='queued' OR (status='processing' AND started_at < NOW()-INTERVAL '15 minutes'))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.admin_control_report_jobs j SET status='processing', started_at=NOW(), attempts=attempts+1, error_code=NULL
  FROM picked WHERE j.id=picked.id RETURNING j.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_admin_control_report(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_control_report(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_control_report_metrics(p_period_start DATE, p_period_end DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT; v_from TIMESTAMPTZ; v_to TIMESTAMPTZ; v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    SELECT role::TEXT INTO v_role FROM public.profiles WHERE id=auth.uid();
    IF COALESCE(v_role,'') NOT IN ('admin','superadmin') THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start OR p_period_end-p_period_start > 366 THEN
    RAISE EXCEPTION 'Invalid report period' USING ERRCODE='22023';
  END IF;
  v_from := p_period_start::TIMESTAMP AT TIME ZONE 'America/Bogota';
  v_to := (p_period_end + 1)::TIMESTAMP AT TIME ZONE 'America/Bogota';
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from',p_period_start,'to',p_period_end,'timezone','America/Bogota'),
    'orders', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.orders o WHERE o.created_at>=v_from AND o.created_at<v_to),
      'gross_cop', (SELECT COALESCE(SUM(o.total_amount),0) FROM public.orders o WHERE o.created_at>=v_from AND o.created_at<v_to AND o.status::TEXT NOT IN ('pendiente','cancelado')),
      'by_status', COALESCE((SELECT jsonb_object_agg(s.status,s.total) FROM (SELECT o.status::TEXT status,COUNT(*) total FROM public.orders o WHERE o.created_at>=v_from AND o.created_at<v_to GROUP BY o.status::TEXT) s),'{}'::JSONB)
    ),
    'payments', COALESCE((SELECT jsonb_object_agg(s.status,jsonb_build_object('count',s.total,'cop',s.amount_cop)) FROM (
      SELECT UPPER(t.status) status,COUNT(*) total,COALESCE(SUM(t.amount_in_cents),0)/100.0 amount_cop
      FROM public.wompi_transactions t WHERE COALESCE(t.applied_at,t.created_at)>=v_from AND COALESCE(t.applied_at,t.created_at)<v_to
      GROUP BY UPPER(t.status)) s),'{}'::JSONB),
    'refunds', jsonb_build_object(
      'count',(SELECT COUNT(*) FROM public.order_refunds r WHERE r.created_at>=v_from AND r.created_at<v_to),
      'approved_cop',(SELECT COALESCE(SUM(r.amount_in_cents),0)/100.0 FROM public.order_refunds r WHERE r.created_at>=v_from AND r.created_at<v_to AND r.status='approved'),
      'pending_count',(SELECT COUNT(*) FROM public.order_refunds r WHERE r.created_at>=v_from AND r.created_at<v_to AND r.status IN ('requested','submitting','pending','uncertain'))
    ),
    'discounts',jsonb_build_object('cop',NULL,'availability','not_recorded_in_schema'),
    'business_commissions',jsonb_build_object(
      'cop',(SELECT COALESCE(SUM(c.amount_cop),0) FROM public.business_commission_ledger c WHERE c.captured_at>=v_from AND c.captured_at<v_to),
      'coverage_from',(SELECT MIN(captured_at)::DATE FROM public.business_commission_ledger),
      'note','Registro disponible desde la instalación de 0039; no representa utilidad neta.'
    ),
    'businesses',COALESCE((SELECT jsonb_agg(jsonb_build_object('business_id',b.id,'name',b.store_name,'orders',x.orders,'gross_cop',x.gross_cop,'settlement_net_cop',s.net_cop,'settlement_pending_cop',s.pending_cop) ORDER BY x.gross_cop DESC)
      FROM public.businesses b
      LEFT JOIN LATERAL (SELECT COUNT(*) orders,COALESCE(SUM(o.product_subtotal_cop),0) gross_cop FROM public.orders o WHERE o.business_id=b.id AND o.created_at>=v_from AND o.created_at<v_to AND o.status::TEXT NOT IN ('pendiente','cancelado')) x ON TRUE
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(i.amount_cop) FILTER (WHERE i.status='paid'),0) net_cop,COALESCE(SUM(i.amount_cop) FILTER (WHERE i.status IN ('available','reserved')),0) pending_cop FROM public.business_settlement_items i JOIN public.orders o ON o.id=i.order_id WHERE i.business_id=b.id AND o.created_at>=v_from AND o.created_at<v_to) s ON TRUE
      WHERE x.orders>0),'[]'::JSONB),
    'drivers',COALESCE((SELECT jsonb_agg(jsonb_build_object('driver_id',d.id,'name',p.full_name,'deliveries',(SELECT COUNT(*) FROM public.orders o WHERE o.driver_id=d.id AND o.status::TEXT='entregado' AND o.created_at>=v_from AND o.created_at<v_to),'earned_cop',(SELECT COALESCE(SUM(e.amount_cop),0) FROM public.driver_wallet_entries e WHERE e.driver_id=d.id AND e.entry_type='earning' AND e.created_at>=v_from AND e.created_at<v_to),'withdrawn_cop',(SELECT COALESCE(SUM(w.amount_cop),0) FROM public.driver_withdrawals w WHERE w.driver_id=d.id AND w.status='paid' AND w.paid_at>=v_from AND w.paid_at<v_to)) ORDER BY p.full_name)
      FROM public.drivers d JOIN public.profiles p ON p.id=d.profile_id
      WHERE EXISTS(SELECT 1 FROM public.orders o WHERE o.driver_id=d.id AND o.created_at>=v_from AND o.created_at<v_to)
        OR EXISTS(SELECT 1 FROM public.driver_wallet_entries e WHERE e.driver_id=d.id AND e.created_at>=v_from AND e.created_at<v_to)),'[]'::JSONB),
    'withdrawals',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',s.status,'count',s.total,'cop',s.amount_cop)) FROM (SELECT w.status,COUNT(*) total,COALESCE(SUM(w.amount_cop),0) amount_cop FROM public.driver_withdrawals w WHERE w.created_at>=v_from AND w.created_at<v_to GROUP BY w.status) s),'[]'::JSONB),
    'business_payouts',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',s.status,'count',s.total,'cop',s.amount_cop)) FROM (SELECT p.status,COUNT(*) total,COALESCE(SUM(p.amount_cop),0) amount_cop FROM public.business_payouts p WHERE p.created_at>=v_from AND p.created_at<v_to GROUP BY p.status) s),'[]'::JSONB),
     'peak_hours',COALESCE((SELECT jsonb_agg(jsonb_build_object('hour',s.hour_of_day,'orders',s.total) ORDER BY s.hour_of_day) FROM (SELECT EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'America/Bogota'))::INTEGER AS hour_of_day,COUNT(*) AS total FROM public.orders o WHERE o.created_at>=v_from AND o.created_at<v_to GROUP BY 1) s),'[]'::JSONB),
    'reconciliation',jsonb_build_object(
      'approved_payment_order_mismatches',(SELECT COUNT(*) FROM (SELECT o.id,o.total_amount,COALESCE(SUM(t.amount_in_cents),0)/100.0 paid FROM public.orders o JOIN public.wompi_transactions t ON t.order_id=o.id AND UPPER(t.status)='APPROVED' WHERE o.created_at>=v_from AND o.created_at<v_to GROUP BY o.id,o.total_amount HAVING ABS(o.total_amount-COALESCE(SUM(t.amount_in_cents),0)/100.0)>1) q),
      'paid_orders_without_approved_payment',(SELECT COUNT(*) FROM public.orders o WHERE o.created_at>=v_from AND o.created_at<v_to AND o.status::TEXT NOT IN ('pendiente','cancelado') AND o.payment_method::TEXT='wompi' AND NOT EXISTS(SELECT 1 FROM public.wompi_transactions t WHERE t.order_id=o.id AND UPPER(t.status)='APPROVED')),
      'open_payment_exceptions',(SELECT COUNT(*) FROM public.order_payment_attempts a WHERE a.status='reconciliation_required' AND a.updated_at>=v_from AND a.updated_at<v_to),
      'open_refund_exceptions',(SELECT COUNT(*) FROM public.order_refunds r WHERE r.status IN ('requested','submitting','pending','uncertain','error','declined') AND r.updated_at>=v_from AND r.updated_at<v_to),
      'open_business_payout_exceptions',(SELECT COUNT(*) FROM public.business_payouts p WHERE (p.status IN ('needs_review','failed') OR (p.status IN ('processing','pending') AND p.updated_at<NOW()-INTERVAL '24 hours')) AND p.updated_at>=v_from AND p.updated_at<v_to),
      'open_driver_payout_exceptions',(SELECT COUNT(*) FROM public.payout_transactions p WHERE p.status IN ('needs_review','failed') AND p.updated_at>=v_from AND p.updated_at<v_to)
    ),
    'data_quality',jsonb_build_array('El esquema no registra descuentos ni costos de producto/operación; no se calcula utilidad real.','Las comisiones históricas anteriores a la instalación del ledger no tienen conciliación individual.')
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_control_report_metrics(DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_control_report_metrics(DATE,DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notification_unread_count()
RETURNS INTEGER LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COUNT(*)::INTEGER FROM public.user_notifications WHERE recipient_id=auth.uid() AND read_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.notification_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_unread_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.register_notification_device(p_token TEXT, p_platform TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_token IS NULL OR char_length(p_token) NOT BETWEEN 20 AND 255 OR p_platform NOT IN ('ios','android') THEN
    RAISE EXCEPTION 'Invalid notification device' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.notification_devices(user_id,expo_push_token,platform,updated_at,disabled_at)
  VALUES(auth.uid(),p_token,p_platform,NOW(),NULL)
  ON CONFLICT(expo_push_token) DO UPDATE SET
    user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, updated_at=NOW(), disabled_at=NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.register_notification_device(TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_notification_device(TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.unregister_notification_device(p_token TEXT)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_temp AS $$
  DELETE FROM public.notification_devices WHERE user_id=auth.uid() AND expo_push_token=p_token
$$;
REVOKE ALL ON FUNCTION public.unregister_notification_device(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_notification_device(TEXT) TO authenticated;

-- The driver assignment remains a distinct event; it no longer creates a second "Pedido listo"
-- alert after the client already received that status.
CREATE OR REPLACE FUNCTION public.notify_order_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_business_profile UUID;
BEGIN
  SELECT b.profile_id INTO v_business_profile FROM public.businesses b WHERE b.id=NEW.business_id;
  IF TG_OP='INSERT' THEN
    IF NEW.status::TEXT='pagado' THEN
      PERFORM public.notification_insert(v_business_profile,'business_new_order','Nuevo pedido','Tienes un pedido nuevo. Abre IstmiYa para revisarlo.','order:'||NEW.id||':business_new',NEW.id);
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status::TEXT='pagado' THEN
      PERFORM public.notification_insert(v_business_profile,'business_new_order','Nuevo pedido','Tienes un pedido nuevo. Abre IstmiYa para revisarlo.','order:'||NEW.id||':business_new',NEW.id);
    ELSIF NEW.status::TEXT='preparando' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_preparing','Pedido aceptado','El negocio aceptó tu pedido y comenzó a prepararlo.','order:'||NEW.id||':preparando',NEW.id);
    ELSIF NEW.status::TEXT='listo_para_repartidor' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_ready','Pedido listo','Tu pedido está listo.','order:'||NEW.id||':listo_para_repartidor',NEW.id);
      IF NEW.driver_id IS NULL THEN
        INSERT INTO public.user_notifications(recipient_id,event_key,title,body,order_id,idempotency_key)
        SELECT d.profile_id,'order_available','Pedido disponible','Hay un pedido disponible cerca. Abre IstmiYa para revisarlo.',NEW.id,'order:'||NEW.id||':available:'||d.profile_id
        FROM public.drivers d JOIN public.profiles p ON p.id=d.profile_id
        JOIN public.driver_verifications dv ON dv.driver_id=d.id AND dv.verification_status='aprobado'
        WHERE d.is_available AND p.role::TEXT='repartidor' ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    ELSIF NEW.status::TEXT='recogido' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_picked_up','Pedido recogido','El repartidor recogió tu pedido.','order:'||NEW.id||':recogido',NEW.id);
    ELSIF NEW.status::TEXT='en_camino' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_on_the_way','Pedido en camino','Tu pedido está en camino.','order:'||NEW.id||':en_camino',NEW.id);
    END IF;
  END IF;
  IF NEW.driver_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    PERFORM public.notification_insert(NEW.client_id,'driver_assigned','Repartidor asignado','Un repartidor fue asignado a tu pedido.','order:'||NEW.id||':driver:'||NEW.driver_id,NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_delayed_order_notifications()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH delayed AS (
    SELECT o.id,o.client_id,o.business_id,o.status::TEXT AS status,b.profile_id AS business_profile_id
    FROM public.orders o JOIN public.businesses b ON b.id=o.business_id
    WHERE (o.status::TEXT='pagado' AND o.created_at<NOW()-INTERVAL '15 minutes')
       OR (o.status::TEXT='preparando' AND o.business_prep_eta_at IS NOT NULL AND o.business_prep_eta_at<NOW()-INTERVAL '10 minutes')
       OR (o.status::TEXT='listo_para_repartidor' AND o.driver_id IS NULL AND o.created_at<NOW()-INTERVAL '15 minutes')
  ), recipients AS (
    SELECT d.id AS order_id,d.status,d.client_id AS recipient_id,'order_delayed:'||d.id||':'||d.status||':client' AS idem,'Pedido demorado' AS title,'Tu pedido lleva más tiempo del esperado. El equipo está revisando el avance.' AS body FROM delayed d
    UNION ALL
    SELECT d.id,d.status,d.business_profile_id,'order_delayed:'||d.id||':'||d.status||':business','Pedido que requiere seguimiento','Un pedido lleva más tiempo del esperado en esta etapa.' FROM delayed d WHERE d.business_profile_id IS NOT NULL
    UNION ALL
    SELECT d.id,d.status,p.id,'order_delayed:'||d.id||':'||d.status||':admin','Pedido demorado requiere atención','Un pedido lleva más tiempo del esperado y requiere seguimiento.' FROM delayed d CROSS JOIN public.profiles p WHERE p.role::TEXT IN ('admin','superadmin')
  ), inserted AS (
    INSERT INTO public.user_notifications(recipient_id,event_key,title,body,order_id,idempotency_key)
    SELECT r.recipient_id,'order_delayed',r.title,r.body,r.order_id,r.idem FROM (
      SELECT * FROM recipients
      UNION ALL
      SELECT d.id,d.status,dr.profile_id,'order_delayed:'||d.id||':'||d.status||':driver:'||dr.profile_id,
        'Pedido disponible requiere seguimiento','Hay un pedido pendiente de asignaciÃ³n desde hace varios minutos.'
      FROM delayed d JOIN public.drivers dr ON TRUE
      JOIN public.profiles dp ON dp.id=dr.profile_id AND dp.role::TEXT='repartidor'
      JOIN public.driver_verifications dv ON dv.driver_id=dr.id AND dv.verification_status='aprobado'
      WHERE d.status='listo_para_repartidor' AND dr.is_available
    ) r
    WHERE r.recipient_id IS NOT NULL ON CONFLICT(idempotency_key) DO NOTHING RETURNING id
  ) SELECT COUNT(*)::INTEGER INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_delayed_order_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_delayed_order_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.notify_wompi_reconciliation_exception()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_key TEXT; v_event TEXT;
BEGIN
  IF TG_TABLE_NAME='order_payment_attempts' THEN
    IF NEW.status NOT IN ('reconciliation_required','failed') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
    v_key := 'wompi-payment:'||NEW.order_id||':'||NEW.status;
    v_event := 'Pago Wompi requiere conciliación';
  ELSIF TG_TABLE_NAME='order_refunds' THEN
    IF NEW.status NOT IN ('uncertain','error','declined') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
    v_key := 'wompi-refund:'||NEW.id||':'||NEW.status;
    v_event := 'Reembolso Wompi requiere revisión';
  ELSIF TG_TABLE_NAME='business_payouts' THEN
    IF NEW.status NOT IN ('needs_review','failed') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
    v_key := 'wompi-business-payout:'||NEW.id||':'||NEW.status;
    v_event := 'Liquidación de negocio requiere revisión';
  ELSIF TG_TABLE_NAME='payout_transactions' THEN
    IF NEW.status NOT IN ('needs_review','failed') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
    v_key := 'wompi-driver-payout:'||NEW.id||':'||NEW.status;
    v_event := 'Retiro de repartidor requiere revisión';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.user_notifications(recipient_id,event_key,title,body,idempotency_key)
  SELECT p.id,'financial_exception',v_event,'Una operación de Wompi requiere conciliación en el panel financiero.',v_key||':admin:'||p.id
  FROM public.profiles p WHERE p.role::TEXT IN ('admin','superadmin')
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_wompi_reconciliation_exception() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_wompi_payment_exception ON public.order_payment_attempts;
CREATE TRIGGER notify_wompi_payment_exception AFTER INSERT OR UPDATE OF status ON public.order_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.notify_wompi_reconciliation_exception();
DROP TRIGGER IF EXISTS notify_wompi_refund_exception ON public.order_refunds;
CREATE TRIGGER notify_wompi_refund_exception AFTER INSERT OR UPDATE OF status ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.notify_wompi_reconciliation_exception();
DROP TRIGGER IF EXISTS notify_wompi_business_payout_exception ON public.business_payouts;
CREATE TRIGGER notify_wompi_business_payout_exception AFTER INSERT OR UPDATE OF status ON public.business_payouts
  FOR EACH ROW EXECUTE FUNCTION public.notify_wompi_reconciliation_exception();
DROP TRIGGER IF EXISTS notify_wompi_driver_payout_exception ON public.payout_transactions;
CREATE TRIGGER notify_wompi_driver_payout_exception AFTER INSERT OR UPDATE OF status ON public.payout_transactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_wompi_reconciliation_exception();

CREATE OR REPLACE FUNCTION public.scan_wompi_reconciliation_exceptions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH exceptions AS (
    SELECT 'wompi-order-payment-missing:'||o.id AS event_key,'Pago Wompi sin confirmar' AS title,
      'El pedido lleva más de 10 minutos sin una transacción aprobada en Wompi.' AS body
    FROM public.orders o
    WHERE o.payment_method::TEXT='wompi' AND o.status::TEXT NOT IN ('pendiente','cancelado')
      AND o.created_at<NOW()-INTERVAL '10 minutes' AND o.created_at>=NOW()-INTERVAL '24 hours'
      AND NOT EXISTS (SELECT 1 FROM public.wompi_transactions t WHERE t.order_id=o.id AND UPPER(t.status)='APPROVED')
    UNION ALL
    SELECT 'wompi-payment-link-pending:'||a.order_id,'Pago Wompi pendiente por más de 20 minutos',
      'El enlace de pago no tiene una transacción final registrada después de 20 minutos.'
    FROM public.order_payment_attempts a
    WHERE a.status='ready' AND a.created_at<NOW()-INTERVAL '20 minutes' AND a.created_at>=NOW()-INTERVAL '24 hours'
      AND NOT EXISTS (SELECT 1 FROM public.wompi_transactions t WHERE t.order_id=a.order_id)
    UNION ALL
    SELECT 'wompi-payment-mismatch:'||o.id,'Monto Wompi no coincide con el pedido',
      'La suma de las transacciones aprobadas difiere del total del pedido.'
    FROM public.orders o JOIN public.wompi_transactions t ON t.order_id=o.id AND UPPER(t.status)='APPROVED'
    WHERE o.created_at>=NOW()-INTERVAL '24 hours'
    GROUP BY o.id,o.total_amount
    HAVING ABS(o.total_amount-COALESCE(SUM(t.amount_in_cents),0)/100.0)>1
  ), inserted AS (
    INSERT INTO public.user_notifications(recipient_id,event_key,title,body,idempotency_key)
    SELECT p.id,'financial_exception',e.title,e.body,e.event_key||':admin:'||p.id
    FROM exceptions e CROSS JOIN public.profiles p WHERE p.role::TEXT IN ('admin','superadmin')
    ON CONFLICT(idempotency_key) DO NOTHING RETURNING id
  ) SELECT COUNT(*)::INTEGER INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.scan_wompi_reconciliation_exceptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_wompi_reconciliation_exceptions() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_control_report_edge(p_action TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions, pg_temp AS $$
DECLARE v_request_id BIGINT; v_url TEXT; v_service_key TEXT; v_secret TEXT;
BEGIN
  IF p_action NOT IN ('daily','dispatch') THEN RAISE EXCEPTION 'Invalid scheduled action'; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='istmiya_project_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name='istmiya_supabase_secret_key';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name=
    CASE p_action WHEN 'daily' THEN 'istmiya_control_report_cron_secret' ELSE 'istmiya_notification_dispatch_secret' END;
  IF NULLIF(v_url,'') IS NULL OR NULLIF(v_service_key,'') IS NULL OR NULLIF(v_secret,'') IS NULL THEN
    RAISE WARNING 'IstmiYa scheduled % skipped: required Vault secrets are missing', p_action;
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := rtrim(v_url,'/') || '/functions/v1/' || CASE p_action WHEN 'daily' THEN 'control-istmiya-reports' ELSE 'dispatch-notifications' END,
    headers := jsonb_build_object('Content-Type','application/json','apikey',v_service_key,'Authorization','Bearer '||v_secret),
    body := jsonb_build_object('action',CASE p_action WHEN 'daily' THEN 'daily' ELSE NULL END),
    timeout_milliseconds := 10000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_control_report_edge(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_control_report_edge(TEXT) TO postgres;

-- Private object storage. PDF access is via short-lived signed URLs returned to an Admin.
INSERT INTO storage.buckets (id,name,public)
VALUES ('admin-control-reports','admin-control-reports',FALSE)
ON CONFLICT (id) DO UPDATE SET public=FALSE;

DO $$
DECLARE v_job BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    FOR v_job IN SELECT jobid FROM cron.job WHERE jobname='istmiya-control-delayed-orders'
    LOOP PERFORM cron.unschedule(v_job); END LOOP;
    PERFORM cron.schedule('istmiya-control-delayed-orders','*/5 * * * *','SELECT public.enqueue_delayed_order_notifications()');
    FOR v_job IN SELECT jobid FROM cron.job WHERE jobname='istmiya-wompi-reconciliation-notices'
    LOOP PERFORM cron.unschedule(v_job); END LOOP;
    PERFORM cron.schedule('istmiya-wompi-reconciliation-notices','*/5 * * * *','SELECT public.scan_wompi_reconciliation_exceptions()');
    FOR v_job IN SELECT jobid FROM cron.job WHERE jobname='istmiya-control-daily-report-enqueue'
    LOOP PERFORM cron.unschedule(v_job); END LOOP;
    PERFORM cron.schedule('istmiya-control-daily-report-enqueue','15 8 * * *', 'SELECT public.invoke_control_report_edge(''daily'')');
    FOR v_job IN SELECT jobid FROM cron.job WHERE jobname='istmiya-notification-dispatch-every-minute'
    LOOP PERFORM cron.unschedule(v_job); END LOOP;
    PERFORM cron.schedule('istmiya-notification-dispatch-every-minute','* * * * *', 'SELECT public.invoke_control_report_edge(''dispatch'')');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
