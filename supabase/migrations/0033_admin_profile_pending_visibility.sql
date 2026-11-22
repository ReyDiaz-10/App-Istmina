-- Compatibility and recovery migration for pending business/driver profiles.
-- Safe to apply once after migrations 0006 and 0025.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role::TEXT = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- Backfill complete profiles that were created in Auth but may be missing
-- public profile/entity rows.
DO $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_role TEXT;
  v_name TEXT;
  v_phone TEXT;
  v_business_id UUID;
  v_driver_id UUID;
BEGIN
  FOR v_user IN
    SELECT *
    FROM auth.users
    WHERE COALESCE(raw_user_meta_data->>'role', 'cliente') IN ('negocio', 'repartidor')
  LOOP
    v_role := v_user.raw_user_meta_data->>'role';
    v_name := NULLIF(BTRIM(v_user.raw_user_meta_data->>'full_name'), '');
    v_phone := NULLIF(BTRIM(v_user.raw_user_meta_data->>'phone'), '');

    IF v_name IS NULL THEN
      v_name := COALESCE(
        NULLIF(BTRIM(v_user.raw_user_meta_data->>'name'), ''),
        SPLIT_PART(COALESCE(v_user.email, 'usuario'), '@', 1)
      );
    END IF;

    IF v_phone IS NULL THEN
      v_phone := 'PENDIENTE-' || LEFT(REPLACE(v_user.id::TEXT, '-', ''), 12);
    END IF;

    INSERT INTO public.profiles (id, full_name, phone, role, status)
    VALUES (v_user.id, v_name, v_phone, v_role::public.user_role, 'activo')
    ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role,
        full_name = COALESCE(NULLIF(BTRIM(public.profiles.full_name), ''), EXCLUDED.full_name),
        phone = CASE
          WHEN NULLIF(BTRIM(public.profiles.phone), '') IS NULL THEN EXCLUDED.phone
          ELSE public.profiles.phone
        END;

    IF v_role = 'negocio'
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'store_name'), '') IS NOT NULL
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'address'), '') IS NOT NULL
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'legal_name'), '') IS NOT NULL
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'registration_id'), '') IS NOT NULL
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'complaint_email'), '') IS NOT NULL
       AND v_user.raw_user_meta_data->>'registration_id_type' IN ('NIT', 'CC')
    THEN
      SELECT id INTO v_business_id
      FROM public.businesses
      WHERE profile_id = v_user.id
      LIMIT 1;

      IF v_business_id IS NULL THEN
        INSERT INTO public.businesses (
          profile_id, store_name, address, slogan, status
        )
        VALUES (
          v_user.id,
          BTRIM(v_user.raw_user_meta_data->>'store_name'),
          BTRIM(v_user.raw_user_meta_data->>'address'),
          NULLIF(BTRIM(v_user.raw_user_meta_data->>'slogan'), ''),
          'inactivo'
        )
        RETURNING id INTO v_business_id;
      END IF;

      INSERT INTO public.business_verifications (
        business_id, legal_name, registration_id_type, registration_id, complaint_email,
        verification_status
      )
      VALUES (
        v_business_id,
        BTRIM(v_user.raw_user_meta_data->>'legal_name'),
        v_user.raw_user_meta_data->>'registration_id_type',
        BTRIM(v_user.raw_user_meta_data->>'registration_id'),
        LOWER(BTRIM(v_user.raw_user_meta_data->>'complaint_email')),
        'pendiente'
      )
      ON CONFLICT (business_id) DO NOTHING;

      IF NOT EXISTS (
        SELECT 1 FROM public.wallets WHERE business_id = v_business_id
      ) THEN
        INSERT INTO public.wallets (business_id, balance) VALUES (v_business_id, 0);
      END IF;
    ELSIF v_role = 'repartidor'
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'vehicle_type'), '') IS NOT NULL
       AND NULLIF(BTRIM(v_user.raw_user_meta_data->>'plate_number'), '') IS NOT NULL
    THEN
      SELECT id INTO v_driver_id
      FROM public.drivers
      WHERE profile_id = v_user.id
      LIMIT 1;

      IF v_driver_id IS NULL THEN
        INSERT INTO public.drivers (
          profile_id, vehicle_type, plate_number, is_available, verification_status
        )
        VALUES (
          v_user.id,
          BTRIM(v_user.raw_user_meta_data->>'vehicle_type'),
          UPPER(BTRIM(v_user.raw_user_meta_data->>'plate_number')),
          false,
          'pendiente'
        )
        RETURNING id INTO v_driver_id;
      ELSE
        UPDATE public.drivers
        SET vehicle_type = COALESCE(NULLIF(BTRIM(vehicle_type), ''), BTRIM(v_user.raw_user_meta_data->>'vehicle_type')),
            plate_number = COALESCE(NULLIF(BTRIM(plate_number), ''), UPPER(BTRIM(v_user.raw_user_meta_data->>'plate_number'))),
            is_available = CASE WHEN verification_status = 'aprobado' THEN is_available ELSE false END
        WHERE id = v_driver_id;
      END IF;

      INSERT INTO public.driver_verifications (
        driver_id, face_photo_attested, verification_status
      )
      VALUES (v_driver_id, true, 'pendiente')
      ON CONFLICT (driver_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Explicit administrator policies for verification queues and entities.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_update_self_or_admin ON public.profiles;
CREATE POLICY profiles_update_self_or_admin
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS businesses_select_public_or_owner ON public.businesses;
CREATE POLICY businesses_select_public_or_owner
  ON public.businesses FOR SELECT TO anon, authenticated
  USING (
    (
      status = 'activo'
      AND EXISTS (
        SELECT 1
        FROM public.business_verifications v
        WHERE v.business_id = businesses.id
          AND v.verification_status = 'aprobado'
      )
    )
    OR profile_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS businesses_update_owner_or_admin ON public.businesses;
CREATE POLICY businesses_update_owner_or_admin
  ON public.businesses FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin())
  WITH CHECK (profile_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS drivers_select_owner_or_order_participant ON public.drivers;
CREATE POLICY drivers_select_owner_or_order_participant
  ON public.drivers FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_admin()
    OR public.is_driver_order_participant(id)
  );

DROP POLICY IF EXISTS drivers_update_owner ON public.drivers;
CREATE POLICY drivers_update_owner
  ON public.drivers FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin())
  WITH CHECK (profile_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS business_verifications_select_owner_or_admin ON public.business_verifications;
CREATE POLICY business_verifications_select_owner_or_admin
  ON public.business_verifications FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = business_verifications.business_id
        AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS driver_verifications_select_owner_or_admin ON public.driver_verifications;
CREATE POLICY driver_verifications_select_owner_or_admin
  ON public.driver_verifications FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = driver_verifications.driver_id
        AND d.profile_id = auth.uid()
    )
  );

