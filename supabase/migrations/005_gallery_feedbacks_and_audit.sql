-- ==============================================================================
-- MIGRAÇÃO 005: GALERIA, AVALIAÇÕES, SEGURANÇA E AUDITORIA ATÔMICA
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/005_gallery_feedbacks_and_audit.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE VITRINE E FOTOS DE CORTES (haircut_gallery)
-- Conectada ao bucket 'haircut-gallery' do Supabase Storage
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.haircut_gallery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'degrade',
    image_path TEXT NOT NULL,
    image_url TEXT,
    storage_url TEXT,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gallery_active_category 
    ON public.haircut_gallery(is_active, category, display_order);

DROP TRIGGER IF EXISTS trg_gallery_updated_at ON public.haircut_gallery;
CREATE TRIGGER trg_gallery_updated_at
    BEFORE UPDATE ON public.haircut_gallery
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Vincula a foto de referência escolhida pelo cliente em appointments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'appointments_reference_photo_id_fkey'
    ) THEN
        ALTER TABLE public.appointments
            ADD CONSTRAINT appointments_reference_photo_id_fkey
            FOREIGN KEY (reference_photo_id)
            REFERENCES public.haircut_gallery(id)
            ON DELETE SET NULL;
            
        CREATE INDEX IF NOT EXISTS idx_appointments_reference_photo 
            ON public.appointments(reference_photo_id);
    END IF;
END $$;

COMMENT ON TABLE public.haircut_gallery IS 'Fotos ilustrativas de cortes para vitrine do chatbot e referências visuais.';

-- ------------------------------------------------------------------------------
-- 2. TABELA DE FEEDBACKS E AVALIAÇÕES DE CLIENTES (client_feedbacks)
-- Guarda notas de 1 a 5 e opiniões pós-atendimento
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_feedbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    client_name VARCHAR(150),
    client_phone VARCHAR(30),
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_barber 
    ON public.client_feedbacks(barber_id, rating);

COMMENT ON TABLE public.client_feedbacks IS 'Avaliações de satisfação e comentários de clientes após o atendimento.';

-- ------------------------------------------------------------------------------
-- 3. TABELA DE ASSINATURAS PUSH NOTIFICATION (push_subscriptions)
-- Registra navegadores e celulares para envio de alertas PWA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    keys JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_barber ON public.push_subscriptions(barber_id);

-- ------------------------------------------------------------------------------
-- 4. TABELAS DE RECUPERAÇÃO DE ACESSO (barber_recovery_codes)
-- Códigos de segurança criptografados para recuperação de senha master
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    code_hash VARCHAR(128) NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.barber_recovery_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL UNIQUE REFERENCES public.barbers(id) ON DELETE CASCADE,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 5. TABELA DE AUDITORIA E LOGS DO SISTEMA (audit_logs)
-- Rastreamento de ações administrativas sensíveis
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    actor_name VARCHAR(150),
    action VARCHAR(80) NOT NULL,
    target_entity VARCHAR(60) NOT NULL,
    target_id VARCHAR(100),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 6. FUNÇÃO RPC ATÔMICA PARA REGISTRO DE PAGAMENTO (register_payment_atomic)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_payment_atomic(
    p_appointment_id UUID,
    p_barber_id UUID,
    p_payment_method VARCHAR,
    p_amount NUMERIC
)
RETURNS JSONB AS $$
DECLARE
    v_commission_rate NUMERIC;
    v_commission_amount NUMERIC;
BEGIN
    SELECT commission_rate INTO v_commission_rate 
    FROM public.barbers WHERE id = p_barber_id;

    IF v_commission_rate IS NULL THEN
        v_commission_rate := 0.50;
    END IF;

    v_commission_amount := ROUND((p_amount * v_commission_rate), 2);

    UPDATE public.appointments
    SET 
        payment_status = 'pago',
        status = 'concluido',
        payment_method = p_payment_method,
        price = p_amount,
        total_price = p_amount,
        barber_commission_amount = v_commission_amount,
        updated_at = NOW()
    WHERE id = p_appointment_id;

    RETURN jsonb_build_object(
        'success', true,
        'commission_amount', v_commission_amount,
        'paid_amount', p_amount
    );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 7. ATIVAÇÃO DE ROW LEVEL SECURITY (RLS) E POLÍTICAS DE ACESSO
-- ------------------------------------------------------------------------------
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haircut_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas universais de leitura e gravação para painel e chatbot
CREATE POLICY "Permitir leitura publica de barbers" ON public.barbers FOR SELECT USING (true);
CREATE POLICY "Permitir gestao de barbers para admin" ON public.barbers FOR ALL USING (true);

CREATE POLICY "Permitir leitura publica de services" ON public.services FOR SELECT USING (true);
CREATE POLICY "Permitir gestao de services para equipe" ON public.services FOR ALL USING (true);

CREATE POLICY "Permitir leitura de clients" ON public.clients FOR SELECT USING (true);
CREATE POLICY "Permitir gestao de clients" ON public.clients FOR ALL USING (true);

CREATE POLICY "Permitir acesso total a appointments" ON public.appointments FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a waitlist" ON public.waitlist FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a schedules" ON public.barber_schedules FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a exceptions" ON public.barber_exceptions FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a barber_services" ON public.barber_services FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a commissions" ON public.commission_payouts FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a cash_flow" ON public.cash_flow FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a settings" ON public.business_settings FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a gallery" ON public.haircut_gallery FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a feedbacks" ON public.client_feedbacks FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a push" ON public.push_subscriptions FOR ALL USING (true);
CREATE POLICY "Permitir acesso total a audit" ON public.audit_logs FOR ALL USING (true);
