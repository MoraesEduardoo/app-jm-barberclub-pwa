-- =============================================================================
-- 23_tips_and_payment_atomic.sql
-- Suporte a Gorjeta (tip_amount) isolada do valor do serviço e RPC register_payment_atomic
--
-- Regras de Negócio:
-- 1. A comissão da barbearia (Matheus) incide EXCLUSIVAMENTE sobre o valor do serviço/produtos.
-- 2. O valor da gorjeta (tip_amount) é 100% líquido do barbeiro executor (ex: William recebe integralmente).
-- 3. A gorjeta é registrada nos agendamentos (appointments) e discriminada no livro caixa (cash_flow).
-- =============================================================================

-- 1. Adiciona a coluna tip_amount na tabela public.appointments de forma idempotente
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Garante constraint de valor não-negativo para a gorjeta
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_tip_amount_check'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_tip_amount_check CHECK (tip_amount >= 0);
  END IF;
END $$;

-- 2. Adiciona a coluna tip_amount na tabela public.cash_flow de forma idempotente
--    para permitir que entradas de caixa discriminem claramente o componente de gorjeta
ALTER TABLE public.cash_flow
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cash_flow_tip_amount_check'
      AND conrelid = 'public.cash_flow'::regclass
  ) THEN
    ALTER TABLE public.cash_flow
      ADD CONSTRAINT cash_flow_tip_amount_check CHECK (tip_amount >= 0);
  END IF;
END $$;

-- 3. Adiciona a coluna total_tips na tabela public.commission_payouts de forma idempotente
--    para registrar o acumulado de gorjetas pagas/repassadas 100% integrais nos acertos
ALTER TABLE public.commission_payouts
  ADD COLUMN IF NOT EXISTS total_tips NUMERIC(10,2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_payouts_total_tips_check'
      AND conrelid = 'public.commission_payouts'::regclass
  ) THEN
    ALTER TABLE public.commission_payouts
      ADD CONSTRAINT commission_payouts_total_tips_check CHECK (total_tips >= 0);
  END IF;
END $$;

-- 4. Criação/Atualização da RPC atômica public.register_payment_atomic
--    Recebe opcionalmente p_tip_amount DEFAULT 0, garantindo:
--    - Retrocompatibilidade total caso chamada sem p_tip_amount.
--    - Registro atômico de entrada no cash_flow discriminando o valor do serviço/produtos e gorjeta.
--    - Atualização do appointment com status 'concluido', 'pago', tip_amount e métodos de pagamento.
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
  v_cash_flow_id UUID;
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

  -- 2. Monta descrição padrão se não fornecida
  IF p_description IS NOT NULL AND trim(p_description) <> '' THEN
    v_desc := trim(p_description);
  ELSE
    v_desc := 'Pagamento Atendimento — ' || COALESCE(v_appointment.client_name, 'Cliente');
  END IF;

  IF v_clean_tip > 0 THEN
    v_desc := v_desc || ' (inclui R$ ' || to_char(v_clean_tip, 'FM999G999D00') || ' de gorjeta)';
  END IF;

  -- 3. Insere registro de entrada no Livro Caixa (cash_flow)
  --    amount guarda o valor total recebido no caixa (serviço + produtos + gorjeta)
  --    tip_amount guarda a gorjeta que pertence 100% ao barbeiro
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

  -- 4. Atualiza o agendamento correspondente
  --    Mantém price e total_price alinhados e grava tip_amount isolado
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
    'appointment_id', p_appointment_id,
    'cash_flow_id', v_cash_flow_id,
    'amount', v_clean_amount,
    'tip_amount', v_clean_tip
  );
END;
$$;

-- Permissões na função RPC para usuários autenticados
GRANT EXECUTE ON FUNCTION public.register_payment_atomic(UUID, UUID, TEXT, NUMERIC, TEXT, NUMERIC) TO authenticated;
