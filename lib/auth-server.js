import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PERMISSIONS, hasPermission, isChefe } from "@/lib/auth";

const BARBER_COLUMNS =
  "id, auth_user_id, name, phone, role, active, permissions, commission_percent, avatar_url";

/**
 * Valida a sessão no servidor e devolve o barbeiro logado.
 * Retorna { supabase, user, barber } ou { error: "AUTH_EXPIRED" | "FORBIDDEN" }.
 *
 * Mapeamento resiliente:
 * 1. user.app_metadata?.barber_id
 * 2. barbers.auth_user_id = user.id
 * 3. Telefone derivado do e-mail sintético (ex: 83996646306@barbers.jmbarberclub.app)
 * Realiza auto-link com a service role caso auth_user_id esteja desatualizado.
 */
export async function requireBarber(permissionKey = null) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { error: "AUTH_EXPIRED" };

  let barber = null;
  const barberId = user.app_metadata?.barber_id;

  // 1. Busca rápida pelo barber_id em app_metadata se existir
  if (barberId) {
    const { data } = await supabase
      .from("barbers")
      .select(BARBER_COLUMNS)
      .eq("id", barberId)
      .maybeSingle();
    if (data) barber = data;
  }

  // 2. Busca direta por auth_user_id = user.id
  if (!barber) {
    const { data } = await supabase
      .from("barbers")
      .select(BARBER_COLUMNS)
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (data) barber = data;
  }

  // 3. Fallback: derivação pelo telefone registrado no email sintético ou no perfil auth
  if (!barber) {
    let rawDigits = "";
    if (user.email) {
      const prefix = user.email.split("@")[0] || "";
      rawDigits = prefix.replace(/\D/g, "");
    }
    if (!rawDigits && user.phone) {
      rawDigits = (user.phone || "").replace(/\D/g, "");
    }

    if (rawDigits && rawDigits.length >= 10) {
      const cleanPhone = rawDigits.length > 11 && rawDigits.startsWith("55") ? rawDigits.slice(2) : rawDigits;

      const { data: allBarbers } = await supabase
        .from("barbers")
        .select(BARBER_COLUMNS);

      if (allBarbers && allBarbers.length > 0) {
        barber = allBarbers.find((b) => {
          const bDigits = (b.phone || "").replace(/\D/g, "");
          const bClean = bDigits.length > 11 && bDigits.startsWith("55") ? bDigits.slice(2) : bDigits;
          return bClean === cleanPhone;
        }) || null;
      }
    }
  }

  // Barbeiro removido, inexistente ou desativado => sessão deixa de valer
  if (!barber || barber.active === false) return { error: "AUTH_EXPIRED" };

  // Sincronização e auto-vínculo para habilitar o RLS de auth_user_id = auth.uid() e user_id
  if (barber.auth_user_id !== user.id || user.app_metadata?.barber_id !== barber.id) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      
      try {
        await admin.from("barbers").update({ auth_user_id: user.id, user_id: user.id }).eq("id", barber.id);
      } catch {
        await admin.from("barbers").update({ auth_user_id: user.id }).eq("id", barber.id);
      }

      if (user.app_metadata?.barber_id !== barber.id) {
        await admin.auth.admin.updateUserById(user.id, {
          app_metadata: { ...(user.app_metadata || {}), barber_id: barber.id },
        });
      }
      barber.auth_user_id = user.id;
    } catch {
      // Falha silenciosa de backfill: segue com o barbeiro identificado
    }
  }

  const formattedBarber = {
    ...barber,
    permissions: { ...DEFAULT_PERMISSIONS, ...(barber.permissions || {}) },
  };

  if (permissionKey && !hasPermission(formattedBarber, permissionKey)) return { error: "FORBIDDEN" };

  return { supabase, user, barber: formattedBarber };
}

export async function requireChefe() {
  const ctx = await requireBarber();
  if (ctx.error) return ctx;
  if (!isChefe(ctx.barber)) return { error: "FORBIDDEN" };
  return ctx;
}
