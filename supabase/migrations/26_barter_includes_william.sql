-- =============================================================================
-- 26_barter_includes_william.sql
-- Permuta Extensível: Suporte a William e barbeiros selecionados em acordos de troca
--
-- Regras de Negócio:
-- 1. Cria a coluna barter_includes_william BOOLEAN NOT NULL DEFAULT false
--    em public.clients e public.appointments.
-- 2. Atualiza a trigger trg_fn_check_appointment_barter():
--    - Matheus (role = 'admin' OR lower(name) LIKE '%matheus%') SEMPRE participa
--      quando o cliente tem is_barter = true.
--    - William (lower(name) LIKE '%william%') participa quando o cliente tem
--      is_barter = true E barter_includes_william = true.
--    - Copia barter_category, barter_notes e barter_includes_william para o agendamento.
--    - Zera valor cobrado, comissão e gorjeta para o atendimento em permuta.
--    - Se o agendamento for com o William e barter_includes_william = false,
--      o agendamento segue normal (is_barter = false, comissão normal).
-- 3. Mantém idempotência e elimina dependência de extensões instáveis.
-- =============================================================================

-- 1. Adiciona a coluna barter_includes_william na tabela public.clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS barter_includes_william BOOLEAN NOT NULL DEFAULT false;

-- 2. Adiciona a coluna barter_includes_william na tabela public.appointments
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS barter_includes_william BOOLEAN NOT NULL DEFAULT false;

-- Cria índice parcial para agendamentos de permuta com o William
CREATE INDEX IF NOT EXISTS idx_appointments_barter_includes_william
  ON public.appointments (barter_includes_william)
  WHERE is_barter = true;

CREATE INDEX IF NOT EXISTS idx_clients_barter_includes_william
  ON public.clients (barter_includes_william)
  WHERE is_barter = true;

-- 3. Atualização resiliente da trigger trg_fn_check_appointment_barter()
CREATE OR REPLACE FUNCTION public.trg_fn_check_appointment_barter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_matheus BOOLEAN := false;
  v_is_william BOOLEAN := false;
  v_client_is_barter BOOLEAN := false;
  v_client_includes_william BOOLEAN := false;
  v_client_barter_notes TEXT := NULL;
  v_client_barter_category TEXT := NULL;
  v_clean_phone TEXT;
  v_applies_barter BOOLEAN := false;
BEGIN
  -- Se o atendimento já estiver concluído ou cancelado em UPDATE, preserva o estado
  IF TG_OP = 'UPDATE' AND (OLD.status IN ('concluido', 'concluído', 'completed', 'cancelado', 'cancelled', 'canceled')) THEN
    RETURN NEW;
  END IF;

  -- 1. Identifica o barbeiro do agendamento (Matheus ou William)
  IF NEW.barber_id IS NOT NULL THEN
    SELECT 
      (role = 'admin' OR lower(coalesce(name, '')) LIKE '%matheus%'),
      (lower(coalesce(name, '')) LIKE '%william%')
    INTO v_is_matheus, v_is_william
    FROM public.barbers
    WHERE id = NEW.barber_id;
  END IF;

  -- 2. Localiza os dados de permuta do cliente por client_id ou telefone normalizado
  IF NEW.client_id IS NOT NULL THEN
    SELECT is_barter, barter_includes_william, barter_notes, barter_category
    INTO v_client_is_barter, v_client_includes_william, v_client_barter_notes, v_client_barter_category
    FROM public.clients
    WHERE id = NEW.client_id;
  END IF;

  -- Se não encontrou ou não possui client_id, tenta por telefone normalizado
  IF (v_client_is_barter IS NOT TRUE) AND (NEW.client_phone IS NOT NULL OR NEW.clean_phone IS NOT NULL) THEN
    v_clean_phone := regexp_replace(COALESCE(NEW.clean_phone, NEW.client_phone), '\D', '', 'g');
    IF length(v_clean_phone) >= 8 THEN
      SELECT is_barter, barter_includes_william, barter_notes, barter_category
      INTO v_client_is_barter, v_client_includes_william, v_client_barter_notes, v_client_barter_category
      FROM public.clients
      WHERE regexp_replace(COALESCE(clean_phone, phone), '\D', '', 'g') = v_clean_phone
      LIMIT 1;
    END IF;
  END IF;

  -- 3. Avalia se a permuta se aplica a este agendamento específico:
  --    - Aplica para Matheus se o cliente tem is_barter = true
  --    - Aplica para William se o cliente tem is_barter = true E barter_includes_william = true
  IF v_client_is_barter IS TRUE THEN
    IF v_is_matheus IS TRUE THEN
      v_applies_barter := true;
    ELSIF v_is_william IS TRUE AND (v_client_includes_william IS TRUE OR NEW.barter_includes_william IS TRUE) THEN
      v_applies_barter := true;
    END IF;
  END IF;

  -- 4. Aplica ou remove a marcação de permuta
  IF v_applies_barter IS TRUE THEN
    NEW.is_barter := true;
    NEW.barter_includes_william := COALESCE(v_client_includes_william, false);

    -- Herda a categoria de permuta do cliente se não especificada no agendamento
    IF (NEW.barter_category IS NULL OR trim(NEW.barter_category) = '') THEN
      NEW.barter_category := v_client_barter_category;
    END IF;

    -- Herda as notas de permuta do cliente se vazias
    IF (NEW.barter_notes IS NULL OR trim(NEW.barter_notes) = '') THEN
      NEW.barter_notes := v_client_barter_notes;
    END IF;

    -- Define status de pagamento como 'permuta', zera comissões e gorjetas
    NEW.payment_status := 'permuta';
    NEW.barber_commission_amount := 0.00;
    NEW.tip_amount := 0.00;
  ELSE
    -- Se não se aplica a este barbeiro/cliente, garante agendamento normal
    NEW.is_barter := false;
    NEW.barter_includes_william := false;
    IF NEW.payment_status = 'permuta' THEN
      NEW.payment_status := 'pendente';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Garante a trigger associada à tabela public.appointments
DROP TRIGGER IF EXISTS trg_appointments_barter_check ON public.appointments;
CREATE TRIGGER trg_appointments_barter_check
  BEFORE INSERT OR UPDATE OF barber_id, client_id, client_phone, clean_phone, barter_includes_william
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_check_appointment_barter();
