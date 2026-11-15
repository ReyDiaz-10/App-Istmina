CREATE SEQUENCE IF NOT EXISTS public.order_number_sequence START WITH 100000;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number BIGINT
    NOT NULL DEFAULT nextval('public.order_number_sequence');

SELECT setval(
  'public.order_number_sequence',
  GREATEST(COALESCE((SELECT MAX(order_number) FROM public.orders), 99999), 99999),
  TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_uidx
  ON public.orders (order_number);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inventory_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::REGCLASS
      AND conname = 'products_stock_quantity_nonnegative'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_quantity_nonnegative
      CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  option_group TEXT NOT NULL DEFAULT 'Opciones',
  name TEXT NOT NULL,
  option_type TEXT NOT NULL CHECK (option_type IN ('variant', 'extra')),
  price_delta NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(BTRIM(option_group)) BETWEEN 1 AND 60),
  CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS product_options_product_idx
  ON public.product_options (product_id, is_available, option_group);

CREATE UNIQUE INDEX IF NOT EXISTS products_id_business_id_uidx
  ON public.products (id, business_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_options'::REGCLASS
      AND conname = 'product_options_product_business_fk'
  ) THEN
    ALTER TABLE public.product_options
      ADD CONSTRAINT product_options_product_business_fk
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.product_options TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_options TO authenticated;

DROP POLICY IF EXISTS product_options_public_read ON public.product_options;
CREATE POLICY product_options_public_read
  ON public.product_options FOR SELECT TO anon, authenticated
  USING (
    is_available
    AND EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.businesses b ON b.id = p.business_id
      WHERE p.id = product_options.product_id
        AND p.is_available
        AND b.status = 'activo'
    )
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = product_options.business_id
        AND (b.profile_id = auth.uid() OR public.is_superadmin())
    )
  );

