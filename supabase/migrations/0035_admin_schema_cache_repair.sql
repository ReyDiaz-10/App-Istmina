-- Repairs the admin profile relationship and notification preference API.
-- The notification outbox from migration 0034 must already exist.
BEGIN;

DO $$
DECLARE
  v_business_profile_attnum SMALLINT;
  v_profile_id_attnum SMALLINT;
BEGIN
  IF to_regclass('public.user_notifications') IS NULL THEN
    RAISE EXCEPTION
      'public.user_notifications is missing; apply 0034_persisted_notifications.sql first.';
  END IF;
  IF to_regprocedure('public.notify_email_preferences(uuid,boolean,boolean,boolean,text)') IS NULL THEN
    RAISE EXCEPTION
      'public.notify_email_preferences is missing; apply 0034_persisted_notifications.sql first.';
  END IF;

  SELECT a.attnum INTO v_business_profile_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.businesses'::regclass
    AND a.attname = 'profile_id'
    AND NOT a.attisdropped;

  SELECT a.attnum INTO v_profile_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.profiles'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  IF v_business_profile_attnum IS NULL OR v_profile_id_attnum IS NULL THEN
    RAISE EXCEPTION
      'Expected public.businesses.profile_id and public.profiles.id columns were not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.businesses'::regclass
      AND c.confrelid = 'public.profiles'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[v_business_profile_attnum]::SMALLINT[]
      AND c.confkey = ARRAY[v_profile_id_attnum]::SMALLINT[]
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_profile_id_profiles_id_repair_fkey
      FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id)
      NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'notification_preferences_owner_read'
  ) THEN
    CREATE POLICY notification_preferences_owner_read
      ON public.notification_preferences
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
