BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::REGCLASS
      AND conname = 'products_reserved_quantity_nonnegative'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_reserved_quantity_nonnegative
      CHECK (reserved_quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::REGCLASS
      AND conname = 'products_reserved_quantity_within_stock'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_reserved_quantity_within_stock
      CHECK (stock_quantity IS NULL OR reserved_quantity <= stock_quantity);
  END IF;
END;
$$;

ALTER TABLE public.order_inventory_reservations
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ;

UPDATE public.order_inventory_reservations reservation
SET committed_at = COALESCE(reservation.committed_at, NOW())
FROM public.orders order_row
WHERE order_row.id = reservation.order_id
  AND order_row.status::TEXT = 'entregado'
  AND reservation.released_at IS NULL
  AND reservation.committed_at IS NULL;

WITH active_reservations AS (
  SELECT reservation.product_id, SUM(reservation.quantity)::INTEGER AS quantity
  FROM public.order_inventory_reservations reservation
  JOIN public.orders order_row ON order_row.id = reservation.order_id
  WHERE reservation.released_at IS NULL
    AND reservation.committed_at IS NULL
    AND order_row.status::TEXT NOT IN ('cancelado', 'entregado')
  GROUP BY reservation.product_id
)
UPDATE public.products product
SET stock_quantity = CASE
      WHEN product.inventory_enabled OR product.stock_quantity IS NOT NULL
        THEN COALESCE(product.stock_quantity, 0) + active_reservations.quantity
      ELSE product.stock_quantity
    END,
    reserved_quantity = active_reservations.quantity
FROM active_reservations
WHERE product.id = active_reservations.product_id;

UPDATE public.order_inventory_reservations reservation
SET released_at = COALESCE(reservation.released_at, NOW())
FROM public.orders order_row
WHERE order_row.id = reservation.order_id
  AND order_row.status::TEXT = 'cancelado'
  AND reservation.released_at IS NULL
  AND reservation.committed_at IS NULL;

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
  v_option RECORD;
  v_option_ids JSONB;
  v_product_id UUID;
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
  v_wallet_count INTEGER;
  v_inventory_enabled BOOLEAN;
  v_stock_quantity INTEGER;
  v_reserved_quantity INTEGER;
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
  -- Keep business-before-wallet lock order consistent with transfers and Wompi wallet credits.
  PERFORM id FROM public.businesses
  WHERE id = p_business_id AND status = 'activo'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business is not accepting orders';
  END IF;

  PERFORM product.id
  FROM public.products product
  JOIN (
    SELECT DISTINCT (item.value ->> 'product_id')::UUID AS product_id
    FROM jsonb_array_elements(p_items) AS item(value)
  ) requested ON requested.product_id = product.id
  WHERE product.business_id = p_business_id
  ORDER BY product.id
  FOR UPDATE OF product;

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
    SELECT price, is_available, inventory_enabled, stock_quantity, reserved_quantity
      INTO v_price, v_product_available, v_inventory_enabled, v_stock_quantity, v_reserved_quantity
    FROM public.products
    WHERE id = v_product_id AND business_id = p_business_id;
    IF NOT FOUND OR NOT v_product_available OR v_price <= 0 THEN
      RAISE EXCEPTION 'Product is unavailable for this business';
    END IF;
    IF v_inventory_enabled AND (
      v_stock_quantity IS NULL
      OR v_reserved_quantity IS NULL
      OR v_stock_quantity - v_reserved_quantity < v_quantity
    ) THEN
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
    PERFORM id FROM public.wallets
    WHERE business_id = p_business_id
    ORDER BY id
    FOR UPDATE;
    SELECT COUNT(*) INTO v_wallet_count
    FROM public.wallets
    WHERE business_id = p_business_id;
    IF v_wallet_count <> 1 THEN
      RAISE EXCEPTION 'Business wallet is missing or requires reconciliation';
    END IF;
    SELECT COALESCE(balance, 0) INTO v_wallet_balance
    FROM public.wallets WHERE business_id = p_business_id;
    IF v_wallet_balance < ROUND(v_product_subtotal * 0.10, 2) THEN
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

    IF v_inventory_enabled THEN
      UPDATE public.products
      SET reserved_quantity = reserved_quantity + v_quantity
      WHERE id = v_product_id
        AND inventory_enabled
        AND stock_quantity IS NOT NULL
        AND stock_quantity - reserved_quantity >= v_quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Product inventory changed while placing the order';
      END IF;
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
    v_order_id, v_pickup_code, encode(extensions.digest(v_pickup_code, 'sha256'), 'hex'),
    v_delivery_code, encode(extensions.digest(v_delivery_code, 'sha256'), 'hex')
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
DECLARE
  v_reservation RECORD;
BEGIN
  IF NEW.status::TEXT = 'entregado' AND OLD.status::TEXT IS DISTINCT FROM 'entregado' THEN
    FOR v_reservation IN
      SELECT product_id, quantity
      FROM public.order_inventory_reservations
      WHERE order_id = NEW.id
        AND released_at IS NULL
        AND committed_at IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.products
      SET stock_quantity = CASE
            WHEN inventory_enabled THEN stock_quantity - v_reservation.quantity
            ELSE stock_quantity
          END,
          reserved_quantity = reserved_quantity - v_reservation.quantity
      WHERE id = v_reservation.product_id
        AND reserved_quantity >= v_reservation.quantity
        AND (
          NOT inventory_enabled
          OR stock_quantity >= v_reservation.quantity
        );
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVENTORY_RESERVATION_INCONSISTENT: Could not commit stock for delivered order';
      END IF;

      UPDATE public.order_inventory_reservations
      SET committed_at = NOW()
      WHERE order_id = NEW.id
        AND product_id = v_reservation.product_id
        AND released_at IS NULL
        AND committed_at IS NULL;
    END LOOP;
  ELSIF NEW.status::TEXT = 'cancelado' AND OLD.status::TEXT IS DISTINCT FROM 'cancelado' THEN
    FOR v_reservation IN
      SELECT product_id, quantity
      FROM public.order_inventory_reservations
      WHERE order_id = NEW.id
        AND released_at IS NULL
        AND committed_at IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.products
      SET reserved_quantity = reserved_quantity - v_reservation.quantity
      WHERE id = v_reservation.product_id
        AND reserved_quantity >= v_reservation.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVENTORY_RESERVATION_INCONSISTENT: Could not release stock for cancelled order';
      END IF;

      UPDATE public.order_inventory_reservations
      SET released_at = NOW()
      WHERE order_id = NEW.id
        AND product_id = v_reservation.product_id
        AND released_at IS NULL
        AND committed_at IS NULL;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_order_product_inventory ON public.orders;
CREATE TRIGGER release_order_product_inventory
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.release_order_product_inventory();

CREATE OR REPLACE FUNCTION public.business_product_order_metrics(p_business_id UUID)
RETURNS TABLE(product_id UUID, order_count BIGINT, requested_units BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND profile_id = auth.uid()
  ) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Business access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT product.id,
         COUNT(DISTINCT order_item.order_id)::BIGINT,
         COALESCE(SUM(order_item.quantity), 0)::BIGINT
  FROM public.products product
  LEFT JOIN public.order_items order_item ON order_item.product_id = product.id
  LEFT JOIN public.orders order_row ON order_row.id = order_item.order_id
  WHERE product.business_id = p_business_id
    AND (order_item.order_id IS NULL OR order_row.business_id = p_business_id)
  GROUP BY product.id;
END;
$$;
REVOKE ALL ON FUNCTION public.business_product_order_metrics(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_product_order_metrics(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.product_availability_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_availability_requests_one_open_per_requester
  ON public.product_availability_requests (product_id, requester_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS product_availability_requests_business_open
  ON public.product_availability_requests (business_id, created_at DESC)
  WHERE status = 'open';

ALTER TABLE public.product_availability_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_availability_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_availability_requests TO authenticated;

DROP POLICY IF EXISTS product_availability_requests_business_read ON public.product_availability_requests;
CREATE POLICY product_availability_requests_business_read
  ON public.product_availability_requests FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.businesses business
      WHERE business.id = product_availability_requests.business_id
        AND business.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.request_product_availability(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_business_id UUID;
  v_is_available BOOLEAN;
  v_inventory_enabled BOOLEAN;
  v_stock_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_request_id UUID;
  v_created BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'cliente' THEN
    RAISE EXCEPTION 'Only client accounts can request availability' USING ERRCODE = '42501';
  END IF;

  SELECT business_id, is_available, inventory_enabled, stock_quantity, reserved_quantity
  INTO v_business_id, v_is_available, v_inventory_enabled, v_stock_quantity, v_reserved_quantity
  FROM public.products
  WHERE id = p_product_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF v_is_available AND (
    NOT v_inventory_enabled
    OR COALESCE(v_stock_quantity, 0) > COALESCE(v_reserved_quantity, 0)
  ) THEN
    RAISE EXCEPTION 'Product is already available';
  END IF;

  INSERT INTO public.product_availability_requests (
    product_id, business_id, requester_id, status, created_at, updated_at
  ) VALUES (
    p_product_id, v_business_id, auth.uid(), 'open', NOW(), NOW()
  )
  ON CONFLICT (product_id, requester_id) WHERE status = 'open'
  DO UPDATE SET updated_at = NOW()
  RETURNING id, (xmax = 0) INTO v_request_id, v_created;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'created', v_created,
    'status', 'open'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.request_product_availability(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_product_availability(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_product_availability(
  p_product_id UUID,
  p_is_available BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_inventory_enabled BOOLEAN;
  v_stock_quantity INTEGER;
  v_reserved_quantity INTEGER;
BEGIN
  SELECT product.business_id, product.inventory_enabled,
         product.stock_quantity, product.reserved_quantity
  INTO v_business_id, v_inventory_enabled, v_stock_quantity, v_reserved_quantity
  FROM public.products product
  JOIN public.businesses business ON business.id = product.business_id
  WHERE product.id = p_product_id
    AND (business.profile_id = auth.uid() OR public.is_admin())
  FOR UPDATE OF product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or access denied' USING ERRCODE = '42501';
  END IF;
  IF p_is_available AND v_inventory_enabled
     AND (v_stock_quantity IS NULL OR v_stock_quantity <= v_reserved_quantity) THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: Add available stock before marking this product available';
  END IF;

  UPDATE public.products
  SET is_available = p_is_available
  WHERE id = p_product_id;

  UPDATE public.product_availability_requests
  SET status = 'resolved',
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE product_id = p_product_id AND status = 'open';
END;
$$;
REVOKE ALL ON FUNCTION public.set_product_availability(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_availability(UUID, BOOLEAN) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'product_availability_requests'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_availability_requests;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
