-- =============================================================================
-- 24_barter_service_exchange.sql
-- Sistema de Troca de Serviço (Permuta) exclusivo do Matheus (Owner / Chefe)
--
-- Regras de Negócio:
-- 1. Exclusivo Matheus: Apenas o Matheus participa de permutas. O William NUNCA participa.
-- 2. Cadastro / Revogação: Clientes possuem is_barter (boolean) e barter_notes (text).
-- 3. Reconhecimento Automático: Trigger em appointments detecta se o cliente tem is_barter = true
--    E o agendamento é com o Matheus (identificado por role = 'admin' ou nome 'Matheus').
-- 4. Impacto:
--    - Bloqueia o horário do Matheus normalmente na agenda.
--    - Financeiro / Caixa / DRE: is_barter = true é isento de cobrança/receita no cash_flow e de comissão.
-- =============================================================================

-- 1. Adiciona colunas de permuta na tabela public.clients de forma idempotente
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_barter BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS barter_notes TEXT,
  ADD COLUMN IF NOT EXISTS barter_updated_at TIMESTAMPTZ;

-- 2. Adiciona colunas de permuta na tabela public.appointments de forma idempotente
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_barter BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS barter_notes TEXT;

-- Cria índice parcial para consultas rápidas de permuta
CREATE INDEX IF NOT EXISTS idx_appointments_is_barter ON public.appointments (is_barter) WHERE is_barter = true;
CREATE INDEX IF NOT EXISTS idx_clients_is_barter ON public.clients (is_barter) WHERE is_barter = true;

-- 3. Função e Trigger para reconhecimento automático de permuta em appointments
--    Verifica se o cliente associado possui is_barter = true E se o barbeiro é o Matheus (admin/owner).
CREATE OR REPLACE FUNCTION public.trg_fn_check_appointment_barter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_matheus BOOLEAN := false;
  v_client_is_barter BOOLEAN := false;
  v_client_barter_notes TEXT := NULL;
  v_clean_phone TEXT;
BEGIN
  -- Se o atendimento já estiver concluído ou cancelado em UPDATE, não altera flag de permuta
  IF TG_OP = 'UPDATE' AND (OLD.status IN ('concluido', 'concluído', 'completed', 'cancelado', 'cancelled', 'canceled')) THEN
    RETURN NEW;
  END IF;

  -- 1. Verifica se o barbeiro é o Matheus (role = 'admin' ou nome ILIKE '%matheus%')
  IF NEW.barber_id IS NOT NULL THEN
    SELECT (role = 'admin' OR unaccent(lower(name)) ILIKE '%matheus%')
    INTO v_is_matheus
    FROM public.barbers
    WHERE id = NEW.barber_id;
  END IF;

  -- 2. Se for o Matheus, busca o cliente por client_id ou telefone normalizado
  IF v_is_matheus IS TRUE THEN
    -- Primeiro tenta por client_id
    IF NEW.client_id IS NOT NULL THEN
      SELECT is_barter, barter_notes
      INTO v_client_is_barter, v_client_barter_notes
      FROM public.clients
      WHERE id = NEW.client_id;
    END IF;

    -- Se não encontrou ou não tem client_id, tenta por telefone normalizado
    IF (v_client_is_barter IS NOT TRUE) AND (NEW.client_phone IS NOT NULL OR NEW.clean_phone IS NOT NULL) THEN
      v_clean_phone := regexp_replace(COALESCE(NEW.clean_phone, NEW.client_phone), '\D', '', 'g');
      IF length(v_clean_phone) >= 8 THEN
        SELECT is_barter, barter_notes
        INTO v_client_is_barter, v_client_barter_notes
        FROM public.clients
        WHERE regexp_replace(COALESCE(clean_phone, phone), '\D', '', 'g') = v_clean_phone
        LIMIT 1;
      END IF;
    END IF;

    -- Se o cliente for parceiro de permuta ativo, marca o agendamento
    IF v_client_is_barter IS TRUE THEN
      NEW.is_barter := true;
      IF (NEW.barter_notes IS NULL OR trim(NEW.barter_notes) = '') THEN
        NEW.barter_notes := v_client_barter_notes;
      END IF;
      -- Define status de pagamento como 'permuta' e zera comissões operacionais
      NEW.payment_status := 'permuta';
      NEW.barber_commission_amount := 0.00;
    ELSE
      -- Se o cliente NÃO é permuta (ou teve permuta desativada), assegura is_barter = false
      NEW.is_barter := false;
      IF NEW.payment_status = 'permuta' THEN
        NEW.payment_status := 'pendente';
      END IF;
    END IF;
  ELSE
    -- Se NÃO é o Matheus (ex: é o William), NUNCA é permuta
    NEW.is_barter := false;
    IF NEW.payment_status = 'permuta' THEN
      NEW.payment_status := 'pendente';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_barter_check ON public.appointments;
