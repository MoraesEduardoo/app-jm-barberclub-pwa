-- =============================================================================
-- 25_barter_category.sql
-- Categoria de Troca de Serviço (Permuta) e correção resiliente da trigger
--
-- Cobertura de Categorias Padrão:
-- - 'Academia'
-- - 'Lava jato'
-- - 'Iptv'
-- - 'Consertos para barbearia'
-- - Outros / Livre (armazenado diretamente ou complementado em barter_notes)
--
-- Correções Estruturais e de Robustez:
-- 1. Cria a coluna barter_category em public.clients e em public.appointments.
-- 2. Elimina qualquer dependência de `unaccent` na identificação do Matheus:
--    Usa checagem direta e universal: (role = 'admin' OR lower(name) LIKE '%matheus%').
-- 3. Define SET search_path = public, extensions para total segurança de execução.
-- 4. Quando o agendamento for com o Matheus e o cliente tiver permuta ativa,
--    herda automaticamente barter_category e barter_notes se não fornecidos no agendamento.
-- =============================================================================

-- 1. Garante extensão unaccent no schema extensions ou public caso seja necessária futuramente
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS unaccent;
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
END $$;

-- 2. Adiciona a coluna barter_category em public.clients de forma idempotente
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS barter_category TEXT;

-- 3. Adiciona a coluna barter_category em public.appointments de forma idempotente
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS barter_category TEXT;

-- Cria índice parcial para categorização rápida de permutas
CREATE INDEX IF NOT EXISTS idx_appointments_barter_category
  ON public.appointments (barter_category)
  WHERE is_barter = true;

CREATE INDEX IF NOT EXISTS idx_clients_barter_category
  ON public.clients (barter_category)
  WHERE is_barter = true;

-- 4. Recriação robusta da função trigger trg_fn_check_appointment_barter()
CREATE OR REPLACE FUNCTION public.trg_fn_check_appointment_barter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_matheus BOOLEAN := false;
  v_client_is_barter BOOLEAN := false;
  v_client_barter_notes TEXT := NULL;
  v_client_barter_category TEXT := NULL;
  v_clean_phone TEXT;
BEGIN
  -- Se o atendimento já estiver concluído ou cancelado em UPDATE, preserva o estado
  IF TG_OP = 'UPDATE' AND (OLD.status IN ('concluido', 'concluído', 'completed', 'cancelado', 'cancelled', 'canceled')) THEN
    RETURN NEW;
  END IF;

  -- 1. Verifica se o barbeiro do agendamento é o Matheus (role = 'admin' ou nome 'Matheus')
  --    Elimina 100% de dependência de unaccent() para evitar erros de extensão
  IF NEW.barber_id IS NOT NULL THEN
    SELECT (role = 'admin' OR lower(coalesce(name, '')) LIKE '%matheus%')
    INTO v_is_matheus
    FROM public.barbers
    WHERE id = NEW.barber_id;
  END IF;

  -- 2. Se for o Matheus, localiza o cliente por client_id ou telefone normalizado
  IF v_is_matheus IS TRUE THEN
    -- Primeiro tenta localizar diretamente por client_id
    IF NEW.client_id IS NOT NULL THEN
      SELECT is_barter, barter_notes, barter_category
      INTO v_client_is_barter, v_client_barter_notes, v_client_barter_category
      FROM public.clients
      WHERE id = NEW.client_id;
    END IF;

    -- Se não encontrou ou não possui client_id, tenta por telefone normalizado
    IF (v_client_is_barter IS NOT TRUE) AND (NEW.client_phone IS NOT NULL OR NEW.clean_phone IS NOT NULL) THEN
      v_clean_phone := regexp_replace(COALESCE(NEW.clean_phone, NEW.client_phone), '\D', '', 'g');
      IF length(v_clean_phone) >= 8 THEN
        SELECT is_barter, barter_notes, barter_category
        INTO v_client_is_barter, v_client_barter_notes, v_client_barter_category
        FROM public.clients
        WHERE regexp_replace(COALESCE(clean_phone, phone), '\D', '', 'g') = v_clean_phone
        LIMIT 1;
      END IF;
    END IF;

    -- Se o cliente for parceiro de permuta ativo, marca o agendamento
    IF v_client_is_barter IS TRUE THEN
      NEW.is_barter := true;

      -- Herda a categoria de permuta do cliente se não especificada no agendamento
      IF (NEW.barter_category IS NULL OR trim(NEW.barter_category) = '') THEN
        NEW.barter_category := v_client_barter_category;
      END IF;

      -- Herda as notas de permuta do cliente se vazias
      IF (NEW.barter_notes IS NULL OR trim(NEW.barter_notes) = '') THEN
        NEW.barter_notes := v_client_barter_notes;
      END IF;

      -- Define status de pagamento como 'permuta', zera valor cobrado e comissões
      NEW.payment_status := 'permuta';
      NEW.barber_commission_amount := 0.00;
      NEW.tip_amount := 0.00;
    ELSE
      -- Se o cliente não tem permuta ativa, assegura is_barter = false
      NEW.is_barter := false;
      IF NEW.payment_status = 'permuta' THEN
        NEW.payment_status := 'pendente';
      END IF;
    END IF;
  ELSE
    -- Se o barbeiro NÃO for o Matheus (ex.: William), NUNCA é permuta
    NEW.is_barter := false;
    IF NEW.payment_status = 'permuta' THEN
      NEW.payment_status := 'pendente';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Garante que a trigger esteja associada à tabela public.appointments
DROP TRIGGER IF EXISTS trg_appointments_barter_check ON public.appointments;
CREATE TRIGGER trg_appointments_barter_check
  BEFORE INSERT OR UPDATE OF barber_id, client_id, client_phone, clean_phone
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_check_appointment_barter();
