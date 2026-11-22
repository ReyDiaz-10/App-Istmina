-- Persisted in-app and push notification outbox. Apply only after migrations 0001-0033.
BEGIN;

CREATE TABLE public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ,
  email_requested BOOLEAN NOT NULL DEFAULT false,
  email_sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  CONSTRAINT user_notifications_event_key_check CHECK (event_key ~ '^[a-z0-9_]+$')
);
CREATE INDEX user_notifications_recipient_recent_idx ON public.user_notifications(recipient_id, created_at DESC);
CREATE INDEX user_notifications_pending_dispatch_idx ON public.user_notifications(next_attempt_at) WHERE push_sent_at IS NULL;
ALTER TABLE public.user_notifications ADD COLUMN dispatching_until TIMESTAMPTZ;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
CREATE POLICY user_notifications_owner_read ON public.user_notifications
  FOR SELECT TO authenticated USING (recipient_id = auth.uid());
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id UUID)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE public.user_notifications SET read_at=COALESCE(read_at,now()) WHERE id=p_id AND recipient_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;

CREATE TABLE public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  email_profile_pending BOOLEAN NOT NULL DEFAULT true,
  email_inappropriate_language BOOLEAN NOT NULL DEFAULT true,
  email_financial_exception BOOLEAN NOT NULL DEFAULT true,
  admin_alert_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_preferences TO authenticated;
