-- ==============================================================================
-- MIGRAÇÃO 105: VISTAS (VIEWS) ANALÍTICAS E RELATÓRIOS PARA O PAINEL DO CHEFE
-- Sistema: JM Barberclub (Painel do Barbeiro)
-- Arquivo: supabase/migrations/105_reports_and_chefe_views.sql
-- ==============================================================================

-- 1. VISTA: Agenda Diária Consolidada (view_daily_agenda)
-- Facilita consultas da interface de agenda com todos os dados pré-calculados
CREATE OR REPLACE VIEW public.view_daily_agenda AS
SELECT 
    a.id AS appointment_id,
    a.appointment_date,
    (a.appointment_date AT TIME ZONE 'America/Sao_Paulo')::date AS appointment_day,
    to_char(a.appointment_date AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS appointment_time,
    a.status,
    a.payment_status,
    a.payment_method,
    a.notes,
    a.reference_photo_id,
    -- Dados do Cliente
    a.client_name,
    a.client_phone,
    -- Dados do Barbeiro
    b.id AS barber_id,
    b.name AS barber_name,
    b.phone AS barber_phone,
    b.avatar_url AS barber_avatar,
    b.commission_percent,
    -- Dados do Serviço
    s.id AS service_id,
    s.name AS service_name,
    s.price AS service_price,
    s.default_duration_minutes,
    -- Cálculo de valores
    ROUND((s.price * (b.commission_percent / 100.0)), 2) AS barber_commission_amount,
    ROUND((s.price * (1.0 - (b.commission_percent / 100.0))), 2) AS house_revenue_amount,
    -- Metadados de Cancelamento
    a.cancelled_at,
    a.cancellation_reason,
    a.cancelled_by
FROM public.appointments a
JOIN public.barbers b ON b.id = a.barber_id
JOIN public.services s ON s.id = a.service_id;

-- 2. VISTA: Performance e Comissões por Barbeiro (view_barber_performance)
-- Agrupa os atendimentos dos últimos 30 dias por padrão
CREATE OR REPLACE VIEW public.view_barber_performance AS
SELECT 
    b.id AS barber_id,
    b.name AS barber_name,
    b.role AS barber_role,
    b.active AS barber_active,
    b.commission_percent,
    COUNT(a.id) AS total_agendamentos,
    COUNT(a.id) FILTER (WHERE a.status = 'concluido' OR a.payment_status = 'pago') AS total_atendidos,
    COUNT(a.id) FILTER (WHERE a.status = 'cancelado') AS total_cancelados,
    COUNT(a.id) FILTER (WHERE a.status = 'nao_compareceu') AS total_faltas,
    COALESCE(SUM(s.price) FILTER (WHERE a.status = 'concluido' OR a.payment_status = 'pago'), 0.00) AS faturamento_bruto,
    COALESCE(SUM(ROUND((s.price * (b.commission_percent / 100.0)), 2)) 
        FILTER (WHERE a.status = 'concluido' OR a.payment_status = 'pago'), 0.00) AS comissao_total,
    COALESCE(SUM(ROUND((s.price * (1.0 - (b.commission_percent / 100.0))), 2)) 
        FILTER (WHERE a.status = 'concluido' OR a.payment_status = 'pago'), 0.00) AS receita_liquida_casa,
    ROUND(
        COALESCE(AVG(s.price) FILTER (WHERE a.status = 'concluido' OR a.payment_status = 'pago'), 0.00), 2
    ) AS ticket_medio
FROM public.barbers b
LEFT JOIN public.appointments a ON a.barber_id = b.id
LEFT JOIN public.services s ON s.id = a.service_id
GROUP BY b.id, b.name, b.role, b.active, b.commission_percent;

-- 3. VISTA: Análise de Ciclo de Retorno e Fidelização de Clientes (view_client_retention_cycles)
-- Identifica clientes em dia, atrasados (para campanhas de reativação) ou novos
CREATE OR REPLACE VIEW public.view_client_retention_cycles AS
WITH client_visits AS (
    SELECT 
        REGEXP_REPLACE(a.client_phone, '\D', '', 'g') AS clean_phone,
        MAX(a.client_name) AS client_name,
        COUNT(a.id) AS total_visits,
        MIN(a.appointment_date) AS first_visit,
        MAX(a.appointment_date) AS last_visit,
        MAX(b.name) AS favorite_barber_name,
        MAX(s.name) AS last_service_name
    FROM public.appointments a
    JOIN public.barbers b ON b.id = a.barber_id
    JOIN public.services s ON s.id = a.service_id
    WHERE a.status != 'cancelado'
    GROUP BY REGEXP_REPLACE(a.client_phone, '\D', '', 'g')
    HAVING LENGTH(REGEXP_REPLACE(a.client_phone, '\D', '', 'g')) >= 10
),
calculated_cycles AS (
    SELECT 
        cv.clean_phone,
        cv.client_name,
        cv.total_visits,
        cv.first_visit,
        cv.last_visit,
        cv.favorite_barber_name,
        cv.last_service_name,
        -- Dias desde o último corte
        DATE_PART('day', timezone('America/Sao_Paulo', now()) - (cv.last_visit AT TIME ZONE 'America/Sao_Paulo'))::int AS days_since_last_visit,
        -- Média de dias entre visitas (se tiver mais de 1 visita)
        CASE 
            WHEN cv.total_visits > 1 THEN 
                ROUND(
                    (DATE_PART('day', cv.last_visit - cv.first_visit) / NULLIF(cv.total_visits - 1, 0))::numeric, 1
                )
            ELSE 21.0 -- Ciclo padrão sugerido para barbearia (3 semanas)
        END AS avg_cycle_days
    FROM client_visits cv
)
SELECT 
    cc.clean_phone,
    cc.client_name,
    cc.total_visits,
    cc.last_visit,
    cc.favorite_barber_name,
    cc.last_service_name,
    cc.days_since_last_visit,
    cc.avg_cycle_days,
    -- Data prevista do próximo retorno
    (cc.last_visit + (cc.avg_cycle_days || ' days')::interval)::date AS expected_next_visit,
    -- Status do ciclo para ações da recepção/chatbot
    CASE 
        WHEN cc.total_visits = 1 THEN 'novo'
        WHEN cc.days_since_last_visit <= 7 THEN 'recente'
        WHEN cc.days_since_last_visit > (cc.avg_cycle_days + 7) THEN 'atrasado'
        ELSE 'em_dia'
    END AS cycle_status
FROM calculated_cycles cc;

-- 4. VISTA: Resumo de Fechamento de Caixa Diário (view_financial_cashflow_summary)
CREATE OR REPLACE VIEW public.view_financial_cashflow_summary AS
SELECT 
    (a.appointment_date AT TIME ZONE 'America/Sao_Paulo')::date AS data_movimento,
    a.payment_method,
    a.payment_status,
    COUNT(a.id) AS quantidade_atendimentos,
    COALESCE(SUM(s.price), 0.00) AS total_faturado,
    COALESCE(SUM(ROUND((s.price * (b.commission_percent / 100.0)), 2)), 0.00) AS total_comissoes_devidas,
    COALESCE(SUM(ROUND((s.price * (1.0 - (b.commission_percent / 100.0))), 2)), 0.00) AS lucro_liquido_casa
FROM public.appointments a
JOIN public.services s ON s.id = a.service_id
JOIN public.barbers b ON b.id = a.barber_id
WHERE a.status != 'cancelado'
GROUP BY 
    (a.appointment_date AT TIME ZONE 'America/Sao_Paulo')::date,
    a.payment_method,
    a.payment_status;

COMMENT ON VIEW public.view_daily_agenda IS 'Visão consolidada da agenda diária para exibição rápida no painel com valores de comissão.';
COMMENT ON VIEW public.view_barber_performance IS 'Indicadores de produtividade, faturamento e rateio de comissões por barbeiro.';
COMMENT ON VIEW public.view_client_retention_cycles IS 'Motor SQL de cálculo de recorrência e identificação de clientes atrasados para reativação.';
COMMENT ON VIEW public.view_financial_cashflow_summary IS 'Extrato de faturamento diário consolidado por método de pagamento e divisão de lucro.';
