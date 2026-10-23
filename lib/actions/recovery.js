"use server";

import { headers } from "next/headers";
import { requireChefe } from "@/lib/auth-server";
import { createAdminClient, ensureAuthUserForBarber } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";
import { logSecurityEvent, getClientIp } from "@/lib/security";

/**
 * Só o chefe. Gera um link de recuperação de uso único para um barbeiro.
 * Não envia e-mail (o login usa e-mail sintético telefone@domínio): o chefe
 * entrega o link por WhatsApp. Devolve { url, name, phone } ou { error }.
 * Validação rigorosa de NEXT_PUBLIC_SITE_URL para evitar erros em proxies reversos.
 */
export async function createRecoveryLink(barberId) {
  const ctx = await requireChefe();
  if (ctx.error) {
    return { error: ctx.error === "FORBIDDEN" ? "Sem permissão para esta ação." : "AUTH_EXPIRED" };
  }
  if (!barberId) return { error: "Barbeiro inválido." };

  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  try {
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from("barbers")
      .select("id, name, phone, active")
      .eq("id", barberId)
      .maybeSingle();

    if (targetError || !target) return { error: "Barbeiro não encontrado." };
    if (target.active === false) return { error: "Este barbeiro está inativo. Reative antes de gerar o link." };

    // Garante ou provisiona o usuário de autenticação (evita erro de barbeiro sem acesso no Auth)
    const authUser = await ensureAuthUserForBarber(admin, barberId);
    if (!authUser?.email) return { error: "Não foi possível vincular o acesso deste barbeiro no Auth." };

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: authUser.email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[createRecoveryLink] Falha ao gerar link:", error?.message);
      }
      return { error: "Não foi possível gerar o link. Tente novamente." };
    }

    // Resolução rigorosa da URL base do site
    const baseUrl = getSiteUrl(reqHeaders);
    const url = `${baseUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

    // Registro de auditoria: geração de link pelo chefe
    await logSecurityEvent({
      action: "RECOVERY_LINK_GENERATED_BY_CHEFE",
      barberId: target.id,
      ip: clientIp,
      success: true,
      details: {
        created_by_barber_id: ctx.barber.id,
        target_name: target.name,
      },
    });

    return { url, name: target.name, phone: target.phone };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[createRecoveryLink]", e?.message || e);
    }
    return { error: "Falha de conexão. Tente novamente." };
  }
}
