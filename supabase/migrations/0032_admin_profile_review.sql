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
  v_verification_status TEXT;
  v_business_status TEXT;
  v_store_image_url TEXT;
  v_legal_name TEXT;
  v_registration_id TEXT;
  v_complaint_email TEXT;
  v_driver_status TEXT;
  v_vehicle_type TEXT;
  v_plate_number TEXT;
  v_avatar_url TEXT;
  v_plate_photo_path TEXT;
  v_face_photo_attested BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_entity_type IS NULL
     OR p_entity_type NOT IN ('negocio', 'repartidor')
     OR p_entity_id IS NULL
     OR p_approved IS NULL THEN
    RAISE EXCEPTION 'Invalid verification decision';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'Review note must be 500 characters or fewer';
  END IF;
  IF v_note IS NULL THEN
    v_note := CASE
      WHEN p_approved THEN 'Verificación revisada por el equipo administrador.'
      ELSE 'Se requieren correcciones antes de la aprobación.'
    END;
  END IF;

  IF p_entity_type = 'negocio' THEN
    SELECT v.verification_status, b.status::TEXT, b.store_image_url,
           v.legal_name, v.registration_id, v.complaint_email
    INTO v_verification_status, v_business_status, v_store_image_url,
         v_legal_name, v_registration_id, v_complaint_email
    FROM public.business_verifications v
    JOIN public.businesses b ON b.id = v.business_id
    WHERE v.business_id = p_entity_id
    FOR UPDATE OF v, b;

    IF NOT FOUND OR v_verification_status <> 'pendiente' THEN
      RAISE EXCEPTION 'Pending business verification not found';
    END IF;
    IF p_approved AND (
      NULLIF(BTRIM(v_store_image_url), '') IS NULL
      OR NULLIF(BTRIM(v_legal_name), '') IS NULL
      OR NULLIF(BTRIM(v_registration_id), '') IS NULL
      OR NULLIF(BTRIM(v_complaint_email), '') IS NULL
    ) THEN
      RAISE EXCEPTION 'Business profile is missing required review information';
    END IF;

    UPDATE public.business_verifications
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        review_note = v_note,
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE business_id = p_entity_id
      AND verification_status = 'pendiente';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Business verification was already reviewed';
    END IF;

    UPDATE public.businesses
    SET status = CASE WHEN p_approved THEN 'activo'::public.business_status
                      ELSE 'fuera_de_servicio'::public.business_status END
    WHERE id = p_entity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Business profile not found';
    END IF;

    PERFORM public.write_system_audit_log(
      auth.uid(),
      CASE WHEN p_approved THEN 'aprobó perfil de negocio' ELSE 'rechazó perfil de negocio' END,
      'business_verification',
      p_entity_id::TEXT,
      jsonb_build_object(
        'verification_status', CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        'previous_business_status', v_business_status,
        'business_status', CASE WHEN p_approved THEN 'activo' ELSE 'fuera_de_servicio' END,
        'note', v_note
      )
    );
  ELSE
    SELECT v.verification_status, d.verification_status, d.vehicle_type,
           d.plate_number, p.avatar_url, v.plate_photo_path, v.face_photo_attested
    INTO v_verification_status, v_driver_status, v_vehicle_type,
         v_plate_number, v_avatar_url, v_plate_photo_path, v_face_photo_attested
    FROM public.driver_verifications v
    JOIN public.drivers d ON d.id = v.driver_id
    JOIN public.profiles p ON p.id = d.profile_id
    WHERE v.driver_id = p_entity_id
    FOR UPDATE OF v, d, p;

    IF NOT FOUND OR v_verification_status <> 'pendiente' THEN
      RAISE EXCEPTION 'Pending driver verification not found';
    END IF;
    IF p_approved AND (
      NULLIF(BTRIM(v_avatar_url), '') IS NULL
      OR NULLIF(BTRIM(v_plate_photo_path), '') IS NULL
      OR v_face_photo_attested IS DISTINCT FROM TRUE
      OR NULLIF(BTRIM(v_vehicle_type), '') IS NULL
      OR NULLIF(BTRIM(v_plate_number), '') IS NULL
    ) THEN
      RAISE EXCEPTION 'Driver profile is missing required review information';
    END IF;

    UPDATE public.driver_verifications
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        review_note = v_note,
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE driver_id = p_entity_id
      AND verification_status = 'pendiente';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Driver verification was already reviewed';
    END IF;

    UPDATE public.drivers
    SET verification_status = CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        is_available = false
    WHERE id = p_entity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Driver profile not found';
    END IF;

    PERFORM public.write_system_audit_log(
      auth.uid(),
      CASE WHEN p_approved THEN 'aprobó perfil de repartidor' ELSE 'rechazó perfil de repartidor' END,
      'driver_verification',
      p_entity_id::TEXT,
      jsonb_build_object(
        'verification_status', CASE WHEN p_approved THEN 'aprobado' ELSE 'rechazado' END,
        'previous_driver_status', v_driver_status,
        'is_available', false,
        'note', v_note
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_role_verification(TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_role_verification(TEXT, UUID, BOOLEAN, TEXT) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'business_verifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.business_verifications;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'driver_verifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_verifications;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'drivers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
    END IF;
  END IF;
END;
$$;
