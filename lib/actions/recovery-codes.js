"use server";

import { headers } from "next/headers";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { requireBarber } from "@/lib/auth-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CODES_PER_BATCH, CODE_VALIDITY_DAYS, formatCode, generateCode, hashCode } from "@/lib/recovery-codes";
import { logSecurityEvent, getClientIp } from "@/lib/security";

const TABLE = "barber_recovery_codes";

/** Quantos códigos válidos e ainda não usados o barbeiro logado possui. */
export async function getRecoveryCodesStatus() {
  const ctx = await requireBarber();
  if (ctx.error) return { error: "AUTH_EXPIRED" };

  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    // Filtra códigos não usados e não expirados
    const { count, error } = await admin
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("barber_id", String(ctx.barber.id))
      .is("used_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

    if (error) throw error;
    return { remaining: count ?? 0 };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[getRecoveryCodesStatus]", e?.message || e);
    }
    return { error: "Não foi possível carregar o status dos códigos." };
  }
}

/**
 * Gera um novo lote de códigos (invalida os anteriores). Exige a SENHA ATUAL:
 * quem pegar um celular desbloqueado não consegue criar códigos de fuga.
 * Define a coluna expires_at para 90 dias a partir da criação.
 * Os códigos em texto puro são devolvidos UMA vez e nunca mais.
 */
export async function generateRecoveryCodes(currentPassword) {
  const ctx = await requireBarber();
  if (ctx.error) return { error: "AUTH_EXPIRED" };
  if (!currentPassword || typeof currentPassword !== "string") {
    return { error: "Digite a sua senha atual." };
  }

  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  try {
    // Confere a senha com um cliente descartável (não mexe nos cookies da sessão).
    const verifier = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: pwError } = await verifier.auth.signInWithPassword({
      email: ctx.user.email,
      password: currentPassword,
    });
    if (pwError) {
      await logSecurityEvent({
        action: "RECOVERY_CODES_GENERATE_WRONG_PASSWORD",
        barberId: ctx.barber.id,
        ip: clientIp,
        success: false,
      });
      return { error: "Senha atual incorreta." };
    }

    const barberId = String(ctx.barber.id);
    const plain = Array.from({ length: CODES_PER_BATCH }, generateCode);

    // Validade explícita de 90 dias
    const expiresAt = new Date(Date.now() + CODE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = plain.map((c) => ({
      barber_id: barberId,
      code_hash: hashCode(c),
      expires_at: expiresAt,
    }));

    const admin = createAdminClient();
    const { data: inserted, error: insertError } = await admin.from(TABLE).insert(rows).select("id");
    if (insertError || !inserted?.length) throw insertError || new Error("insert vazio");

    // Só depois de gravar os novos é que os antigos saem (nunca fica sem códigos).
    const keep = inserted.map((r) => r.id);
    const { error: cleanupError } = await admin
      .from(TABLE)
      .delete()
      .eq("barber_id", barberId)
      .not("id", "in", `(${keep.join(",")})`);

    if (cleanupError && process.env.NODE_ENV !== "production") {
      console.error("[generateRecoveryCodes] cleanup", cleanupError?.message);
    }

    // Gerar códigos novos também zera qualquer bloqueio anterior de tentativas.
    await admin.from("barber_recovery_state").delete().eq("barber_id", barberId);

    // Auditoria de segurança para emissão de novos códigos
    await logSecurityEvent({
      action: "RECOVERY_CODES_GENERATED",
      barberId,
      ip: clientIp,
      success: true,
      details: { batchSize: plain.length, expiresAt },
    });

    return { codes: plain.map(formatCode) };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[generateRecoveryCodes]", e?.message || e);
    }
    return { error: "Não foi possível gerar os códigos. Tente novamente." };
  }
}
