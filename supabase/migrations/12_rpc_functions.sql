-- =============================================================================
-- 12_rpc_functions.sql
-- Funções RPC de busca por telefone e pagamento atômico
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_barber_by_phone(input_phone TEXT)
RETURNS SETOF public.barbers
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.barbers
  WHERE regexp_replace(coalesce(phone, ''), '\D', '', 'g') = regexp_replace(coalesce(input_phone, ''), '\D', '', 'g')
    AND active = true
  LIMIT 1;
$$;