DROP POLICY IF EXISTS product_options_owner_write ON public.product_options;
CREATE POLICY product_options_owner_write
  ON public.product_options FOR ALL TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = product_options.business_id AND b.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = product_options.business_id AND b.profile_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.order_item_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  product_option_id UUID REFERENCES public.product_options(id) ON DELETE SET NULL,
  option_group TEXT NOT NULL,
  name TEXT NOT NULL,
  price_delta NUMERIC(12, 2) NOT NULL CHECK (price_delta >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.order_item_options TO authenticated;
DROP POLICY IF EXISTS order_item_options_order_participants_read ON public.order_item_options;
CREATE POLICY order_item_options_order_participants_read
  ON public.order_item_options FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_options.order_item_id
        AND (
          o.client_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = o.business_id AND b.profile_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = o.driver_id AND d.profile_id = auth.uid())
          OR public.is_superadmin()
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.customer_delivery_preferences (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  delivery_address TEXT NOT NULL CHECK (char_length(BTRIM(delivery_address)) BETWEEN 1 AND 300),
  delivery_instructions TEXT CHECK (delivery_instructions IS NULL OR char_length(delivery_instructions) <= 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customer_delivery_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_delivery_preferences FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.order_verification_secrets (
  order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  pickup_code TEXT NOT NULL CHECK (pickup_code ~ '^[0-9]{6}$'),
  pickup_code_hash TEXT NOT NULL,
  delivery_code TEXT NOT NULL CHECK (delivery_code ~ '^[0-9]{6}$'),
  delivery_code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.order_verification_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_verification_secrets FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.order_inventory_reservations (
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  released_at TIMESTAMPTZ,
  PRIMARY KEY (order_id, product_id)
);

ALTER TABLE public.order_inventory_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_inventory_reservations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.order_code_verification_attempts (
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL CHECK (verification_type IN ('pickup', 'delivery')),
  failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  PRIMARY KEY (order_id, driver_id, verification_type)
);

ALTER TABLE public.order_code_verification_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_code_verification_attempts FROM PUBLIC, anon, authenticated;

INSERT INTO public.order_verification_secrets (
  order_id, pickup_code, pickup_code_hash, delivery_code, delivery_code_hash
)
SELECT
  o.id,
  codes.pickup_code,
  encode(digest(codes.pickup_code, 'sha256'), 'hex'),
  codes.delivery_code,
  encode(digest(codes.delivery_code, 'sha256'), 'hex')
FROM public.orders o
CROSS JOIN LATERAL (
  SELECT
    substr(translate(md5(gen_random_uuid()::TEXT), 'abcdef', '123456'), 1, 6) AS pickup_code,
    substr(translate(md5(gen_random_uuid()::TEXT), 'abcdef', '123456'), 1, 6) AS delivery_code
) codes
ON CONFLICT (order_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_my_delivery_preferences()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'delivery_address', delivery_address,
    'delivery_instructions', delivery_instructions
  ) INTO v_result
  FROM public.customer_delivery_preferences
  WHERE profile_id = auth.uid();
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_delivery_preferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_delivery_preferences() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_order_verification_codes(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_codes public.order_verification_secrets%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_codes FROM public.order_verification_secrets WHERE order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order verification is not available'; END IF;

  IF v_order.client_id = auth.uid()
     AND v_order.status::TEXT NOT IN ('cancelado', 'entregado') THEN
    RETURN jsonb_build_object('order_number', v_order.order_number, 'delivery_code', v_codes.delivery_code);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = v_order.business_id AND b.profile_id = auth.uid()
  ) AND v_order.status::TEXT IN ('pagado', 'preparando', 'listo_para_repartidor', 'repartidor_asignado') THEN
    RETURN jsonb_build_object('order_number', v_order.order_number, 'pickup_code', v_codes.pickup_code);
  END IF;
  RAISE EXCEPTION 'Order verification code access denied' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_verification_codes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_verification_codes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_order_with_delivery_v2(
  p_business_id UUID,
  p_items JSONB,
  p_delivery_latitude DOUBLE PRECISION,
  p_delivery_longitude DOUBLE PRECISION,
  p_delivery_address TEXT,
  p_delivery_instructions TEXT DEFAULT NULL
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
  v_option JSONB;
  v_option_ids JSONB;
  v_product_id UUID;
  v_option_id UUID;
  v_quantity INTEGER;
  v_price NUMERIC(12, 2);
  v_line_price NUMERIC(12, 2);
  v_option_delta NUMERIC(12, 2);
  v_product_subtotal NUMERIC(12, 2) := 0;
  v_delivery_fee INTEGER;
  v_distance_meters INTEGER;
  v_order_id UUID;
  v_order_item_id UUID;
  v_subscribed BOOLEAN;
  v_wallet_balance NUMERIC(12, 2);
  v_inventory_enabled BOOLEAN;
  v_stock_quantity INTEGER;
  v_product_available BOOLEAN;
  v_address TEXT := NULLIF(BTRIM(p_delivery_address), '');
  v_instructions TEXT := NULLIF(BTRIM(p_delivery_instructions), '');
  v_pickup_code TEXT;
  v_delivery_code TEXT;
BEGIN
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = v_client_id;
  IF v_role IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'Only client accounts can place orders' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Invalid order item list';
  END IF;
  IF v_address IS NULL OR char_length(v_address) > 300 THEN
    RAISE EXCEPTION 'A delivery address of at most 300 characters is required';
  END IF;
  IF v_instructions IS NOT NULL AND char_length(v_instructions) > 500 THEN
    RAISE EXCEPTION 'Delivery instructions must be at most 500 characters';
  END IF;
  IF p_delivery_latitude IS NULL OR p_delivery_longitude IS NULL
     OR p_delivery_latitude NOT BETWEEN -90 AND 90
     OR p_delivery_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'A valid GPS delivery location is required';
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
    SELECT price, is_available, inventory_enabled, stock_quantity
      INTO v_price, v_product_available, v_inventory_enabled, v_stock_quantity
    FROM public.products
    WHERE id = v_product_id AND business_id = p_business_id
    FOR UPDATE;
    IF NOT FOUND OR NOT v_product_available OR v_price <= 0 THEN
      RAISE EXCEPTION 'Product is unavailable for this business';
    END IF;
    IF v_inventory_enabled AND (v_stock_quantity IS NULL OR v_stock_quantity < v_quantity) THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Product inventory is insufficient';
    END IF;

    v_option_ids := COALESCE(v_item -> 'option_ids', '[]'::JSONB);
    IF jsonb_typeof(v_option_ids) <> 'array' OR jsonb_array_length(v_option_ids) > 20 THEN
      RAISE EXCEPTION 'Invalid product options';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_option_ids) option_id
      GROUP BY option_id HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'A product option cannot be selected more than once';
    END IF;
    IF EXISTS (
      SELECT po.option_group
      FROM jsonb_array_elements_text(v_option_ids) selected(option_id)
      JOIN public.product_options po ON po.id = selected.option_id::UUID
      WHERE po.product_id = v_product_id AND po.option_type = 'variant' AND po.is_available
      GROUP BY po.option_group
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'Select only one variant per option group';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_option_ids) selected(option_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.product_options po
        WHERE po.id = selected.option_id::UUID
          AND po.product_id = v_product_id
          AND po.business_id = p_business_id
          AND po.is_available
      )
    ) THEN
      RAISE EXCEPTION 'A selected product option is unavailable';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.product_options required_option
      WHERE required_option.product_id = v_product_id
        AND required_option.is_available AND required_option.is_required
      GROUP BY required_option.option_group
      HAVING NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_option_ids) selected(option_id)
        JOIN public.product_options selected_option ON selected_option.id = selected.option_id::UUID
        WHERE selected_option.product_id = v_product_id
          AND selected_option.option_group = required_option.option_group
          AND selected_option.is_available
      )
    ) THEN
      RAISE EXCEPTION 'A required product option has not been selected';
    END IF;

    SELECT COALESCE(SUM(po.price_delta), 0) INTO v_option_delta
    FROM jsonb_array_elements_text(v_option_ids) selected(option_id)
    JOIN public.product_options po ON po.id = selected.option_id::UUID
    WHERE po.product_id = v_product_id AND po.business_id = p_business_id AND po.is_available;
    v_product_subtotal := v_product_subtotal + (v_price + v_option_delta) * v_quantity;
  END LOOP;

  SELECT q.distance_meters, q.delivery_fee_cop
  INTO v_distance_meters, v_delivery_fee
  FROM public.quote_delivery_fee(p_business_id, p_delivery_latitude, p_delivery_longitude) q;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = p_business_id AND is_active
      AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
  ) INTO v_subscribed;
  IF NOT v_subscribed THEN
    SELECT COALESCE(balance, 0) INTO v_wallet_balance
    FROM public.wallets WHERE business_id = p_business_id
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR v_wallet_balance < ROUND(v_product_subtotal * 0.10, 2) THEN
      RAISE EXCEPTION 'WALLET_INSUFFICIENT: Business wallet cannot cover the 10%% commission';
    END IF;
  END IF;

  INSERT INTO public.orders (
    client_id, business_id, total_amount, product_subtotal_cop, delivery_fee_cop,
    distance_meters, delivery_latitude, delivery_longitude, delivery_address,
    delivery_instructions, payment_method, status
  )
  VALUES (
    v_client_id, p_business_id, v_product_subtotal + v_delivery_fee, v_product_subtotal,
    v_delivery_fee, v_distance_meters, p_delivery_latitude, p_delivery_longitude,
    v_address, v_instructions, 'wompi', 'pendiente'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::UUID;
    v_quantity := (v_item ->> 'quantity')::INTEGER;
    v_option_ids := COALESCE(v_item -> 'option_ids', '[]'::JSONB);
    SELECT price, inventory_enabled INTO v_price, v_inventory_enabled
    FROM public.products WHERE id = v_product_id;
    SELECT COALESCE(SUM(po.price_delta), 0) INTO v_option_delta
    FROM jsonb_array_elements_text(v_option_ids) selected(option_id)
    JOIN public.product_options po ON po.id = selected.option_id::UUID
    WHERE po.product_id = v_product_id AND po.business_id = p_business_id AND po.is_available;
    v_line_price := v_price + v_option_delta;

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_line_price)
    RETURNING id INTO v_order_item_id;

    FOR v_option IN
      SELECT po.id, po.option_group, po.name, po.price_delta
      FROM jsonb_array_elements_text(v_option_ids) selected(option_id)
      JOIN public.product_options po ON po.id = selected.option_id::UUID
      WHERE po.product_id = v_product_id AND po.business_id = p_business_id AND po.is_available
    LOOP
      INSERT INTO public.order_item_options (
        order_item_id, product_option_id, option_group, name, price_delta
      ) VALUES (
        v_order_item_id, v_option.id, v_option.option_group, v_option.name, v_option.price_delta
      );
    END LOOP;

    UPDATE public.products
    SET stock_quantity = stock_quantity - v_quantity
    WHERE id = v_product_id
      AND inventory_enabled
      AND stock_quantity >= v_quantity;
    IF v_inventory_enabled AND NOT FOUND THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Product inventory changed while placing the order';
    END IF;
    IF FOUND THEN
      INSERT INTO public.order_inventory_reservations (order_id, product_id, quantity)
      VALUES (v_order_id, v_product_id, v_quantity)
      ON CONFLICT (order_id, product_id) DO UPDATE SET
        quantity = public.order_inventory_reservations.quantity + EXCLUDED.quantity;
    END IF;
  END LOOP;

  v_pickup_code := substr(translate(md5(gen_random_uuid()::TEXT), 'abcdef', '123456'), 1, 6);
  v_delivery_code := substr(translate(md5(gen_random_uuid()::TEXT), 'abcdef', '123456'), 1, 6);
  INSERT INTO public.order_verification_secrets (
    order_id, pickup_code, pickup_code_hash, delivery_code, delivery_code_hash
  ) VALUES (
    v_order_id, v_pickup_code, encode(digest(v_pickup_code, 'sha256'), 'hex'),
    v_delivery_code, encode(digest(v_delivery_code, 'sha256'), 'hex')
  );
  INSERT INTO public.customer_delivery_preferences (
    profile_id, delivery_address, delivery_instructions, updated_at
  ) VALUES (
    v_client_id, v_address, v_instructions, NOW()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    delivery_address = EXCLUDED.delivery_address,
    delivery_instructions = EXCLUDED.delivery_instructions,
    updated_at = NOW();

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_delivery_v2(UUID, JSONB, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_delivery_v2(UUID, JSONB, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.release_order_product_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status::TEXT = 'cancelado' AND OLD.status::TEXT <> 'cancelado' THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + reservation.quantity
    FROM public.order_inventory_reservations reservation
    WHERE reservation.order_id = NEW.id
      AND reservation.released_at IS NULL
      AND p.id = reservation.product_id
      AND p.inventory_enabled;
    UPDATE public.order_inventory_reservations
    SET released_at = NOW()
    WHERE order_id = NEW.id AND released_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_order_product_inventory ON public.orders;
CREATE TRIGGER release_order_product_inventory
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.release_order_product_inventory();

CREATE OR REPLACE FUNCTION public.expire_unpaid_order_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  UPDATE public.orders o
  SET status = 'cancelado',
      cancellation_reason = 'Pago no completado dentro de 30 minutos',
      cancelled_at = NOW()
  WHERE o.status::TEXT = 'pendiente'
    AND o.payment_method::TEXT = 'wompi'
    AND o.created_at <= NOW() - INTERVAL '30 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_payment_attempts a
      WHERE a.order_id = o.id
        AND a.status IN ('creating', 'reconciliation_required')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.wompi_transactions t
      WHERE t.order_id = o.id
        AND t.status NOT IN ('DECLINED', 'ERROR', 'VOIDED')
    );
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  RETURN v_expired_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_unpaid_order_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_order_reservations() TO service_role;

CREATE OR REPLACE FUNCTION public.verify_order_driver_code(
  p_order_id UUID,
  p_code TEXT,
  p_verification_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order_status TEXT;
  v_expected_status TEXT;
  v_next_status TEXT;
  v_expected_hash TEXT;
  v_failed_attempts SMALLINT;
  v_window_started_at TIMESTAMPTZ;
  v_locked_until TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_verification_type NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Invalid verification type';
  END IF;

  v_expected_status := CASE p_verification_type
    WHEN 'pickup' THEN 'repartidor_asignado'
    ELSE 'en_camino'
  END;
  v_next_status := CASE p_verification_type
    WHEN 'pickup' THEN 'recogido'
    ELSE 'entregado'
  END;

  SELECT d.id, o.status::TEXT,
    CASE p_verification_type
      WHEN 'pickup' THEN s.pickup_code_hash
      ELSE s.delivery_code_hash
    END
  INTO v_driver_id, v_order_status, v_expected_hash
  FROM public.orders o
  JOIN public.drivers d ON d.id = o.driver_id AND d.profile_id = auth.uid()
  JOIN public.order_verification_secrets s ON s.order_id = o.id
  WHERE o.id = p_order_id
  FOR UPDATE OF o;
  IF NOT FOUND OR v_order_status <> v_expected_status THEN
    RAISE EXCEPTION 'This order cannot be verified by the current driver';
  END IF;

  v_now := clock_timestamp();
  INSERT INTO public.order_code_verification_attempts (
    order_id, driver_id, verification_type, failed_attempts, window_started_at
  ) VALUES (
    p_order_id, v_driver_id, p_verification_type, 0, v_now
  )
  ON CONFLICT (order_id, driver_id, verification_type) DO NOTHING;

  SELECT failed_attempts, window_started_at, locked_until
  INTO v_failed_attempts, v_window_started_at, v_locked_until
  FROM public.order_code_verification_attempts
  WHERE order_id = p_order_id
    AND driver_id = v_driver_id
    AND verification_type = p_verification_type
  FOR UPDATE;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN FALSE;
  END IF;
  IF v_window_started_at <= v_now - INTERVAL '15 minutes' THEN
    v_failed_attempts := 0;
    UPDATE public.order_code_verification_attempts
    SET failed_attempts = 0, window_started_at = v_now, locked_until = NULL
    WHERE order_id = p_order_id
      AND driver_id = v_driver_id
      AND verification_type = p_verification_type;
  END IF;

  IF NOT COALESCE(p_code ~ '^[0-9]{6}$', FALSE)
     OR v_expected_hash <> encode(digest(p_code, 'sha256'), 'hex') THEN
    UPDATE public.order_code_verification_attempts
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE
          WHEN failed_attempts + 1 >= 5 THEN v_now + INTERVAL '15 minutes'
          ELSE NULL
        END
    WHERE order_id = p_order_id
      AND driver_id = v_driver_id
      AND verification_type = p_verification_type;
    RETURN FALSE;
  END IF;

  UPDATE public.orders
  SET status = v_next_status
  WHERE id = p_order_id AND status::TEXT = v_expected_status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order status changed during code verification';
  END IF;

  DELETE FROM public.order_code_verification_attempts
  WHERE order_id = p_order_id
    AND driver_id = v_driver_id
    AND verification_type = p_verification_type;

  IF p_verification_type = 'delivery' THEN
    INSERT INTO public.business_settlement_items (order_id, business_id, amount_cop)
    SELECT o.id, o.business_id, COALESCE(o.product_subtotal_cop, o.total_amount)
    FROM public.orders o
    WHERE o.id = p_order_id
    ON CONFLICT (order_id) DO NOTHING;
  END IF;

  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_order_driver_code(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.driver_verify_order_pickup(UUID, TEXT);
CREATE FUNCTION public.driver_verify_order_pickup(p_order_id UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.verify_order_driver_code(p_order_id, p_code, 'pickup');
$$;
REVOKE ALL ON FUNCTION public.driver_verify_order_pickup(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_verify_order_pickup(UUID, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.driver_complete_order_with_code(UUID, TEXT);
CREATE FUNCTION public.driver_complete_order_with_code(p_order_id UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.verify_order_driver_code(p_order_id, p_code, 'delivery');
$$;
REVOKE ALL ON FUNCTION public.driver_complete_order_with_code(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_complete_order_with_code(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.driver_mark_order_picked_up(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.driver_complete_order(UUID) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_financial_exception_reviews (
  exception_type TEXT NOT NULL CHECK (exception_type IN ('payment', 'refund', 'business_payout')),
  exception_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  note TEXT NOT NULL CHECK (char_length(BTRIM(note)) BETWEEN 1 AND 2000),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exception_type, exception_id)
);

ALTER TABLE public.admin_financial_exception_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_financial_exception_reviews FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_financial_exceptions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_result JSONB;
BEGIN
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exception_type', 'payment', 'exception_id', a.order_id::TEXT,
        'order_id', a.order_id, 'order_number', o.order_number, 'business_name', b.store_name,
        'amount_cop', a.amount_in_cents / 100.0, 'status', a.status,
        'reason', a.failure_reason, 'reference', a.payment_link_id,
        'transaction_ids', COALESCE((
          SELECT jsonb_agg(t.transaction_id ORDER BY t.created_at DESC)
          FROM public.wompi_transactions t WHERE t.order_id = a.order_id
        ), '[]'::JSONB),
        'updated_at', a.updated_at,
        'review_status', COALESCE(r.status, 'open'), 'review_note', r.note
      ) ORDER BY a.updated_at DESC)
      FROM public.order_payment_attempts a
      JOIN public.orders o ON o.id = a.order_id
      JOIN public.businesses b ON b.id = a.business_id
      LEFT JOIN public.admin_financial_exception_reviews r
        ON r.exception_type = 'payment' AND r.exception_id = a.order_id::TEXT
      WHERE a.status = 'reconciliation_required'
    ), '[]'::JSONB),
    'refunds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exception_type', 'refund', 'exception_id', r.id::TEXT,
        'order_id', r.order_id, 'order_number', o.order_number, 'business_name', b.store_name,
        'amount_cop', r.amount_in_cents / 100.0, 'status', r.status,
        'reason', r.reason, 'detail', r.status_message, 'reference', r.transaction_id,
        'provider_refund_id', r.wompi_refund_id, 'updated_at', r.updated_at,
        'review_status', COALESCE(review.status, 'open'), 'review_note', review.note
      ) ORDER BY r.updated_at DESC)
      FROM public.order_refunds r
      JOIN public.orders o ON o.id = r.order_id
      JOIN public.businesses b ON b.id = o.business_id
      LEFT JOIN public.admin_financial_exception_reviews review
        ON review.exception_type = 'refund' AND review.exception_id = r.id::TEXT
      WHERE r.status IN ('requested', 'submitting', 'pending', 'uncertain', 'error', 'declined', 'cancelled')
    ), '[]'::JSONB),
    'business_payouts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exception_type', 'business_payout', 'exception_id', p.id::TEXT,
        'business_id', p.business_id, 'business_name', b.store_name,
        'amount_cop', p.amount_cop, 'status', p.status, 'reference', p.reference,
        'reason', p.failure_reason, 'updated_at', p.updated_at,
        'review_status', COALESCE(review.status, 'open'), 'review_note', review.note
      ) ORDER BY p.updated_at DESC)
      FROM public.business_payouts p
      JOIN public.businesses b ON b.id = p.business_id
      LEFT JOIN public.admin_financial_exception_reviews review
        ON review.exception_type = 'business_payout' AND review.exception_id = p.id::TEXT
      WHERE p.status IN ('needs_review', 'failed')
        OR (p.status IN ('processing', 'pending') AND p.updated_at < NOW() - INTERVAL '24 hours')
    ), '[]'::JSONB)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_financial_exceptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_financial_exceptions() TO authenticated;

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
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
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

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname = 'istmiya-expire-unpaid-orders-every-5m'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'istmiya-expire-unpaid-orders-every-5m',
    '*/5 * * * *',
    'SELECT public.expire_unpaid_order_reservations()'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