CREATE POLICY notification_preferences_owner_read ON public.notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.notification_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);
CREATE INDEX notification_devices_user_idx ON public.notification_devices(user_id) WHERE disabled_at IS NULL;
ALTER TABLE public.notification_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_devices TO authenticated;
CREATE POLICY notification_devices_owner ON public.notification_devices
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.claim_notification_batch(p_channel TEXT, p_limit INTEGER DEFAULT 100)
RETURNS SETOF public.user_notifications LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_channel NOT IN ('push','email') THEN RAISE EXCEPTION 'Invalid notification channel'; END IF;
  RETURN QUERY
  WITH batch AS (
    SELECT n.id FROM public.user_notifications n
    WHERE ((p_channel='push' AND n.push_sent_at IS NULL) OR (p_channel='email' AND n.email_requested AND n.email_sent_at IS NULL))
      AND n.next_attempt_at <= now() AND (n.dispatching_until IS NULL OR n.dispatching_until < now())
    ORDER BY n.created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),100)
  )
  UPDATE public.user_notifications n SET dispatching_until=now()+interval '2 minutes'
  FROM batch WHERE n.id=batch.id RETURNING n.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_notification_batch(TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.release_notification_batch(p_id UUID, p_channel TEXT, p_attempts INTEGER, p_error TEXT, p_delay_seconds INTEGER, p_sent BOOLEAN)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE public.user_notifications SET
    attempts=p_attempts,
    push_sent_at=CASE WHEN p_sent AND p_channel='push' THEN now() ELSE push_sent_at END,
    email_sent_at=CASE WHEN p_sent AND p_channel='email' THEN now() ELSE email_sent_at END,
    dispatching_until=NULL,
    last_error=CASE WHEN p_sent THEN NULL ELSE left(p_error,300) END,
    next_attempt_at=CASE WHEN p_sent THEN next_attempt_at ELSE now()+make_interval(secs=>GREATEST(p_delay_seconds,30)) END
  WHERE id=p_id
$$;
REVOKE ALL ON FUNCTION public.release_notification_batch(UUID,TEXT,INTEGER,TEXT,INTEGER,BOOLEAN) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.notification_insert(
  p_recipient UUID, p_event TEXT, p_title TEXT, p_body TEXT, p_key TEXT, p_order UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_recipient IS NULL OR p_recipient = '00000000-0000-0000-0000-000000000000'::UUID THEN RETURN; END IF;
  INSERT INTO public.user_notifications(recipient_id,event_key,title,body,order_id,idempotency_key)
  VALUES (p_recipient,p_event,p_title,p_body,p_order,p_key) ON CONFLICT (idempotency_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.notification_insert(UUID,TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_order_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
      PERFORM public.notification_insert(NEW.client_id,'order_preparing','Pedido aceptado','El negocio aceptÃ³ tu pedido y comenzÃ³ a prepararlo.','order:'||NEW.id||':preparando',NEW.id);
    ELSIF NEW.status::TEXT='listo_para_repartidor' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_ready','Pedido listo','Tu pedido estÃ¡ listo.','order:'||NEW.id||':listo_para_repartidor',NEW.id);
      IF NEW.driver_id IS NULL THEN
        INSERT INTO public.user_notifications(recipient_id,event_key,title,body,order_id,idempotency_key)
        SELECT d.profile_id,'order_available','Pedido disponible','Hay un pedido disponible cerca. Abre IstmiYa para revisarlo.',NEW.id,'order:'||NEW.id||':available:'||d.profile_id
        FROM public.drivers d JOIN public.profiles p ON p.id=d.profile_id
        JOIN public.driver_verifications dv ON dv.driver_id=d.id AND dv.verification_status='aprobado'
        WHERE d.is_available AND p.role::TEXT='repartidor' ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    ELSIF NEW.status::TEXT='repartidor_asignado' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_ready','Pedido listo','Tu pedido estÃ¡ listo.','order:'||NEW.id||':repartidor_asignado',NEW.id);
    ELSIF NEW.status::TEXT='recogido' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_picked_up','Pedido recogido','El repartidor recogiÃ³ tu pedido.','order:'||NEW.id||':recogido',NEW.id);
    ELSIF NEW.status::TEXT='en_camino' THEN
      PERFORM public.notification_insert(NEW.client_id,'order_on_the_way','Pedido en camino','Tu pedido estÃ¡ en camino.','order:'||NEW.id||':en_camino',NEW.id);
    END IF;
  END IF;
  IF NEW.driver_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    PERFORM public.notification_insert(NEW.client_id,'driver_assigned','Repartidor asignado','Un repartidor fue asignado a tu pedido.','order:'||NEW.id||':driver:'||NEW.driver_id,NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_order_change AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_order_change();

CREATE OR REPLACE FUNCTION public.notify_admin_profile_event(p_profile_id UUID, p_event TEXT, p_title TEXT, p_key_prefix TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.user_notifications(recipient_id,event_key,title,body,idempotency_key,email_requested)
  SELECT p.id,p_event,p_title,CASE WHEN p_event='customer_registered' THEN 'Se registro un nuevo cliente.' ELSE 'Hay un perfil nuevo pendiente de revision.' END,p_key_prefix||p_profile_id||':admin:'||p.id,
    CASE WHEN p_event='profile_review_pending' THEN COALESCE(np.email_profile_pending,np.email_enabled,true) ELSE false END
  FROM public.profiles p LEFT JOIN public.notification_preferences np ON np.user_id=p.id WHERE p.role::TEXT='admin' ON CONFLICT(idempotency_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.notify_admin_profile_event(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.notify_pending_profile_verification() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile_id UUID;
BEGIN
  IF NEW.verification_status='pendiente' THEN
    SELECT b.profile_id INTO v_profile_id FROM public.businesses b WHERE b.id=NEW.business_id;
    PERFORM public.notify_admin_profile_event(v_profile_id,'profile_review_pending','Perfil pendiente de revision','profile-review:');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_business_pending_verification AFTER INSERT OR UPDATE ON public.business_verifications
FOR EACH ROW WHEN (NEW.verification_status='pendiente')
EXECUTE FUNCTION public.notify_pending_profile_verification();
CREATE OR REPLACE FUNCTION public.notify_pending_driver_verification() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile_id UUID;
BEGIN
  IF NEW.verification_status='pendiente' THEN
    SELECT d.profile_id INTO v_profile_id FROM public.drivers d WHERE d.id=NEW.driver_id;
    PERFORM public.notify_admin_profile_event(v_profile_id,'profile_review_pending','Perfil pendiente de revision','profile-review:');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_driver_pending_verification AFTER INSERT OR UPDATE ON public.driver_verifications
FOR EACH ROW WHEN (NEW.verification_status='pendiente')
EXECUTE FUNCTION public.notify_pending_driver_verification();
CREATE OR REPLACE FUNCTION public.notify_customer_profile_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.role::TEXT='cliente' THEN PERFORM public.notify_admin_profile_event(NEW.id,'customer_registered','Nuevo cliente','customer-created:'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_customer_profile_insert AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.notify_customer_profile_insert();
CREATE OR REPLACE FUNCTION public.notify_feedback_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.category IN ('elogio','sugerencia') THEN
    PERFORM public.notification_insert(NEW.recipient_id,'feedback_'||NEW.category,'Nuevo comentario','Recibiste un comentario. Abre IstmiYa para revisarlo.','feedback:'||NEW.id,NEW.order_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_feedback_insert AFTER INSERT ON public.delivery_order_feedback FOR EACH ROW EXECUTE FUNCTION public.notify_feedback_insert();

CREATE OR REPLACE FUNCTION public.notify_blocked_chat() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.moderation_status='bloqueado' THEN
    INSERT INTO public.user_notifications(recipient_id,event_key,title,body,idempotency_key,email_requested)
    SELECT p.id,'inappropriate_language','RevisiÃ³n de moderaciÃ³n','Un mensaje requiere revisiÃ³n.','moderation:'||NEW.id||':admin:'||p.id,COALESCE(np.email_inappropriate_language,np.email_enabled,true)
    FROM public.profiles p LEFT JOIN public.notification_preferences np ON np.user_id=p.id WHERE p.role::TEXT='admin' ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_blocked_chat AFTER INSERT ON public.chats FOR EACH ROW EXECUTE FUNCTION public.notify_blocked_chat();

CREATE OR REPLACE FUNCTION public.notify_financial_exception() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.user_notifications(recipient_id,event_key,title,body,idempotency_key,email_requested)
  SELECT p.id,'financial_exception','RevisiÃ³n financiera','Una operaciÃ³n financiera requiere revisiÃ³n.','finance-exception:'||NEW.id||':admin:'||p.id,COALESCE(np.email_financial_exception,np.email_enabled,true)
  FROM public.profiles p LEFT JOIN public.notification_preferences np ON np.user_id=p.id WHERE p.role::TEXT='admin' ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF to_regclass('public.admin_financial_exception_reviews') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER notify_financial_review AFTER INSERT ON public.admin_financial_exception_reviews FOR EACH ROW EXECUTE FUNCTION public.notify_financial_exception()';
  END IF;
  IF to_regclass('public.driver_withdrawal_exceptions') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER notify_withdrawal_exception AFTER INSERT ON public.driver_withdrawal_exceptions FOR EACH ROW EXECUTE FUNCTION public.notify_financial_exception()';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_driver_money_received() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_recipient UUID;
BEGIN
  SELECT d.profile_id INTO v_recipient FROM public.drivers d WHERE d.id=NEW.driver_id;
  PERFORM public.notification_insert(v_recipient,'money_received','Ingreso confirmado','Se confirmÃ³ un ingreso en tu cuenta.','money:driver_wallet_entries:'||NEW.id,NULL);
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.notify_business_money_received() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_recipient UUID;
BEGIN
  SELECT b.profile_id INTO v_recipient FROM public.businesses b WHERE b.id=NEW.business_id;
  PERFORM public.notification_insert(v_recipient,'money_received','Ingreso confirmado','Se confirmÃ³ un ingreso en tu cuenta.','money:business_settlement_items:'||NEW.id,NULL);
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF to_regclass('public.driver_wallet_entries') IS NOT NULL THEN EXECUTE 'CREATE TRIGGER notify_driver_money AFTER INSERT ON public.driver_wallet_entries FOR EACH ROW WHEN (NEW.amount_cop > 0 AND NEW.entry_type=''earning'') EXECUTE FUNCTION public.notify_driver_money_received()'; END IF;
  IF to_regclass('public.business_settlement_items') IS NOT NULL THEN EXECUTE 'CREATE TRIGGER notify_business_money AFTER UPDATE OF status ON public.business_settlement_items FOR EACH ROW WHEN (NEW.status=''paid'' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.notify_business_money_received()'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_three_minute_eta() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count INTEGER:=0; v_order RECORD;
BEGIN
  FOR v_order IN SELECT id,client_id,driver_arrival_eta_at FROM public.orders
    WHERE status::TEXT='en_camino' AND driver_arrival_eta_at > now()+interval '2 minutes'
      AND driver_arrival_eta_at <= now()+interval '4 minutes'
  LOOP
    INSERT INTO public.user_notifications(recipient_id,event_key,title,body,order_id,idempotency_key)
    VALUES(v_order.client_id,'order_arrival_soon','Tu pedido llega pronto','Se estima la llegada de tu pedido en unos minutos.',v_order.id,'order:'||v_order.id||':eta:3m')
    ON CONFLICT(idempotency_key) DO NOTHING;
    IF FOUND THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.notify_three_minute_eta() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.notify_email_preferences(
  p_user UUID, p_profile_pending BOOLEAN, p_inappropriate_language BOOLEAN, p_financial_exception BOOLEAN, p_email TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.role::TEXT='admin') THEN
    RAISE EXCEPTION 'Only your own admin email preferences can be changed' USING ERRCODE='42501';
  END IF;
  IF p_email IS NOT NULL AND p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN RAISE EXCEPTION 'Invalid admin alert email'; END IF;
  INSERT INTO public.notification_preferences(user_id,email_enabled,email_profile_pending,email_inappropriate_language,email_financial_exception,admin_alert_email)
  VALUES(p_user,p_profile_pending OR p_inappropriate_language OR p_financial_exception,p_profile_pending,p_inappropriate_language,p_financial_exception,NULLIF(BTRIM(p_email),''))
  ON CONFLICT(user_id) DO UPDATE SET email_enabled=EXCLUDED.email_enabled,email_profile_pending=EXCLUDED.email_profile_pending,
    email_inappropriate_language=EXCLUDED.email_inappropriate_language,email_financial_exception=EXCLUDED.email_financial_exception,
    admin_alert_email=EXCLUDED.admin_alert_email,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.notify_email_preferences(UUID,BOOLEAN,BOOLEAN,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_email_preferences(UUID,BOOLEAN,BOOLEAN,BOOLEAN,TEXT) TO authenticated;CREATE OR REPLACE FUNCTION public.enqueue_admin_notification_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  NEW.email_requested := CASE NEW.event_key
    WHEN 'profile_review_pending' THEN COALESCE((SELECT np.email_profile_pending FROM public.notification_preferences np WHERE np.user_id=NEW.recipient_id),true)
    WHEN 'financial_exception' THEN COALESCE((SELECT np.email_financial_exception FROM public.notification_preferences np WHERE np.user_id=NEW.recipient_id),true)
    WHEN 'inappropriate_language' THEN COALESCE((SELECT np.email_inappropriate_language FROM public.notification_preferences np WHERE np.user_id=NEW.recipient_id),true)
    ELSE false END;
  RETURN NEW;
END $$;
CREATE TRIGGER enqueue_admin_notification_email BEFORE INSERT ON public.user_notifications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_admin_notification_email();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='istmiya-notification-eta') THEN
    PERFORM cron.schedule('istmiya-notification-eta','* * * * *','SELECT public.notify_three_minute_eta()');
    END IF;
  END IF;
END $$;

COMMIT;




