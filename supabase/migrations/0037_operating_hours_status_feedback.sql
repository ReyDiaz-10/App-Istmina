-- Keep the existing RPC signature and response keys while calculating the
-- business wall-clock time in its configured timezone without session-TZ drift.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_business_operating_status(
  p_business_id UUID,
  p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone TEXT;
  v_confirmed BOOLEAN;
  v_local TIMESTAMP WITHOUT TIME ZONE;
  v_local_time TIME;
  v_day SMALLINT;
  v_hours public.business_operating_hours%ROWTYPE;
BEGIN
  SELECT operating_timezone, operating_hours_confirmed
  INTO v_timezone, v_confirmed
  FROM public.businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_open', FALSE, 'configured', FALSE, 'message', 'Negocio no encontrado');
  END IF;

  v_timezone := COALESCE(NULLIF(BTRIM(v_timezone), ''), 'America/Bogota');
  v_local := p_at AT TIME ZONE v_timezone;
  v_local_time := v_local::TIME;
  v_day := EXTRACT(DOW FROM v_local)::SMALLINT;

  IF NOT COALESCE(v_confirmed, FALSE) THEN
    RETURN jsonb_build_object(
      'is_open', TRUE,
      'configured', FALSE,
      'timezone', v_timezone,
      'opens_at', NULL,
      'closes_at', NULL,
      'message', 'Horario por confirmar'
    );
  END IF;

  SELECT * INTO v_hours
  FROM public.business_operating_hours
  WHERE business_id = p_business_id
    AND day_of_week = v_day
    AND is_confirmed
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'is_open', FALSE,
      'configured', TRUE,
      'timezone', v_timezone,
      'opens_at', NULL,
      'closes_at', NULL,
      'message', 'El negocio está cerrado hoy'
    );
  END IF;

  RETURN jsonb_build_object(
    'is_open', v_local_time >= v_hours.opens_at AND v_local_time < v_hours.closes_at,
    'configured', TRUE,
    'timezone', v_timezone,
    'opens_at', v_hours.opens_at::TEXT,
    'closes_at', v_hours.closes_at::TEXT,
    'message',
      CASE
        WHEN v_local_time >= v_hours.opens_at AND v_local_time < v_hours.closes_at
          THEN 'El negocio está abierto'
        WHEN v_local_time < v_hours.opens_at
          THEN 'Abre a las ' || to_char(v_hours.opens_at, 'HH24:MI')
        ELSE 'Cerró a las ' || to_char(v_hours.closes_at, 'HH24:MI')
      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_operating_status(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_operating_status(UUID, TIMESTAMPTZ) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