-- Private documents require explicit administrator storage read access.
DROP POLICY IF EXISTS profile_media_select_owner_or_order ON storage.objects;
CREATE POLICY profile_media_select_owner_or_order
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR public.is_admin()
      OR CASE
        WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN public.can_view_active_driver_photo(((storage.foldername(name))[1])::UUID)
        ELSE false
      END
    )
  );

DROP POLICY IF EXISTS driver_documents_owner_or_admin ON storage.objects;
CREATE POLICY driver_documents_owner_or_admin
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR public.is_admin()
    )
  );

-- Compatibility review RPC that also updates the entity's operational status.
CREATE OR REPLACE FUNCTION public.admin_review_role_verification(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_note TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_entity_type NOT IN ('negocio', 'repartidor') OR p_entity_id IS NULL OR p_approved IS NULL THEN
    RAISE EXCEPTION 'Invalid verification decision';
  END IF;

  IF v_note IS NULL THEN
    v_note := CASE
      WHEN p_approved THEN 'Verificación revisada por el equipo administrador.'
      ELSE 'Se requieren correcciones antes de la aprobación.'
    END;
  END IF;

  IF p_entity_type = 'negocio' THEN
    UPDATE public.business_verifications
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        review_note = v_note,
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE business_id = p_entity_id
      AND verification_status = 'pendiente';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pending business verification not found';
    END IF;

    UPDATE public.businesses
    SET status = CASE WHEN p_approved THEN 'activo'::public.business_status
                      ELSE 'fuera_de_servicio'::public.business_status END
    WHERE id = p_entity_id;

    PERFORM public.write_system_audit_log(
      auth.uid(),
      CASE WHEN p_approved THEN 'aprobó perfil de negocio' ELSE 'rechazó perfil de negocio' END,
      'business_verification',
      p_entity_id::TEXT,
      jsonb_build_object(
        'verification_status', CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        'note', v_note
      )
    );
  ELSE
    UPDATE public.driver_verifications
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        review_note = v_note,
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE driver_id = p_entity_id
      AND verification_status = 'pendiente';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pending driver verification not found';
    END IF;

    UPDATE public.drivers
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        is_available = false
    WHERE id = p_entity_id;

    PERFORM public.write_system_audit_log(
      auth.uid(),
      CASE WHEN p_approved THEN 'aprobó perfil de repartidor' ELSE 'rechazó perfil de repartidor' END,
      'driver_verification',
      p_entity_id::TEXT,
      jsonb_build_object(
        'verification_status', CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        'is_available', false,
        'note', v_note
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_role_verification(TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_role_verification(TEXT, UUID, BOOLEAN, TEXT) TO authenticated;
