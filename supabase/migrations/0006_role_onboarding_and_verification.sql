ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS slogan TEXT,
  ADD COLUMN IF NOT EXISTS store_image_url TEXT;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (verification_status IN ('pendiente', 'aprobado', 'rechazado'));

ALTER TABLE public.drivers
  ALTER COLUMN is_available SET DEFAULT false;

CREATE TABLE IF NOT EXISTS public.business_verifications (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  registration_id_type TEXT NOT NULL CHECK (registration_id_type IN ('NIT', 'CC')),
  registration_id TEXT NOT NULL,
  complaint_email TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (verification_status IN ('pendiente', 'aprobado', 'rechazado')),
  review_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.driver_verifications (
  driver_id UUID PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  plate_photo_path TEXT,
  identity_document_path TEXT,
  face_photo_attested BOOLEAN NOT NULL DEFAULT false,
  verification_status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (verification_status IN ('pendiente', 'aprobado', 'rechazado')),
  review_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.business_verifications (
  business_id, legal_name, registration_id_type, registration_id, complaint_email
)
SELECT b.id, b.store_name, 'NIT', '', ''
FROM public.businesses b
ON CONFLICT (business_id) DO NOTHING;

UPDATE public.businesses b
SET status = 'inactivo'
WHERE NOT EXISTS (
  SELECT 1 FROM public.business_verifications v
  WHERE v.business_id = b.id AND v.verification_status = 'aprobado'
);

UPDATE public.drivers
SET is_available = false,
    verification_status = 'pendiente';

INSERT INTO public.driver_verifications (driver_id)
SELECT d.id
FROM public.drivers d
ON CONFLICT (driver_id) DO NOTHING;

ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_verifications, public.driver_verifications FROM PUBLIC, anon;
GRANT SELECT ON public.business_verifications, public.driver_verifications TO authenticated;
GRANT UPDATE (
  legal_name, registration_id_type, registration_id, complaint_email,
  verification_status, review_note, reviewed_by, reviewed_at
) ON public.business_verifications TO authenticated;
GRANT UPDATE (plate_photo_path, identity_document_path, face_photo_attested)
  ON public.driver_verifications TO authenticated;

DROP POLICY IF EXISTS business_verifications_select_owner_or_admin ON public.business_verifications;
CREATE POLICY business_verifications_select_owner_or_admin
  ON public.business_verifications FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_verifications.business_id
        AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS business_verifications_update_owner ON public.business_verifications;
CREATE POLICY business_verifications_update_owner
  ON public.business_verifications FOR UPDATE TO authenticated
  USING (
    verification_status IN ('pendiente', 'rechazado')
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_verifications.business_id
        AND b.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    verification_status = 'pendiente'
    AND review_note IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_verifications.business_id
        AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS businesses_select_public_or_owner ON public.businesses;
CREATE POLICY businesses_select_public_or_owner
  ON public.businesses FOR SELECT TO anon, authenticated
  USING (
    (
      status = 'activo'
      AND EXISTS (
        SELECT 1 FROM public.business_verifications v
        WHERE v.business_id = businesses.id
          AND v.verification_status = 'aprobado'
      )
    )
    OR profile_id = auth.uid()
    OR public.is_superadmin()
  );

DROP POLICY IF EXISTS products_select_active_businesses ON public.products;
CREATE POLICY products_select_active_businesses
  ON public.products FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = products.business_id
        AND (
          (
            b.status = 'activo'
            AND EXISTS (
              SELECT 1 FROM public.business_verifications v
              WHERE v.business_id = b.id AND v.verification_status = 'aprobado'
            )
          )
          OR b.profile_id = auth.uid()
          OR public.is_superadmin()
        )
    )
  );

DROP POLICY IF EXISTS driver_verifications_select_owner_or_admin ON public.driver_verifications;
CREATE POLICY driver_verifications_select_owner_or_admin
  ON public.driver_verifications FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_verifications.driver_id
        AND d.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS driver_verifications_update_owner_pending ON public.driver_verifications;
CREATE POLICY driver_verifications_update_owner_pending
  ON public.driver_verifications FOR UPDATE TO authenticated
  USING (
    verification_status IN ('pendiente', 'rechazado')
    AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_verifications.driver_id
        AND d.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    verification_status IN ('pendiente', 'rechazado')
    AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_verifications.driver_id
        AND d.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.create_role_profile_after_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := COALESCE(NEW.raw_user_meta_data ->> 'role', 'cliente');
  v_name TEXT := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_phone TEXT := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'phone'), '');
  v_business_id UUID;
  v_driver_id UUID;
