"use server";

import { requireBarber } from "@/lib/auth-server";
import { validateNewPassword } from "@/lib/password-policy";

/**
 * Troca a senha do barbeiro com sessão válida (sessão normal ou sessão aberta
 * pelo link de recuperação). Valida TUDO no servidor: sessão, barbeiro ativo e
 * política de senha. Devolve { ok: true } ou { error, code } — nunca lança,
 * porque em produção o Next mascara mensagens de exceções de Server Actions.
 */
export async function updatePasswordAction(password, confirm) {
  const ctx = await requireBarber();
  if (ctx.error) {
    return { code: "SESSION_INVALID", error: "Sua sessão expirou. Peça um novo link de recuperação." };
  }

  const validationError = validateNewPassword(password, confirm);
  if (validationError) return { code: "VALIDATION", error: validationError };

  const { error } = await ctx.supabase.auth.updateUser({ password });

  if (error) {
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
        console.error("[updatePasswordAction]", error.code, error.message);
        return { code: "UNKNOWN", error: "Não foi possível alterar a senha. Tente novamente." };
    }
  }

  // Derruba as OUTRAS sessões (ex.: quem tinha a senha antiga). Best effort: a
  // senha já foi trocada, então uma falha aqui não pode virar erro para o usuário.
  try {
    await ctx.supabase.auth.signOut({ scope: "others" });
  } catch (e) {
    console.error("[updatePasswordAction] signOut others falhou", e);
  }

  return { ok: true };
}
