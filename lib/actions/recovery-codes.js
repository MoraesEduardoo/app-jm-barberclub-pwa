"use server";

import { createClient as createAnonClient } from "@supabase/supabase-js";
import { requireBarber } from "@/lib/auth-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CODES_PER_BATCH, formatCode, generateCode, hashCode } from "@/lib/recovery-codes";

const TABLE = "barber_recovery_codes";

/** Quantos códigos ainda não usados o barbeiro logado possui. */
export async function getRecoveryCodesStatus() {
  const ctx = await requireBarber();
  if (ctx.error) return { error: "AUTH_EXPIRED" };

  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("barber_id", String(ctx.barber.id))
      .is("used_at", null);
    if (error) throw error;
    return { remaining: count ?? 0 };
  } catch (e) {
    console.error("[getRecoveryCodesStatus]", e);
    return { error: "Não foi possível carregar o status dos códigos." };
  }
}

/**
 * Gera um novo lote de códigos (invalida os anteriores). Exige a SENHA ATUAL:
 * quem pegar um celular desbloqueado não consegue criar códigos de fuga.
 * Os códigos em texto puro são devolvidos UMA vez e nunca mais.
 */
export async function generateRecoveryCodes(currentPassword) {
  const ctx = await requireBarber();
  if (ctx.error) return { error: "AUTH_EXPIRED" };
  if (!currentPassword || typeof currentPassword !== "string") {
    return { error: "Digite a sua senha atual." };
  }

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
    if (pwError) return { error: "Senha atual incorreta." };

    const barberId = String(ctx.barber.id);
    const plain = Array.from({ length: CODES_PER_BATCH }, generateCode);
    const rows = plain.map((c) => ({ barber_id: barberId, code_hash: hashCode(c) }));

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
    if (cleanupError) console.error("[generateRecoveryCodes] cleanup", cleanupError);

    // Gerar códigos novos também zera um bloqueio anterior.
    await admin.from("barber_recovery_state").delete().eq("barber_id", barberId);

    return { codes: plain.map(formatCode) };
  } catch (e) {
    console.error("[generateRecoveryCodes]", e);
    return { error: "Não foi possível gerar os códigos. Tente novamente." };
  }
}