BEGIN
  -- SuperAdmin is created only by the trusted seed/server process.
  IF v_role = 'superadmin' THEN
    RETURN NEW;
  END IF;

  IF v_role NOT IN ('cliente', 'negocio', 'repartidor') THEN
    RAISE EXCEPTION 'Invalid public role';
  END IF;
  IF v_name IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'Full name and phone are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'role'
      AND data_type = 'text'
  ) THEN
    INSERT INTO public.profiles (id, full_name, phone, role, status)
    VALUES (NEW.id, v_name, v_phone, v_role, 'activo');
  ELSE
    INSERT INTO public.profiles (id, full_name, phone, role, status)
    VALUES (NEW.id, v_name, v_phone, v_role::public.user_role, 'activo');
  END IF;

  IF v_role = 'negocio' THEN
    IF NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'store_name'), '') IS NULL
       OR NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'address'), '') IS NULL
       OR NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'legal_name'), '') IS NULL
       OR NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'registration_id'), '') IS NULL
       OR NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'complaint_email'), '') IS NULL
       OR NEW.raw_user_meta_data ->> 'registration_id_type' NOT IN ('NIT', 'CC') THEN
      RAISE EXCEPTION 'Business registration details are incomplete';
    END IF;

    INSERT INTO public.businesses (
      profile_id, store_name, address, slogan, status
    )
    VALUES (
      NEW.id,
      BTRIM(NEW.raw_user_meta_data ->> 'store_name'),
      BTRIM(NEW.raw_user_meta_data ->> 'address'),
      NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'slogan'), ''),
      'inactivo'
    )
    RETURNING id INTO v_business_id;

    INSERT INTO public.business_verifications (
      business_id, legal_name, registration_id_type, registration_id, complaint_email
    )
    VALUES (
      v_business_id,
      BTRIM(NEW.raw_user_meta_data ->> 'legal_name'),
      NEW.raw_user_meta_data ->> 'registration_id_type',
      BTRIM(NEW.raw_user_meta_data ->> 'registration_id'),
      LOWER(BTRIM(NEW.raw_user_meta_data ->> 'complaint_email'))
    );

    INSERT INTO public.wallets (business_id, balance) VALUES (v_business_id, 0);
  ELSIF v_role = 'repartidor' THEN
    IF NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'vehicle_type'), '') IS NULL
       OR NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'plate_number'), '') IS NULL
       OR NEW.raw_user_meta_data ->> 'face_photo_attested' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Driver vehicle and photo declaration are required';
    END IF;

    INSERT INTO public.drivers (
      profile_id, vehicle_type, plate_number, is_available, verification_status
    )
    VALUES (
      NEW.id,
      BTRIM(NEW.raw_user_meta_data ->> 'vehicle_type'),
      UPPER(BTRIM(NEW.raw_user_meta_data ->> 'plate_number')),
      false,
      'pendiente'
    )
    RETURNING id INTO v_driver_id;

    INSERT INTO public.driver_verifications (driver_id, face_photo_attested)
    VALUES (v_driver_id, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_role_profile_after_signup ON auth.users;
CREATE TRIGGER create_role_profile_after_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_role_profile_after_signup();

CREATE OR REPLACE FUNCTION public.prevent_unverified_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    IF NEW.status = 'activo'
       AND OLD.status IS DISTINCT FROM NEW.status
       AND COALESCE(auth.role(), '') <> 'service_role'
       AND NOT EXISTS (
         SELECT 1 FROM public.business_verifications v
         WHERE v.business_id = NEW.id
           AND v.verification_status = 'aprobado'
       ) THEN
      RAISE EXCEPTION 'Business verification is required before activation';
    END IF;
  ELSIF TG_TABLE_NAME = 'drivers' THEN
    IF OLD.verification_status = 'aprobado'
       AND (
         NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
         OR NEW.plate_number IS DISTINCT FROM OLD.plate_number
       )
       AND COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.is_superadmin() THEN
      RAISE EXCEPTION 'Vehicle changes require administrator review';
    END IF;
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       AND COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.is_superadmin() THEN
      RAISE EXCEPTION 'Only an administrator can change driver verification';
    END IF;
    IF NEW.is_available AND NEW.verification_status <> 'aprobado' THEN
      RAISE EXCEPTION 'Driver verification is required before going online';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_approved_driver_photo_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role::TEXT = 'repartidor'
     AND NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
     AND EXISTS (
       SELECT 1 FROM public.drivers d
       WHERE d.profile_id = NEW.id AND d.verification_status = 'aprobado'
     )
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Profile photo changes require administrator review';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_approved_driver_photo_change ON public.profiles;
CREATE TRIGGER prevent_approved_driver_photo_change
  BEFORE UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_driver_photo_change();

DROP TRIGGER IF EXISTS prevent_unverified_business_activation ON public.businesses;
CREATE TRIGGER prevent_unverified_business_activation
  BEFORE UPDATE OF status ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unverified_activation();

DROP TRIGGER IF EXISTS prevent_driver_self_verification ON public.drivers;
CREATE TRIGGER prevent_driver_self_verification
  BEFORE UPDATE OF verification_status, is_available, vehicle_type, plate_number ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unverified_activation();

CREATE OR REPLACE FUNCTION public.require_verified_business_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_verifications v
    WHERE v.business_id = NEW.business_id
      AND v.verification_status = 'aprobado'
  ) THEN
    RAISE EXCEPTION 'Business verification is required before accepting orders';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_verified_business_order ON public.orders;
