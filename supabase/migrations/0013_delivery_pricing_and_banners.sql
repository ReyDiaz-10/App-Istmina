ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS delivery_fee_mode TEXT NOT NULL DEFAULT 'merchant_fixed'
    CHECK (delivery_fee_mode IN ('merchant_fixed', 'istmiya_dynamic')),
  ADD COLUMN IF NOT EXISTS delivery_fee_cop INTEGER NOT NULL DEFAULT 4500
    CHECK (delivery_fee_cop BETWEEN 4500 AND 7500),
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_delivery_coordinates_check
  CHECK (
    (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  );

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS product_subtotal_cop NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS delivery_fee_cop INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION;

UPDATE public.orders
SET product_subtotal_cop = total_amount
WHERE product_subtotal_cop IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN product_subtotal_cop SET NOT NULL,
  ADD CONSTRAINT orders_delivery_amounts_check
    CHECK (product_subtotal_cop >= 0 AND delivery_fee_cop BETWEEN 0 AND 7500),
  ADD CONSTRAINT orders_delivery_coordinates_check
    CHECK (
      (delivery_latitude IS NULL OR delivery_latitude BETWEEN -90 AND 90)
      AND (delivery_longitude IS NULL OR delivery_longitude BETWEEN -180 AND 180)
    );

CREATE OR REPLACE FUNCTION public.quote_delivery_fee(
  p_business_id UUID,
  p_delivery_latitude DOUBLE PRECISION DEFAULT NULL,
  p_delivery_longitude DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE (distance_meters INTEGER, delivery_fee_cop INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_mode TEXT;
  v_fixed_fee INTEGER;
  v_business_latitude DOUBLE PRECISION;
  v_business_longitude DOUBLE PRECISION;
BEGIN
  SELECT b.delivery_fee_mode, b.delivery_fee_cop, b.latitude, b.longitude
  INTO v_mode, v_fixed_fee, v_business_latitude, v_business_longitude
  FROM public.businesses b
  WHERE b.id = p_business_id
    AND (
      b.status = 'activo'
      OR b.profile_id = auth.uid()
      OR public.is_superadmin()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business is not available for delivery';
  END IF;

  IF v_mode = 'merchant_fixed' THEN
    distance_meters := NULL;
    delivery_fee_cop := v_fixed_fee;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_delivery_latitude IS NULL OR p_delivery_longitude IS NULL
     OR p_delivery_latitude NOT BETWEEN -90 AND 90
     OR p_delivery_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'A valid delivery location is required for dynamic pricing';
  END IF;

  IF v_business_latitude IS NULL OR v_business_longitude IS NULL THEN
    RAISE EXCEPTION 'Business location is required for dynamic pricing';
  END IF;

  distance_meters := ROUND(ST_Distance(
    ST_SetSRID(ST_MakePoint(v_business_longitude, v_business_latitude), 4326)::GEOGRAPHY,
    ST_SetSRID(ST_MakePoint(p_delivery_longitude, p_delivery_latitude), 4326)::GEOGRAPHY
  )::NUMERIC)::INTEGER;
  delivery_fee_cop := LEAST(
    7500,
    4500 + CEIL(GREATEST((distance_meters::NUMERIC / 1000) - 2, 0) * 700)::INTEGER
  );
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_order_with_delivery(
  p_business_id UUID,
  p_items JSONB,
  p_payment_method public.payment_method,
  p_delivery_latitude DOUBLE PRECISION,
  p_delivery_longitude DOUBLE PRECISION
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_client_id UUID := auth.uid();
  v_role TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_quantity INTEGER;
  v_price NUMERIC(12, 2);
  v_product_subtotal NUMERIC(12, 2) := 0;
  v_delivery_fee INTEGER;
  v_distance_meters INTEGER;
  v_order_id UUID;
  v_subscribed BOOLEAN;
  v_wallet_balance NUMERIC(12, 2);
BEGIN
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = v_client_id;
  IF v_role IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'Only client accounts can place orders' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL
     OR p_payment_method IS NULL
     OR p_payment_method::TEXT <> 'wompi'
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1
     OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Invalid order payment method or item list';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND status = 'activo'
  ) THEN
    RAISE EXCEPTION 'Business is not accepting orders';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_product_id := (v_item ->> 'product_id')::UUID;
      v_quantity := (v_item ->> 'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Invalid product or quantity in order';
    END;

    IF v_quantity < 1 OR v_quantity > 50 THEN
      RAISE EXCEPTION 'Order quantity must be between 1 and 50';
    END IF;

    SELECT price INTO v_price
    FROM public.products
    WHERE id = v_product_id AND business_id = p_business_id
    FOR SHARE;

    IF NOT FOUND OR v_price <= 0 THEN
      RAISE EXCEPTION 'Product is unavailable for this business';
    END IF;

    v_product_subtotal := v_product_subtotal + v_price * v_quantity;
  END LOOP;

  SELECT q.distance_meters, q.delivery_fee_cop
  INTO v_distance_meters, v_delivery_fee
  FROM public.quote_delivery_fee(
    p_business_id,
    p_delivery_latitude,
    p_delivery_longitude
  ) q;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = p_business_id
      AND is_active
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
  ) INTO v_subscribed;

  IF NOT v_subscribed THEN
    SELECT COALESCE(balance, 0) INTO v_wallet_balance
    FROM public.wallets
    WHERE business_id = p_business_id
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_wallet_balance < ROUND(v_product_subtotal * 0.10, 2) THEN
      RAISE EXCEPTION 'WALLET_INSUFFICIENT: Business wallet cannot cover the 10%% commission';
    END IF;
  END IF;

  INSERT INTO public.orders (
    client_id, business_id, total_amount, product_subtotal_cop,
    delivery_fee_cop, distance_meters, delivery_latitude,
    delivery_longitude, payment_method, status
  )
  VALUES (
    v_client_id, p_business_id, v_product_subtotal + v_delivery_fee,
    v_product_subtotal, v_delivery_fee, v_distance_meters,
    CASE WHEN v_distance_meters IS NULL THEN NULL ELSE p_delivery_latitude END,
    CASE WHEN v_distance_meters IS NULL THEN NULL ELSE p_delivery_longitude END,
    p_payment_method, 'pendiente'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::UUID;
    v_quantity := (v_item ->> 'quantity')::INTEGER;
    SELECT price INTO v_price FROM public.products WHERE id = v_product_id;

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_price);
  END LOOP;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_order(
  p_business_id UUID,
  p_items JSONB,
  p_payment_method public.payment_method DEFAULT 'wompi'
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.create_order_with_delivery(
    p_business_id, p_items, p_payment_method, NULL, NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.accept_business_order(p_order_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_wallet_id UUID;
  v_balance NUMERIC(12, 2);
  v_fee NUMERIC(12, 2);
  v_subscribed BOOLEAN;
  v_product_subtotal NUMERIC(12, 2);
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = v_order.business_id AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Order not found for this business' USING ERRCODE = '42501';
  END IF;

  IF v_order.status <> 'pagado' THEN
    RAISE EXCEPTION 'Only verified, paid orders can be accepted';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = v_order.business_id
      AND is_active
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
  ) INTO v_subscribed;

  v_product_subtotal := COALESCE(
    v_order.product_subtotal_cop,
    v_order.total_amount - COALESCE(v_order.delivery_fee_cop, 0)
  );
  v_fee := CASE WHEN v_subscribed THEN 0 ELSE ROUND(v_product_subtotal * 0.10, 2) END;

  IF NOT v_subscribed THEN
    SELECT id, COALESCE(balance, 0) INTO v_wallet_id, v_balance
    FROM public.wallets
    WHERE business_id = v_order.business_id
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_balance < v_fee THEN
      RAISE EXCEPTION 'WALLET_INSUFFICIENT: Recharge the wallet or activate a subscription';
    END IF;

    UPDATE public.wallets
    SET balance = balance - v_fee, updated_at = NOW()
    WHERE id = v_wallet_id;
  END IF;

  UPDATE public.orders SET status = 'preparando' WHERE id = p_order_id;
  RETURN v_fee;
END;
$$;

CREATE TABLE IF NOT EXISTS public.banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title TEXT,
  image_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.banners TO authenticated;

DROP POLICY IF EXISTS banners_select_active_or_owner ON public.banners;
CREATE POLICY banners_select_active_or_owner
  ON public.banners FOR SELECT TO anon, authenticated
  USING (
    is_active
    AND EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.business_id = banners.business_id
        AND s.is_active
        AND s.start_date <= CURRENT_DATE
        AND s.end_date >= CURRENT_DATE
    )
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = banners.business_id
        AND (b.profile_id = auth.uid() OR public.is_superadmin())
    )
  );

DROP POLICY IF EXISTS banners_insert_owner ON public.banners;
CREATE POLICY banners_insert_owner
  ON public.banners FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = banners.business_id AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS banners_update_owner ON public.banners;
CREATE POLICY banners_update_owner
  ON public.banners FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = banners.business_id AND b.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = banners.business_id AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS banners_delete_owner ON public.banners;
CREATE POLICY banners_delete_owner
  ON public.banners FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = banners.business_id AND b.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_banner_subscription_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner UUID;
  v_active_count INTEGER;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT profile_id INTO v_owner
  FROM public.businesses
  WHERE id = NEW.business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found for banner';
  END IF;

  IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only the business owner can publish banners' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = NEW.business_id
      AND is_active
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'An active Pro subscription is required to publish banners';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM public.banners
  WHERE business_id = NEW.business_id
    AND is_active
    AND id IS DISTINCT FROM NEW.id;

  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'A Pro business can publish at most two active banners';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_banner_subscription_limit ON public.banners;
CREATE TRIGGER enforce_banner_subscription_limit
  BEFORE INSERT OR UPDATE OF business_id, is_active ON public.banners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_banner_subscription_limit();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'promotions',
  'promotions',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS promotions_public_read ON storage.objects;
CREATE POLICY promotions_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'promotions');

DROP POLICY IF EXISTS promotions_business_upload ON storage.objects;
CREATE POLICY promotions_business_upload
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'promotions'
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id::TEXT = (storage.foldername(name))[1]
        AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS promotions_business_delete ON storage.objects;
CREATE POLICY promotions_business_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'promotions'
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id::TEXT = (storage.foldername(name))[1]
        AND b.profile_id = auth.uid()
    )
  );

REVOKE ALL ON FUNCTION public.quote_delivery_fee(UUID, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_delivery_fee(UUID, DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_order_with_delivery(
  UUID, JSONB, public.payment_method, DOUBLE PRECISION, DOUBLE PRECISION
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_delivery(
  UUID, JSONB, public.payment_method, DOUBLE PRECISION, DOUBLE PRECISION
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_order(UUID, JSONB, public.payment_method)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(UUID, JSONB, public.payment_method)
  TO authenticated;

REVOKE ALL ON FUNCTION public.accept_business_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_business_order(UUID) TO authenticated;
