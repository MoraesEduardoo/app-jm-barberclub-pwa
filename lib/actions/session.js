"use server"

import { requireBarber } from "@/lib/auth-server";

export async function getCurrentBarber() {
  const ctx = await requireBarber();
  if (ctx.error) return { error: ctx.error };
  return { barber: ctx.barber };
}
