"use client";

import { createBrowserClient } from "@supabase/ssr";

let browserClient;

/**
 * Cliente Supabase para Client Components.
 * IMPORTANTE: usa createBrowserClient (@supabase/ssr), que guarda a sessão em
 * COOKIES. Assim o middleware e as Server Actions conseguem ler o mesmo login.
 * (createClient do supabase-js guarda em localStorage e o servidor nunca vê.)
 */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

    browserClient = createBrowserClient(url, anonKey);
  }
  return browserClient;
}
