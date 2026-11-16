-- =============================================================================
-- 15_storage_buckets.sql
-- Buckets públicos do Supabase Storage (gallery, avatars, services, products)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('haircut-gallery', 'haircut-gallery', true),
  ('gallery', 'gallery', true),
  ('avatars', 'avatars', true),
  ('services', 'services', true),
  ('products', 'products', true)
ON CONFLICT (id) DO NOTHING;
