-- =============================================================================
-- 02_core_tables.sql
-- Tabelas base do JM Barberclub: barbers, services, clients, appointments
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.barbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'barber' CHECK (role IN ('admin', 'manager', 'barber')),
  active BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  avatar_url TEXT,
  pix_key TEXT,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  product_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  permissions JSONB NOT NULL DEFAULT '{
    "manage_services": false,
    "manage_schedule_others": false,
    "view_all_appointments": false,
    "manage_finance": false
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'corte',
  price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  price_in_cents INTEGER DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  default_duration_minutes INTEGER NOT NULL DEFAULT 30,
  image_url TEXT,
  image_path TEXT,
  ordem INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  clean_phone TEXT,
  notes TEXT,
  last_appointment_at DATE,
  return_cycle_days INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  service_ids UUID[] DEFAULT '{}',
  client_name TEXT NOT NULL,
  client_phone TEXT,
  clean_phone TEXT,
  service TEXT,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  start_time TIME,
  end_time TIME,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'agendado',
  payment_status TEXT NOT NULL DEFAULT 'pendente',
  payment_method TEXT,
  barber_commission_rate NUMERIC(5,2),
  barber_commission_amount NUMERIC(10,2) DEFAULT 0.00,
  notes TEXT,
  is_pre_schedule BOOLEAN NOT NULL DEFAULT false,
  reference_photo_id UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
