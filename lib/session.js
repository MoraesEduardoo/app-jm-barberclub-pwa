"use client";

import { logoutBarberAction } from "@/lib/actions/barber-auth";

/** Encerra a sessão direta do painel (remove cookie jm_barber_session) e redireciona para /login. */
export async function endSession() {
  try {
    await logoutBarberAction();
  } catch {}
  window.location.replace("/login");
}
