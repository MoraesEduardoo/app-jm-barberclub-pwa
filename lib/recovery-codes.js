// SOMENTE SERVIDOR (importado apenas por Server Actions). Nunca importar em "use client".
import { createHmac, randomInt } from "node:crypto";

export const CODE_LENGTH = 10;
export const CODES_PER_BATCH = 8;

// Sem 0/O/1/I/L para evitar confusão ao digitar. 31^10 ≈ 8e14 combinações por código.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "abcde-fghjk" -> "ABCDEFGHJK" (aceita espaços, hífens e minúsculas). */
export function normalizeCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCode(normalized) {
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function generateCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

/** HMAC com segredo do servidor: vazar a tabela não permite validar códigos. */
export function hashCode(normalized) {
  const pepper = process.env.RECOVERY_CODE_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pepper) throw new Error("RECOVERY_CODE_PEPPER (ou SUPABASE_SERVICE_ROLE_KEY) não configurada.");
  return createHmac("sha256", pepper).update(normalized).digest("hex");
}
