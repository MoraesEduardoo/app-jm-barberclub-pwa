-- =============================================================================
-- 21_barbershop_status.sql
-- Controle de Status de Movimento ("Modo Lotado") para integração com Chatbot
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.barbershop_status (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_crowded BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.barbershop_status (id, is_crowded)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.barbershop_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "barbershop_status_public_read" ON public.barbershop_status;
CREATE POLICY "barbershop_status_public_read"
  ON public.barbershop_status
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "barbershop_status_authenticated_write" ON public.barbershop_status;
CREATE POLICY "barbershop_status_authenticated_write"
  ON public.barbershop_status
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.barbershop_status TO anon, authenticated;
GRANT INSERT, UPDATE ON public.barbershop_status TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.barbershop_status;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
