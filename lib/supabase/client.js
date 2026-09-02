'use client';

import { createClient } from '@supabase/supabase-js';

let browserClient;

/**
 * Cliente Supabase para Client Components.
 * Reaproveita a mesma instância entre renders (singleton).
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return browserClient;
}
