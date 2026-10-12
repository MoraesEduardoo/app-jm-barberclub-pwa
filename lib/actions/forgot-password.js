"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, findAuthUserByBarberId } from "@/lib/supabase/admin";
import { phoneDigits } from "@/lib/auth-identity";
import { validateNewPassword } from "@/lib/password-policy";
import { CODE_LENGTH, CODE_VALIDITY_DAYS, hashCode, normalizeCode } from "@/lib/recovery-codes";
import { checkIpRateLimit, getClientIp, logSecurityEvent } from "@/lib/security";

const CODES = "barber_recovery_codes";
const STATE = "barber_recovery_state";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Mensagem única para telefone inexistente, barbeiro inativo e código errado:
// ninguém descobre quais telefones têm conta.
const GENERIC = "Telefone ou código de recuperação inválidos.";

// Tolera DDI 55: "5583996646306" e "83996646306" são o mesmo número.
function canonicalPhone(value) {
  const d = phoneDigits(value);
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
}

// Equipe pequena: lista e compara os dígitos (o telefone pode estar salvo formatado).
async function findBarberByPhone(admin, digits) {
  const { data, error } = await admin.from("barbers").select("id, phone, active");
  if (error) throw error;
  return data.find((b) => canonicalPhone(b.phone) === digits) || null;
}

async function registerFailure(admin, barberId, current) {
  const failed = (current?.failed_attempts || 0) + 1;
  const locked = failed >= MAX_ATTEMPTS;
  await admin.from(STATE).upsert({
    barber_id: barberId,
    failed_attempts: locked ? 0 : failed,
    locked_until: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
  });
}

/**
 * Redefinição self-service SEM sessão: telefone + código de recuperação (uso único)
 * + nova senha, tudo numa chamada só (sem etapa que revele se o telefone existe).
 * Protegido com rate limiting por IP, expiração de 90 dias e auditoria segura.
 * Devolve { ok, signedIn, remaining } ou { code, error }. Nunca lança.
 */
