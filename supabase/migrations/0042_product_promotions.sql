BEGIN;

CREATE TABLE IF NOT EXISTS public.product_promotions (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5,2) NOT NULL
    CHECK (discount_percent > 0 AND discount_percent < 100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME,
  end_time TIME,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_promotions_valid_dates CHECK (end_date >= start_date),
  CONSTRAINT product_promotions_valid_hours CHECK (
    (all_day AND start_time IS NULL AND end_time IS NULL)
    OR (NOT all_day AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

CREATE INDEX IF NOT EXISTS product_promotions_business_idx
  ON public.product_promotions (business_id, is_active, start_date, end_date);

ALTER TABLE public.product_promotions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.product_promotions TO anon, authenticated;

DROP POLICY IF EXISTS product_promotions_read ON public.product_promotions;
CREATE POLICY product_promotions_read
ON public.product_promotions FOR SELECT TO anon, authenticated
USING (
  (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = product_promotions.business_id AND b.profile_id = auth.uid()
    )
  )
  OR (
    product_promotions.is_active
    AND (NOW() AT TIME ZONE 'America/Bogota')::DATE
      BETWEEN product_promotions.start_date AND product_promotions.end_date
    AND (
      product_promotions.all_day
      OR (
        (NOW() AT TIME ZONE 'America/Bogota')::TIME >= product_promotions.start_time
        AND (NOW() AT TIME ZONE 'America/Bogota')::TIME < product_promotions.end_time
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.product_promotion_price(
  p_product_id UUID,
  p_base_price NUMERIC
)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN promo.product_id IS NULL THEN p_base_price
    ELSE ROUND(p_base_price * (100 - promo.discount_percent) / 100, 0)
  END
  FROM (SELECT 1) seed
  LEFT JOIN public.product_promotions promo
    ON promo.product_id = p_product_id
   AND promo.is_active
   AND (NOW() AT TIME ZONE 'America/Bogota')::DATE
       BETWEEN promo.start_date AND promo.end_date
   AND (
     promo.all_day
     OR (
       (NOW() AT TIME ZONE 'America/Bogota')::TIME >= promo.start_time
       AND (NOW() AT TIME ZONE 'America/Bogota')::TIME < promo.end_time
     )
   );
$$;

REVOKE ALL ON FUNCTION public.product_promotion_price(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_promotion_price(UUID, NUMERIC) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_set_product_promotion(
  p_product_id UUID,
  p_discount_percent NUMERIC,
  p_start_date DATE,
  p_end_date DATE,
  p_all_day BOOLEAN,
  p_start_time TIME DEFAULT NULL,
  p_end_time TIME DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS public.product_promotions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_result public.product_promotions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.business_id INTO v_business_id
  FROM public.products p
  JOIN public.businesses b ON b.id = p.business_id
  WHERE p.id = p_product_id AND b.profile_id = auth.uid()
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product is not owned by this account' USING ERRCODE = '42501';
  END IF;
  IF p_discount_percent IS NULL OR p_discount_percent <= 0 OR p_discount_percent >= 100 THEN
    RAISE EXCEPTION 'Discount must be greater than 0 and less than 100 percent';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Promotion date range is invalid';
  END IF;
  IF p_all_day IS NULL OR
     (p_all_day AND (p_start_time IS NOT NULL OR p_end_time IS NOT NULL)) OR
     (NOT p_all_day AND (p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time)) THEN
    RAISE EXCEPTION 'Promotion hours are invalid';
  END IF;

  INSERT INTO public.product_promotions (
    product_id, business_id, discount_percent, start_date, end_date,
    all_day, start_time, end_time, is_active, updated_at
  ) VALUES (
    p_product_id, v_business_id, p_discount_percent, p_start_date, p_end_date,
    p_all_day, CASE WHEN p_all_day THEN NULL ELSE p_start_time END,
    CASE WHEN p_all_day THEN NULL ELSE p_end_time END, COALESCE(p_is_active, TRUE), NOW()
  )
  ON CONFLICT (product_id) DO UPDATE SET
    business_id = EXCLUDED.business_id,
    discount_percent = EXCLUDED.discount_percent,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    all_day = EXCLUDED.all_day,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    is_active = EXCLUDED.is_active,
    updated_at = NOW()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.business_set_product_promotion(
  UUID, NUMERIC, DATE, DATE, BOOLEAN, TIME, TIME, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_set_product_promotion(
  UUID, NUMERIC, DATE, DATE, BOOLEAN, TIME, TIME, BOOLEAN
) TO authenticated;

DO $$
DECLARE
  v_definition TEXT;
  v_updated TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_order_with_delivery_v2(uuid,jsonb,double precision,double precision,text,text)'::REGPROCEDURE
  ) INTO v_definition;
  v_updated := regexp_replace(
    v_definition,
    'v_product_subtotal := v_product_subtotal \+ \(v_price \+ v_option_delta\) \* v_quantity;',
    'v_product_subtotal := v_product_subtotal + (public.product_promotion_price(v_product_id, v_price) + v_option_delta) * v_quantity;',
    'g'
  );
  IF v_updated = v_definition THEN
    IF position(
      'v_product_subtotal := v_product_subtotal + (public.product_promotion_price(v_product_id, v_price) + v_option_delta) * v_quantity;'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'Could not safely update delivery subtotal pricing; expected expression was not found';
    END IF;
  END IF;
  v_definition := v_updated;
  v_updated := regexp_replace(
    v_definition,
    'v_line_price := v_price \+ v_option_delta;',
    'v_line_price := public.product_promotion_price(v_product_id, v_price) + v_option_delta;',
    'g'
  );
  IF v_updated = v_definition THEN
    IF position(
      'v_line_price := public.product_promotion_price(v_product_id, v_price) + v_option_delta;'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'Could not safely update delivery item pricing; expected expression was not found';
    END IF;
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;

  SELECT pg_get_functiondef(
    'public.create_pickup_order(uuid,jsonb,uuid)'::REGPROCEDURE
  ) INTO v_definition;
  v_updated := regexp_replace(
    v_definition,
    'v_subtotal := v_subtotal \+ \(v_price \+ v_option_delta\) \* v_quantity;',
    'v_subtotal := v_subtotal + (public.product_promotion_price(v_product_id, v_price) + v_option_delta) * v_quantity;',
    'g'
  );
  IF v_updated = v_definition THEN
    IF position(
      'v_subtotal := v_subtotal + (public.product_promotion_price(v_product_id, v_price) + v_option_delta) * v_quantity;'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'Could not safely update pickup subtotal pricing; expected expression was not found';
    END IF;
  END IF;
  v_definition := v_updated;
  v_updated := regexp_replace(
    v_definition,
    'VALUES \(v_order_id, v_product_id, v_quantity, v_price \+ v_option_delta\)',
    'VALUES (v_order_id, v_product_id, v_quantity, public.product_promotion_price(v_product_id, v_price) + v_option_delta)',
    'g'
  );
  IF v_updated = v_definition THEN
    IF position(
      'VALUES (v_order_id, v_product_id, v_quantity, public.product_promotion_price(v_product_id, v_price) + v_option_delta)'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'Could not safely update pickup item pricing; expected expression was not found';
    END IF;
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'product_promotions'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_promotions;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
