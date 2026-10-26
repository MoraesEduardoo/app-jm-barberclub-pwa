-- ==============================================================================
-- MIGRAÇÃO 06: DADOS INICIAIS (SEED IDEMPOTENTE COM IDs OFICIAIS JM BARBERCLUB)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/06_seed_data.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EQUIPE OFICIAL (Matheus - Admin/Chefe | William - Gerente com RBAC restrito)
-- ------------------------------------------------------------------------------
INSERT INTO public.barbers (
    id,
    name,
    phone,
    clean_phone,
    email,
    role,
    is_active,
    active,
    commission_percent,
    commission_rate,
    permissions,
    display_order
)
VALUES
    (
        'b949db29-efb1-4131-8234-873195068328',
        'Matheus',
        '83996646306',
        '83996646306',
        'matheus@jmbarberclub.com',
        'admin',
        true,
        true,
        50.00,
        50.00,
        '{"manage_services": true, "manage_schedule_others": true, "view_all_appointments": true, "manage_finance": true}'::jsonb,
        1
    ),
    (
        '9ebcd15c-b747-4d0b-b12f-5de9465363f9',
        'William',
        '83991751875',
        '83991751875',
        'william@jmbarberclub.com',
        'manager',
        true,
        true,
        50.00,
        50.00,
        '{"manage_services": true, "manage_schedule_others": true, "view_all_appointments": true, "manage_finance": false, "can_manage_finances": false, "can_view_global_finances": false, "can_register_expenses": false}'::jsonb,
        2
    )
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    clean_phone = EXCLUDED.clean_phone,
    role = EXCLUDED.role,
    is_active = true,
    active = true,
    permissions = EXCLUDED.permissions;

-- ------------------------------------------------------------------------------
-- 2. ESCALA SEMANAL OFICIAL (Dom 09:00-12:30, Seg 14:30-19:00, Ter-Sáb 09:00-19:00)
-- ------------------------------------------------------------------------------
INSERT INTO public.barber_schedules (barber_id, day_of_week, start_time, end_time, is_working, is_working_day)
VALUES
    -- Matheus
    ('b949db29-efb1-4131-8234-873195068328', 0, '09:00', '12:30', true, true),
    ('b949db29-efb1-4131-8234-873195068328', 1, '14:30', '19:00', true, true),
    ('b949db29-efb1-4131-8234-873195068328', 2, '09:00', '19:00', true, true),
    ('b949db29-efb1-4131-8234-873195068328', 3, '09:00', '19:00', true, true),
    ('b949db29-efb1-4131-8234-873195068328', 4, '09:00', '19:00', true, true),
    ('b949db29-efb1-4131-8234-873195068328', 5, '09:00', '19:00', true, true),
    ('b949db29-efb1-4131-8234-873195068328', 6, '09:00', '19:00', true, true),
    -- William
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 0, '09:00', '12:30', true, true),
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 1, '14:30', '19:00', true, true),
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 2, '09:00', '19:00', true, true),
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 3, '09:00', '19:00', true, true),
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 4, '09:00', '19:00', true, true),
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 5, '09:00', '19:00', true, true),
    ('9ebcd15c-b747-4d0b-b12f-5de9465363f9', 6, '09:00', '19:00', true, true)
ON CONFLICT (barber_id, day_of_week) DO UPDATE
SET
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    is_working = true,
    is_working_day = true;

-- ------------------------------------------------------------------------------
-- 3. CATÁLOGO INICIAL DE SERVIÇOS (IDEMPOTENTE E COM ISOLAMENTO DE IMAGEM)
-- ------------------------------------------------------------------------------
INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Degradê', 'Corte degradê navalhado ou disfarçado moderno', 25.00, 2500, 30, 30, 'cabelo', 1, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE 'Degradê');

INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Corte SÓ Tesoura', 'Corte clássico 100% tesoura com acabamento preciso', 25.00, 2500, 40, 40, 'cabelo', 2, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE '%Tesoura%');

INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Lowfade ou Americano', 'Corte moderno com fade baixo ou afunilado americano', 25.00, 2500, 30, 30, 'cabelo', 3, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE '%Lowfade%');

INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Barboterapia', 'Tratamento completo com toalha quente, óleos e navalha', 20.00, 2000, 30, 30, 'barba', 4, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE 'Barboterapia');

INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Corte e Barboterapia', 'Combo completo corte de cabelo + barba com toalha quente', 40.00, 4000, 60, 60, 'combo', 5, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE '%Corte e Barboterapia%');

INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Corte + Barba Simples', 'Corte alinhado acompanhado de barba e contorno simples', 35.00, 3500, 50, 50, 'combo', 6, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE '%Corte + Barba%');

INSERT INTO public.services (name, description, price, price_in_cents, duration_minutes, default_duration_minutes, category, display_order, is_active, active)
SELECT 'Barba (Design Simples)', 'Alinhamento e contorno de barba ou cavanhaque', 15.00, 1500, 20, 20, 'barba', 7, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name ILIKE '%Barba (Design Simples)%');

-- ------------------------------------------------------------------------------
-- 4. VÍNCULO AUTOMÁTICO DOS SERVIÇOS COM OS BARBEIROS ATIVOS
-- ------------------------------------------------------------------------------
INSERT INTO public.barber_services (barber_id, service_id, is_active)
SELECT b.id, s.id, true
FROM public.barbers b
CROSS JOIN public.services s
ON CONFLICT (barber_id, service_id) DO NOTHING;
