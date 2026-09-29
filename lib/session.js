"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Encerra a sessão do Supabase (cookies) e volta para /login. */
export async function endSession() {
  try {
    await getSupabaseBrowserClient().auth.signOut();
  } catch {}
  window.location.replace("/login");
}
