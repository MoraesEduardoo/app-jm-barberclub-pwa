-- ==============================================================================
-- MIGRAÇÃO 008: RESTRIÇÃO DE TELEFONE ÚNICO E LIMPEZA DE DUPLICADOS (BARBERS)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/008_unique_barber_phone_and_clean_duplicates.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. LIMPEZA E CONSOLIDAÇÃO DO REGISTRO DUPLICADO DO MATHEUS
-- Reatribui todas as chaves estrangeiras para o ID oficial do Matheus
-- ('401fe8ff-d8c9-4ef2-9a36-7e7d23d10cea') e remove o registro órfão/duplicado.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_official_matheus_id UUID := '401fe8ff-d8c9-4ef2-9a36-7e7d23d10cea';
    r_dup RECORD;
BEGIN
    -- Garante que o Matheus oficial exista e tenha o telefone padrão
    IF EXISTS (SELECT 1 FROM public.barbers WHERE id = v_official_matheus_id) THEN
        -- Busca registros duplicados com o mesmo telefone ou nome
        FOR r_dup IN 
            SELECT id, name, phone 
            FROM public.barbers 
            WHERE id <> v_official_matheus_id 
              AND (
                  regexp_replace(phone, '\D', '', 'g') = '83996646306' 
                  OR regexp_replace(phone, '\D', '', 'g') LIKE '%996646306'
                  OR LOWER(name) = 'matheus'
              )
        LOOP
            RAISE NOTICE 'Consolidando dados do barbeiro duplicado % (ID: %)...', r_dup.name, r_dup.id;

            -- 1.1 Reatribuir agendamentos
            UPDATE public.appointments 
            SET barber_id = v_official_matheus_id 
            WHERE barber_id = r_dup.id;
            
            -- 1.2 Limpar associações de serviços duplicadas
            DELETE FROM public.barber_services WHERE barber_id = r_dup.id;
            
            -- 1.3 Limpar expedientes duplicados
            DELETE FROM public.barber_schedules WHERE barber_id = r_dup.id;
            
            -- 1.4 Reatribuir exceções/bloqueios pontuais
            UPDATE public.barber_exceptions 
            SET barber_id = v_official_matheus_id 
            WHERE barber_id = r_dup.id;
            
            -- 1.5 Reatribuir livro caixa / despesas (se a tabela existir)
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cash_flow') THEN
                UPDATE public.cash_flow 
                SET barber_id = v_official_matheus_id 
                WHERE barber_id = r_dup.id;
            END IF;
            
            -- 1.6 Reatribuir fechamento de comissões (se a tabela existir)
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commission_payouts') THEN
                UPDATE public.commission_payouts 
                SET barber_id = v_official_matheus_id 
                WHERE barber_id = r_dup.id;
            END IF;
            
            -- 1.7 Reatribuir fotos da galeria
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'haircut_gallery') THEN
                UPDATE public.haircut_gallery 
                SET barber_id = v_official_matheus_id 
                WHERE barber_id = r_dup.id;
            END IF;
            
            -- 1.8 Limpar assinaturas push antigas
            DELETE FROM public.push_subscriptions WHERE barber_id = r_dup.id;

            -- 1.9 Excluir o registro duplicado de barbers
            DELETE FROM public.barbers WHERE id = r_dup.id;
        END LOOP;
    END IF;

    -- --------------------------------------------------------------------------
    -- 2. LIMPEZA GENÉRICA PARA QUALQUER OUTRO TELEFONE DUPLICADO
    -- Mantém apenas o registro prioritário (admin ou mais antigo)
    -- --------------------------------------------------------------------------
    FOR r_dup IN 
        SELECT phone, COUNT(*) 
        FROM public.barbers 
        GROUP BY phone 
        HAVING COUNT(*) > 1
    LOOP
        DELETE FROM public.barbers
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY phone 
                    ORDER BY CASE WHEN role = 'admin' THEN 1 ELSE 2 END, created_at ASC
                ) as rn
                FROM public.barbers
                WHERE phone = r_dup.phone
            ) t WHERE t.rn > 1
        );
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 3. ADICIONAR RESTRIÇÃO UNIQUE NO TELEFONE (barbers_phone_unique)
-- Garante a nível de banco de dados que nunca mais existam telefones duplicados.
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'barbers_phone_unique' 
          AND table_name = 'barbers'
    ) THEN
        ALTER TABLE public.barbers 
            ADD CONSTRAINT barbers_phone_unique UNIQUE (phone);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. ÍNDICE DE PESQUISA RÁPIDA POR TELEFONE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_barbers_phone_unique_lookup 
    ON public.barbers(phone);
