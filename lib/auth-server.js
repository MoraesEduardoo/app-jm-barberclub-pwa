import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PERMISSIONS, hasPermission, isChefe } from "@/lib/auth";

const BARBER_COLUMNS =
  "id, name, phone, role, active, permissions, commission_percent, avatar_url";

/**
 * Valida a sessão no servidor e devolve o barbeiro logado.
 * Retorna { supabase, user, barber } ou { error: "AUTH_EXPIRED" | "FORBIDDEN" }.
 *
 * O vínculo utilizador -> barbeiro vem de app_metadata.barber_id, que só pode
 * ser escrito com a service role (o próprio utilizador NÃO consegue alterar).
 */
export async function requireBarber(permissionKey = null) {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { error: "AUTH_EXPIRED" };

  const barberId = user.app_metadata?.barber_id;
  if (!barberId) return { error: "AUTH_EXPIRED" };

  const { data, error } = await supabase
    .from("barbers")
    .select(BARBER_COLUMNS)
    .eq("id", barberId)
    .maybeSingle();

  // barbeiro removido ou desativado => sessão deixa de valer
  if (error || !data || data.active === false) return { error: "AUTH_EXPIRED" };

  const barber = {
    ...data,
    permissions: { ...DEFAULT_PERMISSIONS, ...(data.permissions || {}) },
  };

  if (permissionKey && !hasPermission(barber, permissionKey)) return { error: "FORBIDDEN" };

  return { supabase, user, barber };
}

export async function requireChefe() {
  const ctx = await requireBarber();
  if (ctx.error) return ctx;
  if (!isChefe(ctx.barber)) return { error: "FORBIDDEN" };
  return ctx;
}
