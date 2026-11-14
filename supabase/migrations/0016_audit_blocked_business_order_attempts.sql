CREATE OR REPLACE FUNCTION public.record_blocked_business_order_attempt(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::TEXT = 'cliente'
  ) THEN
    RAISE EXCEPTION 'Client authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found';
  END IF;

  PERFORM public.write_system_audit_log(
    auth.uid(),
    'intentó pedir en un negocio con saldo insuficiente',
    'business',
    p_business_id::TEXT,
    jsonb_build_object('business_id', p_business_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_blocked_business_order_attempt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_blocked_business_order_attempt(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
