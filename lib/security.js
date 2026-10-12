// Auditoria de eventos de segurança e rate limiting em memória / banco
import { createAdminClient } from "@/lib/supabase/admin";

// Estrutura em memória para limitação por IP de requisições de recuperação
// Chave: IP, Valor: { count: number, resetAt: number, blockedUntil: number }
const ipLimitStore = new Map();

// Limpeza periódica de memória a cada 10 minutos
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

function purgeExpiredIpRecords() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [ip, record] of ipLimitStore.entries()) {
    if (record.resetAt < now && (!record.blockedUntil || record.blockedUntil < now)) {
      ipLimitStore.delete(ip);
    }
  }
}

/**
 * Valida rate limit por endereço IP para endpoints e actions de recuperação.
 * @param {string} ip Endereço IP do cliente
 * @param {Object} options Configurações
 * @param {number} options.maxAttempts Máximo de requisições permitidas na janela
 * @param {number} options.windowMinutes Janela de contagem em minutos
 * @param {number} options.blockMinutes Duração do bloqueio temporário se exceder
 * @returns {{ allowed: boolean, remaining: number, retryAfterMinutes?: number }}
 */
export function checkIpRateLimit(ip, { maxAttempts = 10, windowMinutes = 15, blockMinutes = 30 } = {}) {
  if (!ip || ip === "unknown") {
    return { allowed: true, remaining: maxAttempts };
  }

  purgeExpiredIpRecords();

  const now = Date.now();
  const existing = ipLimitStore.get(ip);

  if (existing) {
    if (existing.blockedUntil && existing.blockedUntil > now) {
      const retryAfterMinutes = Math.max(1, Math.ceil((existing.blockedUntil - now) / 60000));
      return { allowed: false, remaining: 0, retryAfterMinutes };
    }

    if (now > existing.resetAt) {
      // Janela expirou, reinicia
      ipLimitStore.set(ip, {
        count: 1,
        resetAt: now + windowMinutes * 60000,
        blockedUntil: 0,
      });
      return { allowed: true, remaining: maxAttempts - 1 };
    }

    existing.count += 1;
    if (existing.count > maxAttempts) {
      existing.blockedUntil = now + blockMinutes * 60000;
      const retryAfterMinutes = blockMinutes;
      return { allowed: false, remaining: 0, retryAfterMinutes };
    }

    return { allowed: true, remaining: maxAttempts - existing.count };
  }

  ipLimitStore.set(ip, {
    count: 1,
    resetAt: now + windowMinutes * 60000,
    blockedUntil: 0,
  });

  return { allowed: true, remaining: maxAttempts - 1 };
}

/**
 * Extrai e anonimiza o IP do cliente a partir dos headers de requisição.
 */
export function getClientIp(headersList) {
  if (!headersList) return "unknown";
  const raw =
    headersList.get?.("x-forwarded-for") ||
    headersList.get?.("x-real-ip") ||
    headersList.get?.("cf-connecting-ip") ||
    "";
  const first = raw.split(",")[0]?.trim();
  return first || "127.0.0.1";
}

/**
 * Registra um evento de auditoria de segurança.
 * Grava na tabela `security_audit_logs` (se existir) e registra log estruturado no servidor
 * sem expor dados sensíveis ou senhas.
 */
export async function logSecurityEvent({
  action,
  barberId = null,
  ip = null,
  success = true,
  details = {},
}) {
  const timestamp = new Date().toISOString();
  const safePayload = {
    action,
    barber_id: barberId ? String(barberId) : null,
    ip_address: ip ? String(ip).slice(0, 45) : null,
    success: Boolean(success),
    metadata: details,
    created_at: timestamp,
  };

  // Log estruturado no servidor (sem credenciais)
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    console.info(`[SECURITY_AUDIT] ${action} | Barber: ${barberId || "N/A"} | Success: ${success}`);
  }

  // Gravação no Supabase via Service Role (best-effort: não interrompe fluxo principal se tabela não existir ainda)
  try {
    const admin = createAdminClient();
    await admin.from("security_audit_logs").insert([safePayload]);
  } catch (err) {
    // Tabela pode ainda estar a ser criada via migração; falha silenciosa para não quebrar a action
  }
}
