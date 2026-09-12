import { createClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para Server Actions / Server Components.
 * Usa a service role apenas no servidor — nunca expor essa chave no client.
 */
export function getSupabaseServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
}
