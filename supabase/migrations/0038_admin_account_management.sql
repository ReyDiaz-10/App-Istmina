-- Add auditable account controls without deleting profiles or order history.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_blocked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_status_reason TEXT,
  ADD COLUMN IF NOT EXISTS account_deactivated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.guard_profile_account_status_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.account_blocked_until IS DISTINCT FROM OLD.account_blocked_until
     OR NEW.account_status_reason IS DISTINCT FROM OLD.account_status_reason
     OR NEW.account_deactivated_at IS DISTINCT FROM OLD.account_deactivated_at THEN
    IF current_setting('istmiya.account_status_rpc', TRUE) IS DISTINCT FROM 'on'
       AND COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Account status can only be changed by the administrator workflow'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_account_status_changes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_profile_account_status_changes() TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_guard_account_status_changes'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER profiles_guard_account_status_changes
      BEFORE UPDATE OF status, account_blocked_until, account_status_reason, account_deactivated_at
      ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.guard_profile_account_status_changes();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_business_activation_for_blocked_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status::TEXT = 'activo' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.profile_id
      AND (p.status <> 'activo' OR p.account_deactivated_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'A blocked profile cannot activate its business' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_business_activation_for_blocked_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_business_activation_for_blocked_profile() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_driver_availability_for_blocked_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_available AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.profile_id
      AND (p.status <> 'activo' OR p.account_deactivated_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'A blocked profile cannot go online' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_driver_availability_for_blocked_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_driver_availability_for_blocked_profile() TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.businesses'::regclass
      AND tgname = 'businesses_guard_blocked_profile_activation'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER businesses_guard_blocked_profile_activation
      BEFORE INSERT OR UPDATE OF status ON public.businesses
      FOR EACH ROW EXECUTE FUNCTION public.guard_business_activation_for_blocked_profile();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.drivers'::regclass
      AND tgname = 'drivers_guard_blocked_profile_availability'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER drivers_guard_blocked_profile_availability
      BEFORE INSERT OR UPDATE OF is_available ON public.drivers
      FOR EACH ROW EXECUTE FUNCTION public.guard_driver_availability_for_blocked_profile();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_account_status(
  p_profile_id UUID,
  p_action TEXT,
  p_blocked_until TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_old_status TEXT;
  v_deactivated_at TIMESTAMPTZ;
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL OR p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change this profile';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('block', 'deactivate', 'activate') THEN
    RAISE EXCEPTION 'Invalid account action';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer';
  END IF;
  PERFORM set_config('istmiya.account_status_rpc', 'on', TRUE);

  SELECT role::TEXT, status, account_deactivated_at
    INTO v_role, v_old_status, v_deactivated_at
  FROM public.profiles
  WHERE id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND OR v_role = 'admin' THEN
    RAISE EXCEPTION 'Profile not found or cannot be managed';
  END IF;
  IF v_deactivated_at IS NOT NULL AND p_action <> 'deactivate' THEN
    RAISE EXCEPTION 'Permanently deactivated profile cannot be changed from this action';
  END IF;

  IF p_action = 'block' THEN
    IF p_blocked_until IS NULL
       OR p_blocked_until < NOW() + INTERVAL '1 hour'
       OR p_blocked_until > NOW() + INTERVAL '30 days' THEN
      RAISE EXCEPTION 'Temporary block must be between 1 hour and 30 days';
    END IF;
    UPDATE public.profiles
    SET status = 'bloqueado',
        account_blocked_until = p_blocked_until,
        account_status_reason = v_reason,
        account_deactivated_at = NULL
    WHERE id = p_profile_id;
    UPDATE public.drivers SET is_available = FALSE WHERE profile_id = p_profile_id;
    UPDATE public.businesses SET status = 'inactivo' WHERE profile_id = p_profile_id;

  ELSIF p_action = 'deactivate' THEN
    UPDATE public.profiles
    SET status = 'inactivo',
        account_blocked_until = NULL,
        account_status_reason = v_reason,
        account_deactivated_at = NOW()
    WHERE id = p_profile_id;
    UPDATE public.drivers SET is_available = FALSE WHERE profile_id = p_profile_id;
    UPDATE public.businesses SET status = 'inactivo' WHERE profile_id = p_profile_id;

  ELSE
    IF v_deactivated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Permanently deactivated profile cannot be reactivated with this action';
    END IF;
    IF v_old_status <> 'bloqueado' THEN
      RAISE EXCEPTION 'Only a temporarily blocked profile can be reactivated';
    END IF;
    UPDATE public.profiles
    SET status = 'activo',
        account_blocked_until = NULL,
        account_status_reason = NULL
    WHERE id = p_profile_id;
    UPDATE public.businesses b
    SET status = 'activo'
    WHERE b.profile_id = p_profile_id
      AND EXISTS (
        SELECT 1 FROM public.business_verifications v
        WHERE v.business_id = b.id AND v.verification_status = 'aprobado'
      );
  END IF;

  PERFORM public.write_system_audit_log(
    auth.uid(),
    CASE p_action
      WHEN 'block' THEN 'bloqueó temporalmente un perfil'
      WHEN 'deactivate' THEN 'dio de baja un perfil'
      ELSE 'reactivó un perfil bloqueado'
    END,
    'profile_account',
    p_profile_id::TEXT,
    jsonb_build_object(
      'action', p_action,
      'previous_status', v_old_status,
      'blocked_until', CASE WHEN p_action = 'block' THEN p_blocked_until ELSE NULL END,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'profile_id', p_profile_id,
    'status', CASE WHEN p_action = 'activate' THEN 'activo'
                   WHEN p_action = 'block' THEN 'bloqueado'
                   ELSE 'inactivo' END,
    'blocked_until', CASE WHEN p_action = 'block' THEN p_blocked_until ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_account_status(UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_account_status(UUID, TEXT, TIMESTAMPTZ, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_my_profile_block()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('istmiya.account_status_rpc', 'on', TRUE);

  UPDATE public.profiles
  SET status = 'activo',
      account_blocked_until = NULL,
      account_status_reason = NULL
  WHERE id = auth.uid()
    AND status = 'bloqueado'
    AND account_deactivated_at IS NULL
    AND account_blocked_until <= NOW()
  RETURNING role::TEXT INTO v_role;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'negocio' THEN
    UPDATE public.businesses b
    SET status = 'activo'
    WHERE b.profile_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.business_verifications v
        WHERE v.business_id = b.id AND v.verification_status = 'aprobado'
      );
  END IF;

  PERFORM public.write_system_audit_log(
    auth.uid(), 'expiró bloqueo temporal de perfil', 'profile_account',
    auth.uid()::TEXT, '{}'::JSONB
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_my_profile_block() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_my_profile_block() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
