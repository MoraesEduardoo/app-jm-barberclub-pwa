-- ==============================================================================
-- MIGRAÇÃO 105: VISTAS (VIEWS) ANALÍTICAS E INTELIGÊNCIA DE NEGÓCIO (PAINEL DO CHEFE)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/105_admin_views_and_intelligence.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. VISTA: AGENDA OPERACIONAL DIÁRIA (view_daily_agenda)
-- Consolidação em tempo real dos agendamentos, dados do barbeiro e serviço.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW view_daily_agenda AS
SELECT 
    a.id AS appointment_id,
    a.appointment_date,
    a.appointment_time,
    a.end_time,
    a.duration_minutes,
    a.buffer_minutes,
    a.status,
    a.client_name,
    a.client_phone,
    a.service AS service_name,
    a.price,
    a.payment_method,
    a.payment_status,
    a.barber_commission_amount,
    a.cancelled_at,
    a.cancelled_by,
    a.cancellation_reason,
    b.id AS barber_id,
    b.name AS barber_name,
    b.phone AS barber_phone,
    b.role AS barber_role,
    s.id AS service_id,
    s.category AS service_category
FROM appointments a
JOIN barbers b ON a.barber_id = b.id
LEFT JOIN services s ON a.service_id = s.id;

COMMENT ON VIEW view_daily_agenda IS 'Visão detalhada e unificada da agenda operacional para consulta rápida.';

-- ------------------------------------------------------------------------------
-- 2. VISTA: DESEMPENHO E COMISSÕES POR BARBEIRO (view_barber_performance)
-- Métricas de produtividade, taxa de ocupação, faturamento e comissões.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW view_barber_performance AS
SELECT 
    b.id AS barber_id,
    b.name AS barber_name,
    b.phone AS barber_phone,
    b.commission_rate,
    b.active,
    COUNT(a.id) FILTER (WHERE a.status = 'concluido') AS total_concluidos,
    COUNT(a.id) FILTER (WHERE a.status = 'confirmado') AS total_confirmados,
    COUNT(a.id) FILTER (WHERE a.status = 'cancelado') AS total_cancelados,
    COUNT(a.id) FILTER (WHERE a.status = 'no_show') AS total_no_show,
    COALESCE(SUM(a.price) FILTER (WHERE a.status = 'concluido'), 0.00) AS faturamento_bruto,
    COALESCE(
        SUM(COALESCE(a.barber_commission_amount, (a.price * b.commission_rate / 100.0))) 
        FILTER (WHERE a.status = 'concluido'), 
        0.00
    ) AS total_comissao,
    ROUND(
        COALESCE(AVG(a.price) FILTER (WHERE a.status = 'concluido'), 0.00), 
        2
    ) AS ticket_medio
FROM barbers b
LEFT JOIN appointments a ON b.id = a.barber_id
GROUP BY b.id, b.name, b.phone, b.commission_rate, b.active;

COMMENT ON VIEW view_barber_performance IS 'Resumo analítico de performance, atendimentos e comissões por barbeiro.';

-- ------------------------------------------------------------------------------
-- 3. VISTA: INTELIGÊNCIA DE CICLOS DE RETORNO DE CLIENTES (view_client_return_cycles)
-- Motor de inteligência para lembretes de re-agendamento preventivo.
-- Calcula a frequência média com que cada cliente corta o cabelo (ex: a cada 20 dias)
-- e aponta clientes com retorno atrasado para contato proativo.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW view_client_return_cycles AS
WITH appointments_ranked AS (
    SELECT 
        client_phone,
        client_name,
        appointment_date,
        LAG(appointment_date) OVER (
            PARTITION BY client_phone 
            ORDER BY appointment_date ASC
        ) AS previous_appointment_date
    FROM appointments
    WHERE status IN ('concluido', 'confirmado')
),
client_intervals AS (
    SELECT 
        client_phone,
        client_name,
        appointment_date,
        (appointment_date - previous_appointment_date) AS days_interval
    FROM appointments_ranked
),
client_summary AS (
    SELECT 
        client_phone,
        MAX(client_name) AS client_name,
        COUNT(appointment_date) AS total_appointments,
        MAX(appointment_date) AS last_appointment_date,
        ROUND(AVG(days_interval) FILTER (WHERE days_interval IS NOT NULL), 1) AS avg_days_between_cuts
    FROM client_intervals
    GROUP BY client_phone
)
SELECT 
    cs.client_phone,
    cs.client_name,
    cs.total_appointments,
    cs.last_appointment_date,
    COALESCE(cs.avg_days_between_cuts, 25.0) AS avg_days_between_cuts,
    (CURRENT_DATE - cs.last_appointment_date) AS days_since_last_cut,
    (cs.last_appointment_date + (COALESCE(cs.avg_days_between_cuts, 25.0)::INT * INTERVAL '1 day'))::DATE AS expected_next_cut,
    CASE 
        WHEN (CURRENT_DATE - cs.last_appointment_date) > (COALESCE(cs.avg_days_between_cuts, 25.0) + 10) THEN 'critico'
        WHEN (CURRENT_DATE - cs.last_appointment_date) > COALESCE(cs.avg_days_between_cuts, 25.0) THEN 'atrasado'
        ELSE 'em_dia'
    END AS retention_status
FROM client_summary cs;

COMMENT ON VIEW view_client_return_cycles IS 'Cálculo automatizado do ciclo médio de retorno e status de fidelização de clientes.';

-- ------------------------------------------------------------------------------
-- 4. VISTA: BALANÇO FINANCEIRO MENSAL DO CHEFE (view_monthly_cash_flow)
-- Cruza faturamento de serviços com as despesas lançadas no caixa.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW view_monthly_cash_flow AS
WITH monthly_revenue AS (
    SELECT 
        DATE_TRUNC('month', appointment_date)::DATE AS month_ref,
        COALESCE(SUM(price), 0.00) AS total_services_revenue,
        COUNT(id) AS completed_appointments_count
    FROM appointments
    WHERE status = 'concluido' OR payment_status = 'pago'
    GROUP BY DATE_TRUNC('month', appointment_date)
),
monthly_expenses AS (
    SELECT 
        DATE_TRUNC('month', occurred_at)::DATE AS month_ref,
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0.00) AS total_expenses,
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0.00) AS extra_incomes
    FROM cash_flow
    GROUP BY DATE_TRUNC('month', occurred_at)
)
SELECT 
    COALESCE(r.month_ref, e.month_ref) AS month_ref,
    COALESCE(r.total_services_revenue, 0.00) AS services_revenue,
    COALESCE(e.extra_incomes, 0.00) AS extra_income,
    (COALESCE(r.total_services_revenue, 0.00) + COALESCE(e.extra_incomes, 0.00)) AS total_gross_revenue,
    COALESCE(e.total_expenses, 0.00) AS total_expenses,
    ((COALESCE(r.total_services_revenue, 0.00) + COALESCE(e.extra_incomes, 0.00)) - COALESCE(e.total_expenses, 0.00)) AS net_profit,
    COALESCE(r.completed_appointments_count, 0) AS completed_appointments_count
FROM monthly_revenue r
FULL OUTER JOIN monthly_expenses e ON r.month_ref = e.month_ref
ORDER BY month_ref DESC;

COMMENT ON VIEW view_monthly_cash_flow IS 'Consolidação de receitas de serviços, despesas operacionais e lucro líquido mensal.';