CREATE TRIGGER require_verified_business_order
  BEFORE INSERT OR UPDATE OF business_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_business_order();

CREATE OR REPLACE FUNCTION public.review_role_verification(
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
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  IF p_approved IS NULL OR p_entity_type NOT IN ('negocio', 'repartidor') THEN
    RAISE EXCEPTION 'Invalid verification decision';
  END IF;

  IF p_entity_type = 'negocio' THEN
    UPDATE public.business_verifications
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        review_note = NULLIF(BTRIM(p_note), ''),
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE business_id = p_entity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Business verification not found';
    END IF;
    UPDATE public.businesses
    SET status = CASE WHEN p_approved THEN 'inactivo'::public.business_status
                      ELSE 'fuera_de_servicio'::public.business_status END
    WHERE id = p_entity_id;
  ELSE
    UPDATE public.driver_verifications
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        review_note = NULLIF(BTRIM(p_note), ''),
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE driver_id = p_entity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Driver verification not found';
    END IF;
    UPDATE public.drivers
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        is_available = false
    WHERE id = p_entity_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resubmit_role_verification(
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_entity_type = 'negocio' THEN
    UPDATE public.business_verifications v
    SET verification_status = 'pendiente',
        review_note = NULL,
        reviewed_by = NULL,
        reviewed_at = NULL
    WHERE v.business_id = p_entity_id
      AND v.verification_status = 'rechazado'
      AND EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id = v.business_id AND b.profile_id = auth.uid()
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rejected business verification not found for this user';
    END IF;
    UPDATE public.businesses SET status = 'inactivo' WHERE id = p_entity_id;
  ELSIF p_entity_type = 'repartidor' THEN
    UPDATE public.driver_verifications v
    SET verification_status = 'pendiente',
        review_note = NULL,
        reviewed_by = NULL,
        reviewed_at = NULL
    WHERE v.driver_id = p_entity_id
      AND v.verification_status = 'rechazado'
      AND EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = v.driver_id AND d.profile_id = auth.uid()
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rejected driver verification not found for this user';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid verification type';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_role_verification(TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_role_verification(TEXT, UUID, BOOLEAN, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.resubmit_role_verification(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_role_verification(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_active_driver_photo(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drivers d
    JOIN public.orders o ON o.driver_id = d.id
    LEFT JOIN public.businesses b ON b.id = o.business_id
    WHERE d.profile_id = p_profile_id
      AND o.status = 'en_camino'
      AND (o.client_id = auth.uid() OR b.profile_id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_active_driver_photo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_active_driver_photo(UUID) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('profile-media', 'profile-media', false),
  ('driver-documents', 'driver-documents', false),
  ('business-images', 'business-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS profile_media_select_owner_or_order ON storage.objects;
CREATE POLICY profile_media_select_owner_or_order
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR public.is_superadmin()
      OR CASE
        WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN public.can_view_active_driver_photo(((storage.foldername(name))[1])::UUID)
        ELSE false
      END
    )
  );

DROP POLICY IF EXISTS profile_media_insert_owner ON storage.objects;
CREATE POLICY profile_media_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS profile_media_update_owner ON storage.objects;
CREATE POLICY profile_media_update_owner
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-media' AND (storage.foldername(name))[1] = auth.uid()::TEXT)
  WITH CHECK (bucket_id = 'profile-media' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

DROP POLICY IF EXISTS driver_documents_owner_or_admin ON storage.objects;
CREATE POLICY driver_documents_owner_or_admin
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR public.is_superadmin()
    )
  );

DROP POLICY IF EXISTS driver_documents_insert_owner ON storage.objects;
CREATE POLICY driver_documents_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS driver_documents_update_owner ON storage.objects;
CREATE POLICY driver_documents_update_owner
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::TEXT)
  WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

DROP POLICY IF EXISTS business_images_insert_owner ON storage.objects;
CREATE POLICY business_images_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS business_images_update_owner ON storage.objects;
CREATE POLICY business_images_update_owner
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  )
  WITH CHECK (
    bucket_id = 'business-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

NOTIFY pgrst, 'reload schema';
