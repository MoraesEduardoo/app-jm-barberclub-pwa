-- ==============================================================================
-- MIGRAÇÃO 16: ORDENAÇÃO PERSONALIZADA DE SERVIÇOS (PAINEL ADMIN & CHATBOT v2.8)
-- Sistema: JM BarberClub (Supabase / PostgreSQL)
-- Arquivo: supabase/migrations/16_v28_services_custom_ordering.sql
-- ==============================================================================
-- Objetivos:
-- 1. Adicionar a coluna numérica `ordem` (INTEGER) e `position` (INTEGER) na tabela
--    `public.services` (mantendo sincronia com `display_order`).
-- 2. Popular valores iniciais sequenciais (1, 2, 3...) para todos os serviços já
--    existentes, eliminando qualquer valor nulo ou ambíguo.
-- 3. Criar índices B-Tree dedicados (`ORDER BY ordem ASC`) e atualizar o trigger
--    `sync_services_columns` mais as RPCs do Chatbot e de Reordenação Atômica.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. ADIÇÃO DAS COLUNAS DE ORDENAÇÃO NA TABELA `public.services`
-- ==============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS ordem integer,
  ADD COLUMN IF NOT EXISTS position integer,
  ADD COLUMN IF NOT EXISTS display_order integer;


-- ==============================================================================
-- 2. POPULAÇÃO SEQUENCIAL INICIAL (1, 2, 3...) PARA SERVIÇOS EXISTENTES
--    Respeita a ordem prévia caso já configurada ou a ordem oficial do catálogo,
--    garantindo que nenhum registo fique com valor NULL.
-- ==============================================================================

WITH ranked_services AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(
          NULLIF(ordem, 0),
          NULLIF(position, 0),
          NULLIF(display_order, 0),
          CASE
            WHEN name ILIKE 'Degradê' THEN 1
            WHEN name ILIKE '%Tesoura%' THEN 2
            WHEN name ILIKE '%Lowfade%' THEN 3
            WHEN name ILIKE 'Barboterapia' THEN 4
            WHEN name ILIKE '%Corte e Barboterapia%' THEN 5
            WHEN name ILIKE '%Corte + Barba%' THEN 6
            WHEN name ILIKE '%Barba (Design Simples)%' THEN 7
            ELSE 9999
          END
        ) ASC,
        created_at ASC,
        name ASC,
        id ASC
    )::integer AS seq_num
  FROM public.services
)
UPDATE public.services s
SET
  ordem = r.seq_num,
  position = r.seq_num,
  display_order = r.seq_num,
  updated_at = now()
FROM ranked_services r
WHERE s.id = r.id;

-- Garante restrição NOT NULL e valor padrão seguro após o backfill
ALTER TABLE public.services
  ALTER COLUMN ordem SET DEFAULT 1,
  ALTER COLUMN ordem SET NOT NULL,
  ALTER COLUMN position SET DEFAULT 1,
  ALTER COLUMN position SET NOT NULL,
  ALTER COLUMN display_order SET DEFAULT 1,
  ALTER COLUMN display_order SET NOT NULL;


