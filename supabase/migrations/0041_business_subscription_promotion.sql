BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_business_subscription_trials (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE RESTRICT,
  subscription_id UUID NOT NULL UNIQUE REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  granted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_business_subscription_trial_dates_check CHECK (ends_on >= starts_on)
);

ALTER TABLE public.admin_business_subscription_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_business_subscription_trials FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_business_subscription_trials TO authenticated;
DROP POLICY IF EXISTS admin_business_subscription_trials_admin_read
  ON public.admin_business_subscription_trials;
CREATE POLICY admin_business_subscription_trials_admin_read
  ON public.admin_business_subscription_trials
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_business_subscription_trial_status(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id UUID;
  v_business_status TEXT;
  v_profile_status TEXT;
  v_blocked_until TIMESTAMPTZ;
  v_deactivated_at TIMESTAMPTZ;
  v_verification_status TEXT;
  v_trial RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can inspect business promotions'
      USING ERRCODE = '42501';
  END IF;

  SELECT b.profile_id, b.status::TEXT, p.status, p.account_blocked_until,
         p.account_deactivated_at, v.verification_status
    INTO v_profile_id, v_business_status, v_profile_status, v_blocked_until,
         v_deactivated_at, v_verification_status
  FROM public.businesses b
  LEFT JOIN public.profiles p ON p.id = b.profile_id
  LEFT JOIN public.business_verifications v ON v.business_id = b.id
  WHERE b.id = p_business_id;

  IF NOT FOUND OR v_profile_id IS NULL THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'business_not_found');
  END IF;

  SELECT starts_on, ends_on, granted_at
    INTO v_trial
  FROM public.admin_business_subscription_trials
  WHERE business_id = p_business_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'eligible', FALSE,
      'reason', 'already_granted',
      'starts_on', v_trial.starts_on,
      'ends_on', v_trial.ends_on,
      'granted_at', v_trial.granted_at
    );
  END IF;

  IF v_verification_status IS DISTINCT FROM 'aprobado'
     OR v_business_status IS DISTINCT FROM 'activo' THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'business_not_approved');
  END IF;

  IF v_profile_status IS DISTINCT FROM 'activo'
     OR v_deactivated_at IS NOT NULL
     OR v_blocked_until > NOW() THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'account_not_active');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions s WHERE s.business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'subscription_history_exists');
  END IF;

  RETURN jsonb_build_object('eligible', TRUE, 'reason', 'eligible');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_business_subscription_trial_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_business_subscription_trial_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_business_subscription_trial(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status JSONB;
  v_profile_id UUID;
  v_subscription_id UUID;
  v_start DATE := CURRENT_DATE;
  v_end DATE := CURRENT_DATE + 6;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can grant business promotions'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.businesses b
  WHERE b.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND';
  END IF;

  v_status := public.admin_business_subscription_trial_status(p_business_id);
  IF COALESCE((v_status->>'eligible')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'PROMOTION_NOT_ELIGIBLE:%', COALESCE(v_status->>'reason', 'unknown');
  END IF;

  SELECT profile_id INTO v_profile_id
  FROM public.businesses
  WHERE id = p_business_id;

  INSERT INTO public.subscriptions (business_id, start_date, end_date, is_active)
  VALUES (p_business_id, v_start, v_end, TRUE)
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.admin_business_subscription_trials (
    business_id, subscription_id, granted_by, starts_on, ends_on
  )
  VALUES (p_business_id, v_subscription_id, auth.uid(), v_start, v_end);

  PERFORM public.notification_insert(
    v_profile_id,
    'business_trial_granted',
    'Tienes una semana de IstmiYa Pro',
    'El equipo de IstmiYa activó tu semana promocional. Tu acceso estará disponible hasta ' || v_end::TEXT || '.',
    'business-trial:' || p_business_id::TEXT,
    NULL
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'subscription_id', v_subscription_id,
    'starts_on', v_start,
    'ends_on', v_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_business_subscription_trial(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_business_subscription_trial(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
