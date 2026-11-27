-- =============================================================================
-- 28_performance_indexes_and_barter_lookup.sql
-- Etapa 1: Índices Estratégicos de Performance e Otimização da Busca de Permuta
-- =============================================================================

-- 1. Garante existência das colunas clean_phone (apenas dígitos)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clean_phone TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS clean_phone TEXT;

-- 2. Backfill inicial seguro para registros legados onde clean_phone ainda seja nulo/vazio
UPDATE public.clients
SET clean_phone = regexp_replace(phone, '\D', '', 'g')
WHERE (clean_phone IS NULL OR clean_phone = '')
  AND phone IS NOT NULL;

UPDATE public.appointments
SET clean_phone = regexp_replace(COALESCE(client_phone, ''), '\D', '', 'g')
WHERE (clean_phone IS NULL OR clean_phone = '')
  AND client_phone IS NOT NULL
  AND client_phone <> '';

-- 3. Índices Estratégicos de Alta Performance
-- 3.1. appointments(client_id): Acelera histórico, métricas de fidelidade e agregações
CREATE INDEX IF NOT EXISTS idx_appointments_client_id
  ON public.appointments (client_id);

-- 3.2. appointments(barber_id): Acelera filtros diretos por profissional e cálculo de comissões
CREATE INDEX IF NOT EXISTS idx_appointments_barber_id
  ON public.appointments (barber_id);

-- 3.3. appointments(clean_phone): Acelera busca rápida por telefone de contato
CREATE INDEX IF NOT EXISTS idx_appointments_clean_phone
  ON public.appointments (clean_phone)
  WHERE clean_phone IS NOT NULL;

-- 3.4. clients(clean_phone): Elimina full table scan por regex na localização de clientes
CREATE INDEX IF NOT EXISTS idx_clients_clean_phone
  ON public.clients (clean_phone)
  WHERE clean_phone IS NOT NULL;

-- 3.5. barber_services(barber_id, service_id): Acelera joins de preços e durações personalizadas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'barber_services'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_barber_services_barber_service
      ON public.barber_services (barber_id, service_id);

    CREATE INDEX IF NOT EXISTS idx_barber_services_service_id
      ON public.barber_services (service_id);
  END IF;
END $$;

-- 4. Otimização da Trigger de Permuta (public.trg_fn_check_appointment_barter)
--    Preserva 100% das regras de negócio (Matheus + William barter_includes_william),
--    mas substitui o scan sequencial de regex por busca direta indexada em clean_phone.
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

  -- Mantém clean_phone do agendamento sincronizado automaticamente
  IF (NEW.clean_phone IS NULL OR NEW.clean_phone = '') AND NEW.client_phone IS NOT NULL THEN
    NEW.clean_phone := regexp_replace(NEW.client_phone, '\D', '', 'g');
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
  IF (v_client_is_barter IS NOT TRUE) AND (NEW.clean_phone IS NOT NULL OR NEW.client_phone IS NOT NULL) THEN
    v_clean_phone := COALESCE(NEW.clean_phone, regexp_replace(NEW.client_phone, '\D', '', 'g'));
    IF length(v_clean_phone) >= 8 THEN
      -- OTIMIZAÇÃO: Busca direta indexada em clean_phone (Index Scan instantâneo)
      SELECT is_barter, barter_includes_william, barter_notes, barter_category
      INTO v_client_is_barter, v_client_includes_william, v_client_barter_notes, v_client_barter_category
      FROM public.clients
      WHERE clean_phone = v_clean_phone
      LIMIT 1;

      -- Fallback resiliente: caso o registro legado em clients ainda não tenha clean_phone
      IF (v_client_is_barter IS NOT TRUE) THEN
        SELECT is_barter, barter_includes_william, barter_notes, barter_category
        INTO v_client_is_barter, v_client_includes_william, v_client_barter_notes, v_client_barter_category
        FROM public.clients
        WHERE phone = v_clean_phone
           OR regexp_replace(COALESCE(clean_phone, phone), '\D', '', 'g') = v_clean_phone
        LIMIT 1;
      END IF;
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

-- 5. Recriação segura e idempotente da trigger associada
DROP TRIGGER IF EXISTS trg_appointments_barter_check ON public.appointments;
CREATE TRIGGER trg_appointments_barter_check
  BEFORE INSERT OR UPDATE OF barber_id, client_id, client_phone, clean_phone, barter_includes_william
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_check_appointment_barter();