CREATE TRIGGER trg_appointments_barter_check
  BEFORE INSERT OR UPDATE OF barber_id, client_id, client_phone, clean_phone
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_check_appointment_barter();

-- 4. Atualização da RPC public.register_payment_atomic para blindar permutas
--    Se o agendamento for is_barter = true, apenas conclui o agendamento
--    sem gerar movimentação financeira falsa no cash_flow.
CREATE OR REPLACE FUNCTION public.register_payment_atomic(
  p_appointment_id UUID,
  p_barber_id UUID,
  p_payment_method TEXT,
  p_amount NUMERIC,
  p_description TEXT DEFAULT NULL,
  p_tip_amount NUMERIC DEFAULT 0.00
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_clean_tip NUMERIC(10,2);
  v_clean_amount NUMERIC(10,2);
  v_cash_flow_id UUID := NULL;
  v_desc TEXT;
BEGIN
  v_clean_tip := GREATEST(COALESCE(p_tip_amount, 0.00), 0.00);
  v_clean_amount := GREATEST(COALESCE(p_amount, 0.00), 0.00);

  -- 1. Verifica se o agendamento existe
  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento % não encontrado.', p_appointment_id;
  END IF;

  -- 2. Se for Permuta (is_barter = true), conclui sem lançar entrada financeira no caixa
  IF v_appointment.is_barter IS TRUE THEN
    UPDATE public.appointments
    SET
      status = 'concluido',
      payment_status = 'permuta',
      payment_method = 'permuta',
      barber_commission_amount = 0.00,
      tip_amount = 0.00,
      updated_at = now()
    WHERE id = p_appointment_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_barter', true,
      'appointment_id', p_appointment_id,
      'cash_flow_id', NULL,
      'amount', 0.00,
      'tip_amount', 0.00
    );
  END IF;

  -- 3. Fluxo Monetário Normal (Agendamentos com pagamento real)
  IF p_description IS NOT NULL AND trim(p_description) <> '' THEN
    v_desc := trim(p_description);
  ELSE
    v_desc := 'Pagamento Atendimento — ' || COALESCE(v_appointment.client_name, 'Cliente');
  END IF;

  IF v_clean_tip > 0 THEN
    v_desc := v_desc || ' (inclui R$ ' || to_char(v_clean_tip, 'FM999G999D00') || ' de gorjeta)';
  END IF;

  -- Insere registro de entrada no Livro Caixa (cash_flow)
  INSERT INTO public.cash_flow (
    barber_id,
    appointment_id,
    type,
    category,
    amount,
    tip_amount,
    payment_method,
    description,
    occurred_at
  ) VALUES (
    COALESCE(p_barber_id, v_appointment.barber_id),
    p_appointment_id,
    'entrada',
    'atendimento',
    v_clean_amount,
    v_clean_tip,
    COALESCE(p_payment_method, v_appointment.payment_method, 'pix'),
    v_desc,
    now()
  )
  RETURNING id INTO v_cash_flow_id;

  -- Atualiza o agendamento
  UPDATE public.appointments
  SET
    status = 'concluido',
    payment_status = 'pago',
    payment_method = COALESCE(p_payment_method, payment_method, 'pix'),
    tip_amount = v_clean_tip,
    updated_at = now()
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_barter', false,
    'appointment_id', p_appointment_id,
    'cash_flow_id', v_cash_flow_id,
    'amount', v_clean_amount,
    'tip_amount', v_clean_tip
  );
END;
$$;
