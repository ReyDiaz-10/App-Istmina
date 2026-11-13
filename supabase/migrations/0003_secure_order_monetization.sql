ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'activo';

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS plate_number TEXT;

CREATE TABLE IF NOT EXISTS public.wompi_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_link_id TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('order', 'wallet', 'subscription')),
  order_id UUID REFERENCES public.orders(id),
  business_id UUID NOT NULL REFERENCES public.businesses(id),
  amount_in_cents BIGINT NOT NULL CHECK (amount_in_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (purpose = 'order' AND order_id IS NOT NULL)
    OR (purpose IN ('wallet', 'subscription') AND order_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.wompi_transactions (
  transaction_id TEXT PRIMARY KEY,
  payment_link_id TEXT NOT NULL REFERENCES public.wompi_payment_links(payment_link_id),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wompi_payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wompi_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wompi_payment_links, public.wompi_transactions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.wompi_payment_links, public.wompi_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role::TEXT = 'superadmin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_driver_order_participant(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.driver_id = p_driver_id
      AND (
        o.client_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.businesses b
          WHERE b.id = o.business_id AND b.profile_id = auth.uid()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_driver_order_participant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_driver_order_participant(UUID) TO authenticated, service_role;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS businesses_select_public_or_owner ON public.businesses;
CREATE POLICY businesses_select_public_or_owner
  ON public.businesses FOR SELECT TO anon, authenticated
  USING (
    status = 'activo'
    OR profile_id = auth.uid()
    OR public.is_superadmin()
  );

DROP POLICY IF EXISTS businesses_insert_owner ON public.businesses;
CREATE POLICY businesses_insert_owner
  ON public.businesses FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role::TEXT = 'negocio'
    )
  );

DROP POLICY IF EXISTS businesses_update_owner_or_admin ON public.businesses;
CREATE POLICY businesses_update_owner_or_admin
  ON public.businesses FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR public.is_superadmin())
  WITH CHECK (profile_id = auth.uid() OR public.is_superadmin());

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_select_active_businesses ON public.products;
CREATE POLICY products_select_active_businesses
  ON public.products FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = products.business_id
        AND (
          b.status = 'activo'
          OR b.profile_id = auth.uid()
          OR public.is_superadmin()
        )
    )
  );

DROP POLICY IF EXISTS products_insert_owner_or_admin ON public.products;
CREATE POLICY products_insert_owner_or_admin
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = products.business_id AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS products_update_owner_or_admin ON public.products;
CREATE POLICY products_update_owner_or_admin
  ON public.products FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = products.business_id AND b.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = products.business_id AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS products_delete_owner_or_admin ON public.products;
CREATE POLICY products_delete_owner_or_admin
  ON public.products FOR DELETE TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = products.business_id AND b.profile_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_client_superadmin_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role::TEXT = 'superadmin'
     AND (TG_OP = 'INSERT' OR OLD.role::TEXT <> 'superadmin')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only a trusted server can assign the SuperAdmin role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_client_superadmin_assignment ON public.profiles;
CREATE TRIGGER prevent_client_superadmin_assignment
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_superadmin_assignment();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_superadmin());

DROP POLICY IF EXISTS profiles_select_order_participants ON public.profiles;
CREATE POLICY profiles_select_order_participants
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE (
        o.client_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.businesses b
          WHERE b.id = o.business_id AND b.profile_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.drivers d
          WHERE d.profile_id = auth.uid()
            AND (d.id = o.driver_id OR o.status::TEXT = 'listo_para_repartidor')
        )
      )
      AND (
        o.client_id = profiles.id
        OR EXISTS (
          SELECT 1 FROM public.drivers d
          WHERE d.id = o.driver_id AND d.profile_id = profiles.id
        )
      )
    )
  );

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND role::TEXT <> 'superadmin');

DROP POLICY IF EXISTS profiles_update_self_or_admin ON public.profiles;
CREATE POLICY profiles_update_self_or_admin
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_superadmin())
  WITH CHECK (id = auth.uid() OR public.is_superadmin());

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drivers_select_owner_or_order_participant ON public.drivers;
CREATE POLICY drivers_select_owner_or_order_participant
  ON public.drivers FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_superadmin()
    OR public.is_driver_order_participant(id)
  );

