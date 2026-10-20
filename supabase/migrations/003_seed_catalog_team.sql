-- ==============================================================================
-- ARQUIVO 3: 003_seed_catalog_team.sql
-- Sistema: JM Barberclub (Chatbot + Painel do Barbeiro)
-- Descrição: Inserção dos dados iniciais da equipe (Matheus e William),
--            catálogo oficial de serviços, especialidades e expedientes semanais.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SEED DA EQUIPE (Matheus e William)
-- ------------------------------------------------------------------------------
INSERT INTO public.barbers (id, name, email, phone, role, active, commission_percent, permissions)
VALUES 
    (
        '401fe8ff-d8c9-4ef2-9a36-7e7d23d10cea',
        'Matheus',
        'matheus@jmbarberclub.com',
        '11999990001',
        'admin',
        TRUE,
        50.00,
        '{"can_manage_team": true, "can_manage_services": true, "can_manage_finances": true, "can_manage_schedules": true, "can_manage_all": true}'::jsonb
    ),
    (
        '3fc4c3b7-e20b-41c7-b5b0-059005594ed8',
        'William',
        'william@jmbarberclub.com',
        '11999990002',
        'manager',
        TRUE,
        50.00,
        '{"can_manage_team": false, "can_manage_services": true, "can_manage_finances": true, "can_manage_schedules": true}'::jsonb
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    commission_percent = EXCLUDED.commission_percent,
    permissions = EXCLUDED.permissions;

-- ------------------------------------------------------------------------------
-- 2. SEED DO CATÁLOGO DE SERVIÇOS (Valores em Reais e Centavos)
-- ------------------------------------------------------------------------------
INSERT INTO public.services (id, name, price, price_in_cents, default_duration_minutes, category, display_order, active)
VALUES 
    ('437166f9-24cc-4342-9d37-bb230a6ef533', 'Degradê', 25.00, 2500, 30, 'cabelo', 1, TRUE),
    ('bd6adbab-3fa3-4850-b839-e8ac559b4b2e', 'Corte SÓ Tesoura', 25.00, 2500, 30, 'cabelo', 2, TRUE),
    ('f440bcd9-f9cc-41bf-89af-7e23bbef0f36', 'Low Fade ou Americano', 25.00, 2500, 30, 'cabelo', 3, TRUE),
    ('2f131500-1e8b-4e0d-9564-df953ade6a51', 'Barboterapia', 20.00, 2000, 30, 'barba', 4, TRUE),
    ('cc942ad2-0e7c-47dd-8e9a-5de9f818e01a', 'Corte e Barboterapia', 40.00, 4000, 60, 'combo', 5, TRUE),
    ('4b8c33fa-8729-43f2-a483-bdbd3d2be46b', 'Corte + Barba Simples', 35.00, 3500, 45, 'combo', 6, TRUE),
    ('26f96b80-0f99-4540-aadb-e67c1df984a7', 'Barba (Simples, Cavanhaque)', 15.00, 1500, 20, 'barba', 7, TRUE),
    ('ebca35d1-c938-409b-ab45-6c3a25bc8f86', 'Degradê + Sobrancelha', 30.00, 3000, 35, 'combo', 8, TRUE),
    ('7ac80921-5740-431f-a0b4-c4136bce4a0b', 'Corte Simples ou Social', 20.00, 2000, 25, 'cabelo', 9, TRUE),
    ('77e96b61-b312-4910-8f64-5ebc369ed338', 'Limpeza de Pele', 30.00, 3000, 30, 'tratamento', 10, TRUE),
    ('f0ffd55e-bc55-4d58-80e2-5eac6da8c314', 'Corte Freestyle', 35.00, 3500, 40, 'cabelo', 11, TRUE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    price_in_cents = EXCLUDED.price_in_cents,
    default_duration_minutes = EXCLUDED.default_duration_minutes,
    category = EXCLUDED.category,
    display_order = EXCLUDED.display_order;

-- ------------------------------------------------------------------------------
-- 3. ASSOCIAÇÃO INICIAL: TODOS OS SERVIÇOS ATIVOS PARA MATHEUS E WILLIAM
-- ------------------------------------------------------------------------------
INSERT INTO public.barber_services (barber_id, service_id, is_active)
SELECT b.id, s.id, TRUE
FROM public.barbers b
CROSS JOIN public.services s
ON CONFLICT (barber_id, service_id) DO UPDATE SET is_active = TRUE;

-- ------------------------------------------------------------------------------
-- 4. JORNADA DE TRABALHO PADRÃO (Segunda a Sábado: 09h às 19h | Almoço: 12h às 13h)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    r_barber RECORD;
    i_day SMALLINT;
BEGIN
    FOR r_barber IN SELECT id FROM public.barbers LOOP
        FOR i_day IN 0..6 LOOP
            INSERT INTO public.barber_schedules (
                barber_id,
                day_of_week,
                start_time,
                end_time,
                break_start_time,
                break_end_time,
                is_working_day
            )
            VALUES (
                r_barber.id,
                i_day,
                '09:00:00',
                '19:00:00',
                '12:00:00',
                '13:00:00',
                (i_day <> 0) -- Domingo fechado (FALSE), Segunda a Sábado aberto (TRUE)
            )
            ON CONFLICT (barber_id, day_of_week) DO UPDATE SET
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                break_start_time = EXCLUDED.break_start_time,
                break_end_time = EXCLUDED.break_end_time,
                is_working_day = EXCLUDED.is_working_day;
        END LOOP;
    END LOOP;
END $$;
