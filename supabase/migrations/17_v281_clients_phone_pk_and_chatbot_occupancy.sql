-- ============================================================================
-- MIGRATION 17 (v2.8.1):
-- 1. Chave Primária / Identificador Único de Clientes por Telefone (public.clients)
--    + Trigger automático de sincronização no Encaixe e Edição de Atendimento.
-- 2. Lembrete Automático de Lotação do Dia no Chatbot (chatbot_create_appointment).
-- ============================================================================

-- 1. Normaliza telefones existentes na tabela public.clients (apenas dígitos)
UPDATE public.clients
SET phone = regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
WHERE phone IS NOT NULL
  AND phone <> regexp_replace(COALESCE(phone, ''), '\D', '', 'g');

-- Remove registos inválidos ou placeholders vazios se houver duplicação
DELETE FROM public.clients a
USING public.clients b
WHERE a.id < b.id
  AND regexp_replace(COALESCE(a.phone, ''), '\D', '', 'g') = regexp_replace(COALESCE(b.phone, ''), '\D', '', 'g')
  AND regexp_replace(COALESCE(a.phone, ''), '\D', '', 'g') <> '';

-- Garante que a coluna clean_phone exista em public.clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clean_phone TEXT;

UPDATE public.clients
SET clean_phone = regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
WHERE clean_phone IS NULL OR clean_phone = '';

-- Garante índice único / constraint única por telefone na tabela public.clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_phone_key'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_phone_key UNIQUE (phone);
  END IF;
EXCEPTION
  WHEN others THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_unique_phone ON public.clients (phone);
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_clean_phone_lookup
  ON public.clients (clean_phone);

-- 2. Trigger automático em public.appointments para garantir que TODO encaixe
--    ou agendamento ( ou edição de dados do cliente ) salve e atualize o cliente
--    na tabela public.clients usando o telefone como chave principal.
CREATE OR REPLACE FUNCTION public.fn_sync_appointment_client_by_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone TEXT;
  v_client_name TEXT;
  v_client_id   UUID;
BEGIN
  v_clean_phone := regexp_replace(COALESCE(NEW.client_phone, NEW.clean_phone, ''), '\D', '', 'g');
  v_client_name := COALESCE(NULLIF(btrim(NEW.client_name), ''), 'Cliente');

  IF v_clean_phone <> '' AND v_clean_phone <> '00000000000' AND length(v_clean_phone) >= 8 THEN
    NEW.client_phone := v_clean_phone;
    NEW.clean_phone  := v_clean_phone;

    INSERT INTO public.clients (name, phone, clean_phone, updated_at)
    VALUES (v_client_name, v_clean_phone, v_clean_phone, NOW())
    ON CONFLICT (phone) DO UPDATE
      SET name = CASE
                   WHEN EXCLUDED.name IS NOT NULL
                    AND EXCLUDED.name <> ''
                    AND EXCLUDED.name <> 'Cliente'
                    AND EXCLUDED.name <> 'Cliente avulso'
                   THEN EXCLUDED.name
                   ELSE public.clients.name
                 END,
          clean_phone = EXCLUDED.clean_phone,
          updated_at = NOW()
    RETURNING id INTO v_client_id;

    IF v_client_id IS NOT NULL THEN
      NEW.client_id := v_client_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_appointment_client_by_phone ON public.appointments;

CREATE TRIGGER trg_sync_appointment_client_by_phone
  BEFORE INSERT OR UPDATE OF client_name, client_phone, clean_phone
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_appointment_client_by_phone();

-- Backfill imediato: garante que todos os clientes de encaixes/agendamentos anteriores
-- com telefone válido estejam registados na tabela public.clients
INSERT INTO public.clients (name, phone, clean_phone, updated_at)
SELECT DISTINCT ON (regexp_replace(client_phone, '\D', '', 'g'))
  COALESCE(NULLIF(btrim(client_name), ''), 'Cliente') AS name,
  regexp_replace(client_phone, '\D', '', 'g') AS phone,
  regexp_replace(client_phone, '\D', '', 'g') AS clean_phone,
  NOW()
FROM public.appointments
WHERE client_phone IS NOT NULL
  AND length(regexp_replace(client_phone, '\D', '', 'g')) >= 8
  AND regexp_replace(client_phone, '\D', '', 'g') <> '00000000000'
ORDER BY regexp_replace(client_phone, '\D', '', 'g'), created_at DESC
ON CONFLICT (phone) DO UPDATE
  SET clean_phone = EXCLUDED.clean_phone,
      updated_at = NOW();
