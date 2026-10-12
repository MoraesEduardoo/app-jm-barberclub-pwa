"use server";

import { headers } from "next/headers";
import { requireBarber } from "@/lib/auth-server";
import { validateNewPassword } from "@/lib/password-policy";
import { logSecurityEvent, getClientIp } from "@/lib/security";

/**
 * Troca a senha do barbeiro com sessão válida (sessão normal ou sessão aberta
 * pelo link de recuperação). Valida TUDO no servidor: sessão, barbeiro ativo e
 * política de senha. Registra auditoria de segurança e mascara logs crus em produção.
 * Devolve { ok: true } ou { error, code } — nunca lança.
 */
export async function updatePasswordAction(password, confirm) {
  const ctx = await requireBarber();
  if (ctx.error) {
    return { code: "SESSION_INVALID", error: "Sua sessão expirou. Peça um novo link de recuperação." };
  }

  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  const validationError = validateNewPassword(password, confirm);
  if (validationError) return { code: "VALIDATION", error: validationError };

  const { error } = await ctx.supabase.auth.updateUser({ password });

  if (error) {
    await logSecurityEvent({
      action: "PASSWORD_UPDATE_FAILED",
      barberId: ctx.barber.id,
      ip: clientIp,
      success: false,
      details: { errorCode: error.code },
    });

    switch (error.code) {
      case "same_password":
        return { code: "SAME_PASSWORD", error: "A nova senha precisa ser diferente da atual." };
      case "weak_password":
        return { code: "WEAK_PASSWORD", error: "Senha fraca demais. Misture letras e números." };
      case "session_not_found":
      case "session_expired":
      case "refresh_token_not_found":
      case "bad_jwt":
        return { code: "SESSION_INVALID", error: "Sua sessão expirou. Peça um novo link de recuperação." };
      default:
        if (process.env.NODE_ENV !== "production") {
          console.error("[updatePasswordAction]", error.code, error.message);
        }
        return { code: "UNKNOWN", error: "Não foi possível alterar a senha. Tente novamente." };
    }
  }

  // Auditoria de segurança para troca de senha com sucesso
  await logSecurityEvent({
    action: "PASSWORD_UPDATE_SUCCESS",
    barberId: ctx.barber.id,
    ip: clientIp,
    success: true,
  });

  // Derruba as OUTRAS sessões (ex.: quem tinha a senha antiga). Best effort: a
  // senha já foi trocada, então uma falha aqui não pode virar erro para o usuário.
  try {
    await ctx.supabase.auth.signOut({ scope: "others" });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[updatePasswordAction] signOut others falhou", e?.message || e);
    }
  }

  return { ok: true };
}
