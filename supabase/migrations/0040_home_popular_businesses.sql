BEGIN;

-- Public home-page aggregate: returns active, verified businesses and their
-- non-pending, non-cancelled order count without exposing order/customer rows.
CREATE OR REPLACE FUNCTION public.get_home_popular_businesses(p_limit INTEGER DEFAULT 5)
RETURNS TABLE (
  id UUID,
  store_name TEXT,
  address TEXT,
  prep_time_t INTEGER,
  store_image_url TEXT,
  product_image_url TEXT,
  order_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.id,
    b.store_name,
    b.address,
    b.prep_time_t,
    b.store_image_url,
    featured_product.image_url,
    COUNT(o.id)::BIGINT AS order_count
  FROM public.businesses AS b
  LEFT JOIN LATERAL (
    SELECT p.image_url
    FROM public.products AS p
    WHERE p.business_id = b.id
      AND p.image_url IS NOT NULL
      AND p.is_available IS DISTINCT FROM FALSE
      AND (NOT p.inventory_enabled OR p.stock_quantity > 0)
    ORDER BY p.id
    LIMIT 1
  ) AS featured_product ON TRUE
  LEFT JOIN public.orders AS o
    ON o.business_id = b.id
   AND o.status::TEXT NOT IN ('pendiente', 'cancelado')
  WHERE b.status::TEXT = 'activo'
    AND public.is_business_verified(b.id)
  GROUP BY b.id, b.store_name, b.address, b.prep_time_t, b.store_image_url, featured_product.image_url
  ORDER BY COUNT(o.id) DESC, b.store_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 5);
$$;

REVOKE ALL ON FUNCTION public.get_home_popular_businesses(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_home_popular_businesses(INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
