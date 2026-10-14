-- ==============================================================================
-- MIGRAÇÃO 108: AUDITORIA, PADRONIZAÇÃO E CÁLCULO DE COMISSÃO (50% OFICIAL)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/108_audit_commission_rules.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PADRONIZAÇÃO NA TABELA DE BARBEIROS (barbers)
-- Garante que tanto commission_rate quanto commission_percent existam com padrão 50.00 (50%)
-- ------------------------------------------------------------------------------
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 50.00;
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00;

-- Normaliza qualquer valor antigo gravado como fração decimal (ex: 0.50 -> 50.00)
UPDATE barbers 
SET 
    commission_rate = CASE 
        WHEN commission_rate > 0 AND commission_rate <= 1.0 THEN ROUND(commission_rate * 100, 2)
        WHEN commission_rate IS NULL THEN 50.00
        ELSE commission_rate
    END,
    commission_percent = CASE 
        WHEN commission_percent > 0 AND commission_percent <= 1.0 THEN ROUND(commission_percent * 100, 2)
        WHEN commission_percent IS NULL THEN 50.00
        ELSE commission_percent
    END;

-- Sincroniza commission_rate e commission_percent caso um deles esteja nulo
UPDATE barbers 
SET 
    commission_rate = COALESCE(commission_rate, commission_percent, 50.00),
    commission_percent = COALESCE(commission_percent, commission_rate, 50.00);

-- Garante as credenciais e taxa oficial estrita de 50% para Matheus e William
UPDATE barbers 
SET 
    commission_rate = 50.00,
    commission_percent = 50.00,
    updated_at = NOW()
WHERE phone LIKE '%83996646306%' 
   OR phone LIKE '%83991751875%';

-- ------------------------------------------------------------------------------
-- 2. ATUALIZAÇÃO DA VISTA DE PERFORMANCE E COMISSÕES (view_barber_performance)
-- Calcula de forma imune a falhas a comissão oficial de 50% sobre o faturamento
-- de cada serviço executado (ou valor fixado em barber_commission_amount).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW view_barber_performance AS
SELECT 
    b.id AS barber_id,
    b.name AS barber_name,
    b.phone AS barber_phone,
    COALESCE(b.commission_rate, b.commission_percent, 50.00) AS commission_rate,
    b.active,
    COUNT(a.id) FILTER (WHERE a.status = 'concluido' OR a.payment_status = 'pago') AS total_concluidos,
    COUNT(a.id) FILTER (WHERE a.status = 'confirmado' AND a.payment_status != 'pago') AS total_confirmados,
    COUNT(a.id) FILTER (WHERE a.status = 'cancelado') AS total_cancelados,
    COUNT(a.id) FILTER (WHERE a.status = 'no_show') AS total_no_show,
    COALESCE(
        SUM(COALESCE(a.price, s.price, 0.00)) 
        FILTER (WHERE (a.status = 'concluido' OR a.payment_status = 'pago') AND a.status != 'cancelado'), 
        0.00
    ) AS faturamento_bruto,
    COALESCE(
        SUM(
            COALESCE(
                a.barber_commission_amount, 
                (
                    COALESCE(a.price, s.price, 0.00) * (
                        CASE 
                            WHEN COALESCE(b.commission_rate, b.commission_percent, 50.00) > 0 
                                 AND COALESCE(b.commission_rate, b.commission_percent, 50.00) <= 1.0 
                            THEN COALESCE(b.commission_rate, b.commission_percent, 50.00)
                            ELSE COALESCE(b.commission_rate, b.commission_percent, 50.00) / 100.0
                        END
                    )
                )
            )
        ) FILTER (WHERE (a.status = 'concluido' OR a.payment_status = 'pago') AND a.status != 'cancelado'), 
        0.00
    ) AS total_comissao,
    ROUND(
        COALESCE(
            AVG(COALESCE(a.price, s.price, 0.00)) 
            FILTER (WHERE (a.status = 'concluido' OR a.payment_status = 'pago') AND a.status != 'cancelado'), 
            0.00
        ), 
        2
    ) AS ticket_medio
FROM barbers b
LEFT JOIN appointments a ON b.id = a.barber_id
LEFT JOIN services s ON a.service_id = s.id
GROUP BY b.id, b.name, b.phone, b.commission_rate, b.commission_percent, b.active;

COMMENT ON VIEW view_barber_performance IS 'Resumo analítico auditado de performance, faturamento e repasse de comissão (50% padrão).';

-- ------------------------------------------------------------------------------
-- 3. FUNÇÃO ATÔMICA RPC DE PAGAMENTO E CÁLCULO DE COMISSÃO (register_payment_atomic)
-- Executa a liquidação do atendimento, fixa o preço cobrado e credita os 50% de comissão.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_payment_atomic(
    p_appointment_id UUID,
    p_barber_id UUID,
    p_payment_method VARCHAR,
    p_amount NUMERIC,
    p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_commission_rate NUMERIC;
    v_commission_amount NUMERIC;
    v_service_id UUID;
BEGIN
    -- Busca a taxa do barbeiro responsável (oficial 50%)
    SELECT COALESCE(
        CASE 
            WHEN commission_rate > 0 AND commission_rate <= 1.0 THEN commission_rate * 100.0
            ELSE commission_rate
        END,
        CASE 
            WHEN commission_percent > 0 AND commission_percent <= 1.0 THEN commission_percent * 100.0
            ELSE commission_percent
        END,
        50.00
    ) INTO v_commission_rate
    FROM barbers
    WHERE id = p_barber_id;

    IF v_commission_rate IS NULL THEN
        v_commission_rate := 50.00;
    END IF;

    -- Cálculo oficial dos 50% sobre o valor faturado
    v_commission_amount := ROUND((p_amount * v_commission_rate / 100.0), 2);

    -- Atualiza o registro do agendamento
    UPDATE appointments
    SET 
        status = 'concluido',
        payment_status = 'pago',
        payment_method = p_payment_method,
        price = p_amount,
        barber_commission_amount = v_commission_amount,
        updated_at = NOW()
    WHERE id = p_appointment_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'appointment_id', p_appointment_id,
        'amount', p_amount,
        'commission_rate', v_commission_rate,
        'commission_amount', v_commission_amount
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. BACKFILL RETROATIVO DE COMISSÕES EM AGENDAMENTOS EXISTENTES
-- Preenche barber_commission_amount para atendimentos já quitados que estavam sem o valor gravado
-- ------------------------------------------------------------------------------
UPDATE appointments a
SET barber_commission_amount = ROUND(
    COALESCE(a.price, s.price, 0.00) * (
        CASE 
            WHEN COALESCE(b.commission_rate, b.commission_percent, 50.00) > 0 
                 AND COALESCE(b.commission_rate, b.commission_percent, 50.00) <= 1.0 
            THEN COALESCE(b.commission_rate, b.commission_percent, 50.00)
            ELSE COALESCE(b.commission_rate, b.commission_percent, 50.00) / 100.0
        END
    ), 
    2
)
FROM barbers b
LEFT JOIN services s ON a.service_id = s.id
WHERE a.barber_id = b.id
  AND (a.status = 'concluido' OR a.payment_status = 'pago')
  AND a.status != 'cancelado'
  AND a.barber_commission_amount IS NULL;

-- ------------------------------------------------------------------------------
-- 5. PERMISSÕES DE ACESSO
-- ------------------------------------------------------------------------------
GRANT SELECT ON view_barber_performance TO authenticated, anon;
GRANT EXECUTE ON FUNCTION register_payment_atomic(UUID, UUID, VARCHAR, NUMERIC, TEXT) TO authenticated, anon, service_role;
