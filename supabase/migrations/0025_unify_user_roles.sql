BEGIN;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TYPE public.user_role RENAME TO user_role_legacy;
CREATE TYPE public.user_role AS ENUM ('cliente', 'negocio', 'repartidor', 'admin');

ALTER TABLE public.profiles
  ALTER COLUMN role TYPE public.user_role
  USING (
    CASE role::TEXT
      WHEN 'superadmin' THEN 'admin'
      WHEN 'super_admin' THEN 'admin'
      ELSE role::TEXT
    END
  )::public.user_role;

DROP TYPE public.user_role_legacy;

UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::JSONB),
  '{role}',
  '"admin"'::JSONB,
  TRUE
)
WHERE raw_user_meta_data->>'role' IN ('superadmin', 'super_admin');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role::TEXT IN ('cliente', 'negocio', 'repartidor', 'admin'));

ALTER TABLE public.system_audit_logs
  DROP CONSTRAINT IF EXISTS system_audit_logs_actor_role_check;

UPDATE public.system_audit_logs
SET actor_role = 'admin'
WHERE actor_role IN ('superadmin', 'super_admin');

ALTER TABLE public.system_audit_logs
  ADD CONSTRAINT system_audit_logs_actor_role_check
  CHECK (actor_role IN ('cliente', 'negocio', 'repartidor', 'admin'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role::TEXT = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

DO $$
DECLARE
  v_function RECORD;
  v_policy RECORD;
  v_definition TEXT;
  v_statement TEXT;
BEGIN
  FOR v_function IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT IN ('is_superadmin', 'is_super_admin')
      AND (
        pg_get_functiondef(p.oid) LIKE '%is_superadmin()%'
        OR pg_get_functiondef(p.oid) LIKE '%is_super_admin()%'
        OR pg_get_functiondef(p.oid) LIKE '%''superadmin''%'
        OR pg_get_functiondef(p.oid) LIKE '%''super_admin''%'
      )
  LOOP
    v_definition := REPLACE(v_function.definition, 'is_superadmin()', 'is_admin()');
    v_definition := REPLACE(v_definition, 'is_super_admin()', 'is_admin()');
    v_definition := REPLACE(v_definition, '''superadmin''', '''admin''');
    v_definition := REPLACE(v_definition, '''super_admin''', '''admin''');
    v_definition := REPLACE(v_definition, '''admin'', ''admin''', '''admin''');
    v_definition := REPLACE(v_definition, 'SuperAdmin', 'administrator');
    EXECUTE v_definition;
  END LOOP;

  FOR v_policy IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE COALESCE(qual, '') LIKE '%is_superadmin()%'
       OR COALESCE(with_check, '') LIKE '%is_superadmin()%'
       OR COALESCE(qual, '') LIKE '%is_super_admin()%'
       OR COALESCE(with_check, '') LIKE '%is_super_admin()%'
       OR COALESCE(qual, '') LIKE '%''superadmin''%'
       OR COALESCE(with_check, '') LIKE '%''superadmin''%'
       OR COALESCE(qual, '') LIKE '%''super_admin''%'
       OR COALESCE(with_check, '') LIKE '%''super_admin''%'
  LOOP
    v_statement := FORMAT(
      'ALTER POLICY %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
    IF v_policy.qual IS NOT NULL THEN
      v_statement := v_statement || FORMAT(
        ' USING (%s)',
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(v_policy.qual, 'is_superadmin()', 'is_admin()'),
              'is_super_admin()',
              'is_admin()'
            ),
            '''superadmin''',
            '''admin'''
          ),
          '''super_admin''',
          '''admin'''
        )
      );
    END IF;
    IF v_policy.with_check IS NOT NULL THEN
      v_statement := v_statement || FORMAT(
        ' WITH CHECK (%s)',
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(v_policy.with_check, 'is_superadmin()', 'is_admin()'),
              'is_super_admin()',
              'is_admin()'
            ),
            '''superadmin''',
            '''admin'''
          ),
          '''super_admin''',
          '''admin'''
        )
      );
    END IF;
    EXECUTE v_statement;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_financial_exception(
  p_exception_type TEXT,
  p_exception_id TEXT,
  p_status TEXT,
  p_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_exception_type NOT IN ('payment', 'refund', 'business_payout')
     OR NULLIF(BTRIM(p_exception_id), '') IS NULL
     OR p_status NOT IN ('open', 'reviewed')
     OR NULLIF(BTRIM(p_note), '') IS NULL
     OR char_length(p_note) > 2000 THEN
    RAISE EXCEPTION 'Invalid financial exception review';
  END IF;

  INSERT INTO public.admin_financial_exception_reviews (
    exception_type, exception_id, status, note, reviewed_by, updated_at
  ) VALUES (
    p_exception_type, p_exception_id, p_status, BTRIM(p_note), auth.uid(), NOW()
  )
  ON CONFLICT (exception_type, exception_id) DO UPDATE SET
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    reviewed_by = EXCLUDED.reviewed_by,
    updated_at = NOW();

  PERFORM public.write_system_audit_log(
    auth.uid(),
    CASE WHEN p_status = 'reviewed' THEN 'revisó una excepción financiera' ELSE 'actualizó una nota financiera' END,
    p_exception_type,
    p_exception_id,
    jsonb_build_object('status', p_status)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_financial_exception(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_financial_exception(TEXT, TEXT, TEXT, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.is_superadmin();
DROP FUNCTION IF EXISTS public.is_super_admin();

DROP TRIGGER IF EXISTS prevent_client_superadmin_assignment ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_client_superadmin_assignment();
DROP TRIGGER IF EXISTS prevent_client_super_admin_assignment ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_client_super_admin_assignment();

CREATE OR REPLACE FUNCTION public.prevent_client_admin_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role::TEXT = 'admin'
     AND (TG_OP = 'INSERT' OR OLD.role::TEXT <> 'admin')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a trusted server can assign an administrator role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_client_admin_assignment
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_admin_assignment();

NOTIFY pgrst, 'reload schema';

COMMIT;
