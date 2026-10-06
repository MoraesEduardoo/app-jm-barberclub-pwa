"use server";

import { headers } from "next/headers";
import { requireChefe } from "@/lib/auth-server";
import { createAdminClient, findAuthUserByBarberId } from "@/lib/supabase/admin";

function siteUrl() {
  // Prefira definir NEXT_PUBLIC_SITE_URL (ex.: https://painel.jmbarberclub.app).
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Só o chefe. Gera um link de recuperação de uso único para um barbeiro.
 * Não envia e-mail (o login usa e-mail sintético telefone@domínio): o chefe
 * entrega o link por WhatsApp. Devolve { url, name, phone } ou { error }.
 */
export async function createRecoveryLink(barberId) {
  const ctx = await requireChefe();
  if (ctx.error) {
    return { error: ctx.error === "FORBIDDEN" ? "Sem permissão para esta ação." : "AUTH_EXPIRED" };
  }
  if (!barberId) return { error: "Barbeiro inválido." };

  try {
    const { data: target, error: targetError } = await ctx.supabase
      .from("barbers")
      .select("id, name, phone, active")
      .eq("id", barberId)
      .maybeSingle();

    if (targetError || !target) return { error: "Barbeiro não encontrado." };
    if (target.active === false) return { error: "Este barbeiro está inativo. Reative antes de gerar o link." };

    const admin = createAdminClient();
    const authUser = await findAuthUserByBarberId(admin, barberId);
    if (!authUser?.email) return { error: "Esse barbeiro ainda não tem acesso criado." };

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: authUser.email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[createRecoveryLink]", error?.message);
      return { error: "Não foi possível gerar o link. Tente novamente." };
    }

    const url = `${siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
    return { url, name: target.name, phone: target.phone };
  } catch (e) {
    console.error("[createRecoveryLink]", e);
    return { error: "Falha de conexão. Tente novamente." };
  }
}
