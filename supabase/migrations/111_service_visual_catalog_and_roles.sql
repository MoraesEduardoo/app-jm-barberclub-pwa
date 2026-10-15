-- ==============================================================================
-- MIGRAÇÃO 111: CATÁLOGO VISUAL DE SERVIÇOS E CARGOS SIMPLIFICADOS
-- Sistema: JM Barberclub (Painel do Barbeiro e Chatbot Oficial)
-- Arquivo: supabase/migrations/111_service_visual_catalog_and_roles.sql
-- ==============================================================================

-- 1. ADICIONA COLUNAS DE IMAGEM ILUSTRATIVA NA TABELA DE SERVIÇOS
ALTER TABLE services ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS image_path TEXT;

-- 2. VINCULA AS FOTOS REAIS DO STORAGE AOS SERVIÇOS CORRESPONDENTES (CATÁLOGO OFICIAL)
UPDATE services 
SET image_url = 'https://buwyemmvitoygnekbqdu.supabase.co/storage/v1/object/public/haircut-gallery/11111111-1111-4111-a111-111111111111/9f20bb29-8851-4d65-9116-10ed3e82c1ab.webp',
    image_path = '11111111-1111-4111-a111-111111111111/9f20bb29-8851-4d65-9116-10ed3e82c1ab.webp'
WHERE name = 'Degradê' AND (image_url IS NULL OR image_url = '');

UPDATE services 
SET image_url = 'https://buwyemmvitoygnekbqdu.supabase.co/storage/v1/object/public/haircut-gallery/11111111-1111-4111-a111-111111111111/4e76e409-6f03-45e0-91a8-0b1f6973f398.webp',
    image_path = '11111111-1111-4111-a111-111111111111/4e76e409-6f03-45e0-91a8-0b1f6973f398.webp'
WHERE name = 'Corte SÓ Tesoura' AND (image_url IS NULL OR image_url = '');

UPDATE services 
SET image_url = 'https://buwyemmvitoygnekbqdu.supabase.co/storage/v1/object/public/haircut-gallery/11111111-1111-4111-a111-111111111111/db3f0292-f507-4c65-98f6-ad666ee52088.webp',
    image_path = '11111111-1111-4111-a111-111111111111/db3f0292-f507-4c65-98f6-ad666ee52088.webp'
WHERE name = 'Lowfade ou Americano' AND (image_url IS NULL OR image_url = '');

UPDATE services 
SET image_url = 'https://buwyemmvitoygnekbqdu.supabase.co/storage/v1/object/public/haircut-gallery/11111111-1111-4111-a111-111111111111/22f36e32-8915-4159-b9b9-46a3d1fadf98.webp',
    image_path = '11111111-1111-4111-a111-111111111111/22f36e32-8915-4159-b9b9-46a3d1fadf98.webp'
WHERE name = 'Barboterapia' AND (image_url IS NULL OR image_url = '');

UPDATE services 
SET image_url = 'https://buwyemmvitoygnekbqdu.supabase.co/storage/v1/object/public/haircut-gallery/11111111-1111-4111-a111-111111111111/637bce4d-5e15-4b54-8d93-128b085aa3df.webp',
    image_path = '11111111-1111-4111-a111-111111111111/637bce4d-5e15-4b54-8d93-128b085aa3df.webp'
WHERE name = 'Barba (Cavanhaque ou Design Simples)' AND (image_url IS NULL OR image_url = '');

UPDATE services 
SET image_url = 'https://buwyemmvitoygnekbqdu.supabase.co/storage/v1/object/public/haircut-gallery/11111111-1111-4111-a111-111111111111/0a034343-2418-46a8-a8a4-fbacf7c0bb4b.webp',
    image_path = '11111111-1111-4111-a111-111111111111/0a034343-2418-46a8-a8a4-fbacf7c0bb4b.webp'
WHERE name = 'Corte Simples ou Social' AND (image_url IS NULL OR image_url = '');

-- 3. GARANTE OS CARGOS OFICIAIS NA TABELA BARBERS
UPDATE barbers 
SET role = 'admin',
    permissions = '{"manage_services": true, "manage_schedule_others": true, "view_all_appointments": true, "manage_finance": true}'::jsonb
WHERE phone = '83996646306' OR name ILIKE '%Matheus%';

UPDATE barbers 
SET role = 'barber',
    permissions = '{"manage_services": false, "manage_schedule_others": false, "view_all_appointments": false, "manage_finance": false}'::jsonb
WHERE phone = '83991751875' OR name ILIKE '%William%';

-- 4. ÍNDICES DE PERFORMANCE E CONSULTA DO CHATBOT
CREATE INDEX IF NOT EXISTS idx_services_active_order ON services (is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_services_category ON services (category);
