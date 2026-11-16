-- =============================================================================
-- 01_extensions_and_cleanup.sql
-- Extensões necessárias para o JM Barberclub (Supabase PostgreSQL)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
