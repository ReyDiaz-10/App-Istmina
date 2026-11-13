CREATE OR REPLACE FUNCTION public.is_business_verified(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_verifications
    WHERE business_id = p_business_id
      AND verification_status = 'aprobado'
  );
$$;

REVOKE ALL ON FUNCTION public.is_business_verified(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_verified(UUID)
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS businesses_select_public_or_owner ON public.businesses;
CREATE POLICY businesses_select_public_or_owner
  ON public.businesses FOR SELECT TO anon, authenticated
  USING (
    (
      status = 'activo'
      AND public.is_business_verified(id)
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
            AND public.is_business_verified(b.id)
          )
          OR b.profile_id = auth.uid()
          OR public.is_superadmin()
        )
    )
  );