-- ==============================================================================
-- 3. TRIGGER DE SINCRONIZAÇÃO E AUTO-SEQUENCIAMENTO (`sync_services_columns`)
--    - Em novos INSERTs sem `ordem` explícita, atribui automaticamente MAX(ordem) + 1.
--    - Mantém `ordem`, `position` e `display_order` 100% sincronizados em qualquer
--      INSERT ou UPDATE originado pelo Painel Admin ou via SQL.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sync_services_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_next_order integer;
  v_resolved_order integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Sincronização de duração
    IF NEW.default_duration_minutes IS NOT NULL AND NEW.default_duration_minutes <> 30 AND NEW.duration_minutes = 30 THEN
      NEW.duration_minutes := NEW.default_duration_minutes;
    ELSE
      NEW.default_duration_minutes := COALESCE(NEW.duration_minutes, NEW.default_duration_minutes, 30);
      NEW.duration_minutes := COALESCE(NEW.duration_minutes, NEW.default_duration_minutes, 30);
    END IF;

    -- Sincronização de status ativo
    IF NEW.active IS NOT NULL AND NEW.is_active IS DISTINCT FROM NEW.active THEN
      NEW.is_active := NEW.active;
    ELSE
      NEW.active := COALESCE(NEW.is_active, true);
      NEW.is_active := COALESCE(NEW.is_active, true);
    END IF;

    -- Resolução e auto-incremento sequencial de `ordem` (1, 2, 3...)
    v_resolved_order := COALESCE(
      NULLIF(NEW.ordem, 0),
      NULLIF(NEW.position, 0),
      NULLIF(NEW.display_order, 0)
    );

    IF v_resolved_order IS NULL THEN
      SELECT COALESCE(MAX(ordem), 0) + 1
      INTO v_next_order
      FROM public.services;
      v_resolved_order := COALESCE(v_next_order, 1);
    END IF;

    NEW.ordem := v_resolved_order;
    NEW.position := v_resolved_order;
    NEW.display_order := v_resolved_order;
  ELSE
    -- UPDATE: Sincronização de duração
    IF NEW.default_duration_minutes IS DISTINCT FROM OLD.default_duration_minutes THEN
      NEW.duration_minutes := NEW.default_duration_minutes;
    ELSIF NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
      NEW.default_duration_minutes := NEW.duration_minutes;
    END IF;

    -- UPDATE: Sincronização de status ativo
    IF NEW.active IS DISTINCT FROM OLD.active THEN
      NEW.is_active := NEW.active;
    ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      NEW.active := NEW.is_active;
    END IF;

    -- UPDATE: Sincronização bidirecional entre `ordem`, `position` e `display_order`
    IF NEW.ordem IS DISTINCT FROM OLD.ordem AND NEW.ordem IS NOT NULL THEN
      v_resolved_order := NEW.ordem;
    ELSIF NEW.position IS DISTINCT FROM OLD.position AND NEW.position IS NOT NULL THEN
      v_resolved_order := NEW.position;
    ELSIF NEW.display_order IS DISTINCT FROM OLD.display_order AND NEW.display_order IS NOT NULL THEN
      v_resolved_order := NEW.display_order;
    ELSE
      v_resolved_order := COALESCE(NEW.ordem, NEW.position, NEW.display_order, OLD.ordem, 1);
    END IF;

    NEW.ordem := v_resolved_order;
    NEW.position := v_resolved_order;
    NEW.display_order := v_resolved_order;
  END IF;

  -- Sincronização de preço (Reais <-> Centavos)
  IF NEW.price IS NOT NULL THEN
    NEW.price_in_cents := ROUND(NEW.price * 100)::integer;
  ELSIF NEW.price_in_cents IS NOT NULL THEN
    NEW.price := ROUND((NEW.price_in_cents / 100.0)::numeric, 2);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_services_columns ON public.services;
CREATE TRIGGER trg_sync_services_columns
BEFORE INSERT OR UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.sync_services_columns();


-- ==============================================================================
-- 4. ÍNDICES DE ALTA PERFORMANCE PARA `ORDER BY ordem ASC`
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_services_ordem_asc
  ON public.services (ordem ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_services_active_ordem_asc
  ON public.services (is_active, ordem ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_services_position_asc
  ON public.services (position ASC, name ASC);


-- ==============================================================================
-- 5. FUNÇÃO RPC PARA REORDENAÇÃO ATÔMICA PELO PAINEL (`reorder_services_atomic`)
--    Recebe a lista de IDs na ordem definida pelo barbeiro e grava 1, 2, 3...
-- ==============================================================================

DROP FUNCTION IF EXISTS public.reorder_services_atomic(uuid[]) CASCADE;

CREATE OR REPLACE FUNCTION public.reorder_services_atomic(
  p_service_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idx integer;
  v_len integer;
BEGIN
  v_len := COALESCE(array_length(p_service_ids, 1), 0);
  IF v_len = 0 THEN
    RETURN jsonb_build_object('success', true, 'updated', 0);
  END IF;

  FOR v_idx IN 1..v_len LOOP
    UPDATE public.services
    SET
      ordem = v_idx,
      position = v_idx,
      display_order = v_idx,
      updated_at = now()
    WHERE id = p_service_ids[v_idx];
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_len);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_services_atomic(uuid[]) TO anon, authenticated, service_role;


-- ==============================================================================
-- 6. FUNÇÃO RPC DE LISTAGEM DE SERVIÇOS PARA O CHATBOT (`chatbot_list_services`)
--    Garante retorno sempre ordenado por `ORDER BY s.ordem ASC, s.name ASC`,
--    já resolvendo `custom_duration` e `custom_price` se `p_barber_id` for informado.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.chatbot_list_services(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.chatbot_list_services(
  p_barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  category text,
  price numeric(10,2),
  duration_minutes integer,
  image_url text,
  ordem integer,
  "position" integer,
  display_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.description,
    COALESCE(s.category, 'cabelo') AS category,
    COALESCE(bs.custom_price, s.price, 0.00)::numeric(10,2) AS price,
    COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)::integer AS duration_minutes,
    COALESCE(s.image_url, s.storage_url) AS image_url,
    s.ordem,
    s.position,
    s.display_order
  FROM public.services s
  LEFT JOIN public.barber_services bs
    ON bs.service_id = s.id
   AND p_barber_id IS NOT NULL
   AND bs.barber_id = p_barber_id
  WHERE COALESCE(s.is_active, s.active, true) = true
    AND (p_barber_id IS NULL OR COALESCE(bs.is_active, true) = true)
  ORDER BY s.ordem ASC, s.position ASC, s.display_order ASC, s.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chatbot_list_services(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
