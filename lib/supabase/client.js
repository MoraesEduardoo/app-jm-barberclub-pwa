'use client';

import { createClient } from '@supabase/supabase-js';

let browserClient;

/**
 * Cliente Supabase para Client Components.
 * Reaproveita a mesma instância entre renders (singleton).
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error(
        '❌ Erro de Configuração: NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY não estão definidos no ambiente.'
      );
    }

    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return browserClient;
}