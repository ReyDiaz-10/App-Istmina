ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role::TEXT IN ('cliente', 'negocio', 'repartidor', 'admin', 'superadmin'));

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role::TEXT IN ('admin', 'superadmin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_client_superadmin_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role::TEXT IN ('admin', 'superadmin')
     AND (TG_OP = 'INSERT' OR OLD.role::TEXT NOT IN ('admin', 'superadmin'))
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a trusted server can assign an administrator role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_name TEXT;
  v_phone TEXT;
BEGIN
  SELECT * INTO v_user
  FROM auth.users
  WHERE LOWER(email) = 'neildiazusb@gmail.com'
  ORDER BY created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'Administrator Auth user is not present; no profile was changed.';
    RETURN;
  END IF;

  -- This migration is the trusted role assignment for the single allowlisted account.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_name := COALESCE(
    NULLIF(BTRIM(v_user.raw_user_meta_data ->> 'full_name'), ''),
    INITCAP(SPLIT_PART(v_user.email, '@', 1))
  );
  v_phone := COALESCE(
    NULLIF(BTRIM(v_user.raw_user_meta_data ->> 'phone'), ''),
    'PENDIENTE-' || LEFT(REPLACE(v_user.id::TEXT, '-', ''), 12)
  );

  INSERT INTO public.profiles (id, full_name, nickname, phone, role)
  VALUES (v_user.id, v_name, v_name, v_phone, 'admin')
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    full_name = COALESCE(NULLIF(BTRIM(public.profiles.full_name), ''), EXCLUDED.full_name),
    nickname = COALESCE(NULLIF(BTRIM(public.profiles.nickname), ''), EXCLUDED.nickname),
    phone = CASE
      WHEN NULLIF(BTRIM(public.profiles.phone), '') IS NULL THEN EXCLUDED.phone
      ELSE public.profiles.phone
    END;
END $$;

NOTIFY pgrst, 'reload schema';
