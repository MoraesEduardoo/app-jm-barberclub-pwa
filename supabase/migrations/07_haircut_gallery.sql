-- =============================================================================
-- 07_haircut_gallery.sql
-- Galeria de cortes e portfólio de fotos (haircut_gallery)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.haircut_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'degrade',
  image_url TEXT NOT NULL,
  storage_url TEXT,
  image_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_haircut_gallery_active ON public.haircut_gallery (is_active, created_at DESC);
