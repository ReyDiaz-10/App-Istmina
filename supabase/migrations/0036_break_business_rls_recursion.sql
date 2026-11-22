-- Restore the SECURITY DEFINER verification lookup so the businesses and
-- business_verifications SELECT policies do not recurse into each other.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_business_verified(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'public.is_business_verified(uuid) is missing; apply 0010_public_verified_business_lookup.sql first.';
  END IF;
END;
$$;

DROP POLICY IF EXISTS businesses_select_public_or_owner ON public.businesses;
CREATE POLICY businesses_select_public_or_owner
  ON public.businesses FOR SELECT TO anon, authenticated
  USING (
    (
      status = 'activo'
      AND public.is_business_verified(id)
    )
    OR profile_id = auth.uid()
    OR public.is_admin()
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