DROP POLICY IF EXISTS drivers_update_owner ON public.drivers;
CREATE POLICY drivers_update_owner
  ON public.drivers FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR public.is_superadmin())
  WITH CHECK (profile_id = auth.uid() OR public.is_superadmin());

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_select_involved_parties ON public.orders;
CREATE POLICY orders_select_involved_parties
  ON public.orders FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = orders.business_id AND b.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.profile_id = auth.uid()
        AND (
          d.id = orders.driver_id
          OR (orders.status::TEXT = 'listo_para_repartidor' AND d.is_available)
        )
    )
  );

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_select_involved_parties ON public.order_items;
CREATE POLICY order_items_select_involved_parties
  ON public.order_items FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id)
  );

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallets_select_owner_or_admin ON public.wallets;
CREATE POLICY wallets_select_owner_or_admin
  ON public.wallets FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = wallets.business_id AND b.profile_id = auth.uid()
    )
  );

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_select_owner_or_admin ON public.subscriptions;
CREATE POLICY subscriptions_select_owner_or_admin
  ON public.subscriptions FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = subscriptions.business_id AND b.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS subscriptions_select_active_public ON public.subscriptions;
CREATE POLICY subscriptions_select_active_public
  ON public.subscriptions FOR SELECT TO anon, authenticated
  USING (is_active AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE);

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chats_select_order_participants ON public.chats;
CREATE POLICY chats_select_order_participants
  ON public.chats FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = chats.order_id
        AND o.status::TEXT IN (
          'pagado', 'preparando', 'listo_para_repartidor', 'en_camino', 'entregado'
        )
        AND (
          o.client_id = auth.uid()
          OR public.is_superadmin()
          OR EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id = o.business_id AND b.profile_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS chats_insert_order_participants ON public.chats;
CREATE POLICY chats_insert_order_participants
  ON public.chats FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = chats.order_id
        AND o.status::TEXT IN (
          'pagado', 'preparando', 'listo_para_repartidor', 'en_camino', 'entregado'
        )
        AND (
          o.client_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.businesses b
            WHERE b.id = o.business_id AND b.profile_id = auth.uid()
          )
        )
    )
  );

DROP TRIGGER IF EXISTS trigger_deduct_wallet ON public.orders;

CREATE OR REPLACE FUNCTION public.create_order(
  p_business_id UUID,
  p_items JSONB,
  p_payment_method public.payment_method DEFAULT 'wompi'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id UUID := auth.uid();
  v_role TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_quantity INTEGER;
  v_price NUMERIC(12, 2);
  v_total NUMERIC(12, 2) := 0;
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

    v_total := v_total + v_price * v_quantity;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = p_business_id
      AND is_active
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
  ) INTO v_subscribed;

  IF NOT v_subscribed THEN
    SELECT balance INTO v_wallet_balance
    FROM public.wallets
    WHERE business_id = p_business_id
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_wallet_balance < ROUND(v_total * 0.10, 2) THEN
      RAISE EXCEPTION 'WALLET_INSUFFICIENT: Business wallet cannot cover the 10%% commission';
    END IF;
  END IF;

  INSERT INTO public.orders (
    client_id, business_id, total_amount, payment_method, status
  )
  VALUES (v_client_id, p_business_id, v_total, p_payment_method, 'pendiente')
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

  v_fee := CASE WHEN v_subscribed THEN 0 ELSE ROUND(v_order.total_amount * 0.10, 2) END;

  IF NOT v_subscribed THEN
    SELECT id, balance INTO v_wallet_id, v_balance
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

