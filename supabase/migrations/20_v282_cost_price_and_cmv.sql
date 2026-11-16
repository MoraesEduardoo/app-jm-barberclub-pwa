-- =============================================================================
-- 20_v282_cost_price_and_cmv.sql
-- Adição incremental do Preço de Custo (cost_price) em products para cálculo de CMV
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) NOT NULL DEFAULT 0.00;
