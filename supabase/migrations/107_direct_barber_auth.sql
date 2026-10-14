-- ==============================================================================
-- MIGRAÇÃO 107: AUTENTICAÇÃO DIRETA NA TABELA BARBERS (JM BARBERCLUB)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/107_direct_barber_auth.sql
-- ==============================================================================

-- 1. Garante as colunas para armazenar senhas diretamente na tabela barbers
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS password TEXT;

-- 2. Atualização ou inserção das credenciais oficiais dos barbeiros
-- Matheus (Gestor / Chefe): 83996646306 / Matheus123
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM barbers WHERE phone LIKE '%83996646306%' OR phone LIKE '%83%99664%6306%') THEN
        UPDATE barbers 
        SET 
            password_hash = 'Matheus123',
            password = 'Matheus123',
            active = TRUE,
            role = 'admin',
            updated_at = NOW()
        WHERE phone LIKE '%83996646306%' OR phone LIKE '%83%99664%6306%';
    ELSE
        INSERT INTO barbers (name, phone, role, commission_percent, commission_rate, active, password_hash, password)
        VALUES ('Matheus', '83996646306', 'admin', 50.00, 50.00, TRUE, 'Matheus123', 'Matheus123');
    END IF;
END $$;

-- William (Barbeiro): 83991751875 / William123
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM barbers WHERE phone LIKE '%83991751875%' OR phone LIKE '%83%99175%1875%') THEN
        UPDATE barbers 
        SET 
            password_hash = 'William123',
            password = 'William123',
            active = TRUE,
            role = 'barber',
            updated_at = NOW()
        WHERE phone LIKE '%83991751875%' OR phone LIKE '%83%99175%1875%';
    ELSE
        INSERT INTO barbers (name, phone, role, commission_percent, commission_rate, active, password_hash, password)
        VALUES ('William', '83991751875', 'barber', 50.00, 50.00, TRUE, 'William123', 'William123');
    END IF;
END $$;

-- 3. Índices para busca ultra-rápida por telefone
CREATE INDEX IF NOT EXISTS idx_barbers_phone_auth ON barbers(phone);