CREATE OR REPLACE FUNCTION public.mark_order_ready(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.orders o
  SET status = 'listo_para_repartidor'
  FROM public.businesses b
  WHERE o.id = p_order_id
    AND o.business_id = b.id
    AND b.profile_id = auth.uid()
    AND o.status = 'preparando';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cannot be marked ready by this business';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver_id UUID;
  v_order_status public.order_status;
BEGIN
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE profile_id = auth.uid() AND is_available
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An available driver profile is required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE driver_id = v_driver_id AND status = 'en_camino'
  ) THEN
    RAISE EXCEPTION 'Driver already has an active delivery';
  END IF;

  SELECT status INTO v_order_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order_status <> 'listo_para_repartidor' THEN
    RAISE EXCEPTION 'Order is no longer available';
  END IF;

  UPDATE public.orders
  SET driver_id = v_driver_id, status = 'en_camino'
  WHERE id = p_order_id
    AND status = 'listo_para_repartidor'
    AND driver_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order was already accepted by another driver';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_complete_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.orders o
  SET status = 'entregado'
  FROM public.drivers d
  WHERE o.id = p_order_id
    AND o.driver_id = d.id
    AND d.profile_id = auth.uid()
    AND o.status = 'en_camino';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cannot be completed by this driver';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_wompi_payment(
  p_transaction_id TEXT,
  p_payment_link_id TEXT,
  p_amount_in_cents BIGINT,
  p_currency TEXT,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.wompi_payment_links%ROWTYPE;
  v_rows INTEGER;
  v_subscription_id UUID;
  v_subscription_end DATE;
BEGIN
  IF p_transaction_id IS NULL OR p_payment_link_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_link
  FROM public.wompi_payment_links
  WHERE payment_link_id = p_payment_link_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF p_amount_in_cents <> v_link.amount_in_cents OR p_currency <> 'COP' THEN
    RAISE EXCEPTION 'Wompi payment amount or currency does not match';
  END IF;

  INSERT INTO public.wompi_transactions (transaction_id, payment_link_id, status)
  VALUES (p_transaction_id, p_payment_link_id, p_status)
  ON CONFLICT (transaction_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.wompi_payment_links SET status = LOWER(p_status)
  WHERE payment_link_id = p_payment_link_id;

  IF p_status <> 'APPROVED' THEN
    RETURN FALSE;
  END IF;

  IF v_link.purpose = 'order' THEN
    UPDATE public.orders
    SET status = 'pagado'
    WHERE id = v_link.order_id
      AND business_id = v_link.business_id
      AND payment_method::TEXT = 'wompi'
      AND status = 'pendiente'
      AND ROUND(total_amount * 100)::BIGINT = v_link.amount_in_cents;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wompi payment does not match a pending order';
    END IF;
  ELSIF v_link.purpose = 'wallet' THEN
    UPDATE public.wallets
    SET balance = balance + (v_link.amount_in_cents::NUMERIC / 100),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM public.wallets
      WHERE business_id = v_link.business_id
      ORDER BY id
      LIMIT 1
      FOR UPDATE
    );

    IF NOT FOUND THEN
      INSERT INTO public.wallets (business_id, balance)
      VALUES (v_link.business_id, v_link.amount_in_cents::NUMERIC / 100);
    END IF;

    UPDATE public.businesses
    SET status = 'activo'
    WHERE id = v_link.business_id AND status = 'fuera_de_servicio';
  ELSE
    PERFORM 1 FROM public.businesses WHERE id = v_link.business_id FOR UPDATE;

    SELECT id, end_date INTO v_subscription_id, v_subscription_end
    FROM public.subscriptions
    WHERE business_id = v_link.business_id
    ORDER BY end_date DESC, id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.subscriptions
      SET is_active = TRUE,
          start_date = CASE
            WHEN end_date >= CURRENT_DATE THEN start_date
            ELSE CURRENT_DATE
          END,
          end_date = GREATEST(end_date, CURRENT_DATE) + 30
      WHERE id = v_subscription_id;
    ELSE
      INSERT INTO public.subscriptions (business_id, start_date, end_date, is_active)
      VALUES (v_link.business_id, CURRENT_DATE, CURRENT_DATE + 30, TRUE);
    END IF;

    UPDATE public.businesses
    SET status = 'activo'
    WHERE id = v_link.business_id AND status = 'fuera_de_servicio';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order(UUID, JSONB, public.payment_method) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_business_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_order_ready(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_accept_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_complete_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_wompi_payment(TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order(UUID, JSONB, public.payment_method) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_business_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_ready(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_accept_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_complete_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wompi_payment(TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chats'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wallets'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'subscriptions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
    END IF;
  END IF;
END;
$$;
