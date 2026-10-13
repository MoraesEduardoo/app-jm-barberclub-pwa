-- ==============================================================================
-- MIGRAÇÃO 103: CONTROLE DE EXPEDIENTE, BLOQUEIOS E BUFFERS DE ATENDIMENTO
-- Sistema: JM Barberclub (Painel do Barbeiro)
-- Arquivo: supabase/migrations/103_schedule_and_buffer_control.sql
-- ==============================================================================

-- 1. Tabela de Expediente Semanal dos Barbeiros (barber_schedules)
CREATE TABLE IF NOT EXISTS public.barber_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (day_of_week IN ('domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado')),
    start_time TIME NOT NULL DEFAULT '08:00:00',
    end_time TIME NOT NULL DEFAULT '19:00:00',
    is_working BOOLEAN NOT NULL DEFAULT true,
    has_lunch_break BOOLEAN NOT NULL DEFAULT false,
    lunch_start TIME,
    lunch_end TIME,
    cleaning_buffer_minutes INT NOT NULL DEFAULT 10 CHECK (cleaning_buffer_minutes >= 0 AND cleaning_buffer_minutes <= 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT barber_schedules_barber_day_unique UNIQUE (barber_id, day_of_week)
);

-- 2. Garantir colunas adicionais para instalações preexistentes
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS has_lunch_break BOOLEAN DEFAULT false;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS lunch_start TIME;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS lunch_end TIME;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS cleaning_buffer_minutes INT DEFAULT 10;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- 3. Índices de busca rápida de grade e expediente
CREATE INDEX IF NOT EXISTS idx_barber_schedules_lookup 
    ON public.barber_schedules(barber_id, day_of_week, is_working);

-- 4. Tabela de Bloqueios Pontuais, Folgas e Feriados (barber_exceptions)
CREATE TABLE IF NOT EXISTS public.barber_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    start_time TIME, -- NULL indica folga o dia inteiro
    end_time TIME,   -- NULL indica folga o dia inteiro
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Índices para validação instantânea de disponibilidade na geração de horários
CREATE INDEX IF NOT EXISTS idx_barber_exceptions_date 
    ON public.barber_exceptions(barber_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_barber_exceptions_range 
    ON public.barber_exceptions(exception_date);

-- 6. Trigger para atualização de updated_at em barber_schedules
DROP TRIGGER IF EXISTS trg_barber_schedules_updated_at ON public.barber_schedules;
CREATE TRIGGER trg_barber_schedules_updated_at
    BEFORE UPDATE ON public.barber_schedules
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_timestamp();

COMMENT ON TABLE public.barber_schedules IS 'Tabela com as configurações de turnos e dias de trabalho de cada barbeiro.';
COMMENT ON COLUMN public.barber_schedules.cleaning_buffer_minutes IS 'Intervalo de higienização de bancada/preparação inserido após cada atendimento.';
COMMENT ON TABLE public.barber_exceptions IS 'Bloqueios pontuais, ausências e folgas específicas por data.';