export async function resetPasswordWithRecoveryCode({ phone, code, password, confirm } = {}) {
  let claimedId = null;
  let admin = null;
  let clientIp = "unknown";

  try {
    const h = await headers();
    clientIp = getClientIp(h);

    // 1. Blindagem contra DoS / Força bruta por IP (10 tentativas a cada 15 min por IP)
    const ipCheck = checkIpRateLimit(clientIp, { maxAttempts: 10, windowMinutes: 15, blockMinutes: 30 });
    if (!ipCheck.allowed) {
      await logSecurityEvent({
        action: "RECOVERY_RATE_LIMIT_BLOCKED",
        ip: clientIp,
        success: false,
        details: { retryAfterMinutes: ipCheck.retryAfterMinutes },
      });
      return {
        code: "RATE_LIMITED",
        error: `Muitas requisições originadas do seu IP. Aguarde ${ipCheck.retryAfterMinutes} minutos para tentar novamente.`,
      };
    }

    const digits = canonicalPhone(phone);
    if (digits.length < 10) return { code: "VALIDATION", error: "Digite um telefone válido, com DDD." };

    const normalized = normalizeCode(code);
    if (normalized.length !== CODE_LENGTH) {
      return { code: "VALIDATION", error: "O código tem 10 caracteres (ex.: ABCDE-FGHJK)." };
    }

    const passwordError = validateNewPassword(password, confirm);
    if (passwordError) return { code: "VALIDATION", error: passwordError };

    admin = createAdminClient();
    const barber = await findBarberByPhone(admin, digits);
    if (!barber || barber.active === false) {
      await logSecurityEvent({
        action: "RECOVERY_INVALID_BARBER",
        ip: clientIp,
        success: false,
      });
      return { code: "INVALID", error: GENERIC };
    }

    const barberId = String(barber.id);

    // Bloqueio temporário por barbeiro após 5 erros seguidos.
    const { data: state } = await admin.from(STATE).select("failed_attempts, locked_until").eq("barber_id", barberId).maybeSingle();
    if (state?.locked_until && new Date(state.locked_until) > new Date()) {
      const minutes = Math.max(1, Math.ceil((new Date(state.locked_until) - Date.now()) / 60_000));
      return { code: "LOCKED", error: `Muitas tentativas. Tente de novo em ${minutes} min.` };
    }

    // Busca o código hash na tabela de recuperação com verificação de ciclo de vida (expires_at / created_at)
    const { data: match } = await admin
      .from(CODES)
      .select("id, created_at, expires_at")
      .eq("barber_id", barberId)
      .eq("code_hash", hashCode(normalized))
      .is("used_at", null)
      .maybeSingle();

    if (!match) {
      await registerFailure(admin, barberId, state);
      await logSecurityEvent({
        action: "RECOVERY_CODE_WRONG",
        barberId,
        ip: clientIp,
        success: false,
      });
      return { code: "INVALID", error: GENERIC };
    }

    // Verificação de expiração do código (coluna expires_at ou janela de 90 dias a partir de created_at)
    const now = new Date();
    let isExpired = false;
    if (match.expires_at && new Date(match.expires_at) < now) {
      isExpired = true;
    } else if (match.created_at) {
      const creationDate = new Date(match.created_at);
      const diffDays = (now.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > CODE_VALIDITY_DAYS) {
        isExpired = true;
      }
    }

    if (isExpired) {
      await registerFailure(admin, barberId, state);
      await logSecurityEvent({
        action: "RECOVERY_CODE_EXPIRED",
        barberId,
        ip: clientIp,
        success: false,
      });
      return { code: "EXPIRED", error: "Este código de recuperação expirou. Solicite um novo conjunto de códigos." };
    }

    // "Queima" o código de forma atômica: se duas requisições chegarem juntas, só uma vence.
    const { data: claimed } = await admin
      .from(CODES)
      .update({ used_at: new Date().toISOString() })
      .eq("id", match.id)
      .is("used_at", null)
      .select("id");
    if (!claimed?.length) return { code: "INVALID", error: GENERIC };
    claimedId = match.id;

    // Busca otimizada do authUser (elimina listUsers massivo)
    const authUser = await findAuthUserByBarberId(admin, barberId);
    if (!authUser?.email) throw new Error("barbeiro sem usuário no Auth");

    const { error: updateError } = await admin.auth.admin.updateUserById(authUser.id, { password });
    if (updateError) {
      if (updateError.code === "same_password") {
        await admin.from(CODES).update({ used_at: null }).eq("id", claimedId); // não gasta o código
        claimedId = null;
        return { code: "SAME_PASSWORD", error: "A nova senha precisa ser diferente da atual." };
      }
      throw updateError;
    }
    claimedId = null; // senha trocada: o código está definitivamente gasto

    await admin.from(STATE).delete().eq("barber_id", barberId);

    const { count } = await admin
      .from(CODES)
      .select("id", { count: "exact", head: true })
      .eq("barber_id", barberId)
      .is("used_at", null);

    // Auditoria de evento de segurança com sucesso
    await logSecurityEvent({
      action: "RECOVERY_CODE_USED_SUCCESS",
      barberId,
      ip: clientIp,
      success: true,
      details: { remainingCodes: count ?? 0 },
    });

    // Já deixa o barbeiro logado (cookies gravados nesta Server Action).
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: authUser.email, password });
    return { ok: true, signedIn: !signInError, remaining: count ?? 0 };
  } catch (e) {
    // Log seguro no servidor sem expor detalhes sensíveis
    if (process.env.NODE_ENV !== "production") {
      console.error("[resetPasswordWithRecoveryCode]", e?.message || e);
    }
    // Falhou DEPOIS de queimar o código e ANTES de trocar a senha: devolve o código.
    if (claimedId && admin) {
      try {
        await admin.from(CODES).update({ used_at: null }).eq("id", claimedId);
      } catch {}
    }
    return { code: "UNKNOWN", error: "Não foi possível redefinir a senha agora. Tente novamente." };
  }
}
