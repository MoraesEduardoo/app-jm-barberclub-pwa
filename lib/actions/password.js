"use server";

import { headers } from "next/headers";
import { requireBarber } from "@/lib/auth-server";
import { validateNewPassword } from "@/lib/password-policy";
import { logSecurityEvent, getClientIp } from "@/lib/security";
import bcrypt from "bcryptjs";

/**
 * Troca a senha do barbeiro diretamente na tabela `barbers`.
 * Valida a sessão ativa, política de senha e atualiza a coluna password_hash com hash bcrypt.
 */
export async function updatePasswordAction(password, confirm) {
  const ctx = await requireBarber();
  if (ctx.error) {
    return { code: "SESSION_INVALID", error: "Sua sessão expirou. Faça login novamente." };
  }

  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  const validationError = validateNewPassword(password, confirm);
  if (validationError) return { code: "VALIDATION", error: validationError };

  const hashedPassword = await bcrypt.hash(password, 10);

  const { error } = await ctx.supabase
    .from("barbers")
    .update({
      password_hash: hashedPassword,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.barber.id);

  if (error) {
    console.error("[updatePasswordAction] Erro no update:", error.message || error);
    await logSecurityEvent({
      action: "PASSWORD_UPDATE_FAILED",
      barberId: ctx.barber.id,
      ip: clientIp,
      success: false,
    });
    return { code: "UNKNOWN", error: "Não foi possível alterar a senha no banco de dados." };
  }

  await logSecurityEvent({
    action: "PASSWORD_UPDATE_SUCCESS",
    barberId: ctx.barber.id,
    ip: clientIp,
    success: true,
  });

  return { ok: true };
}
