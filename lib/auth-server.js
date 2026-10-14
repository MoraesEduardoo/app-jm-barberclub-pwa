import { createAdminClient } from "@/lib/supabase/admin";
import { getBarberSessionFromCookie } from "@/lib/session-cookie";
import { DEFAULT_PERMISSIONS, hasPermission, isChefe } from "@/lib/auth";

const BARBER_COLUMNS =
  "id, name, phone, role, active, permissions, commission_percent, commission_rate, avatar_url";

/**
 * Validação Direta de Sessão no Servidor (sem dependência de auth.users do Supabase).
 * 
 * Lê o cookie de sessão 'jm_barber_session', decodifica o ID do barbeiro e
 * busca os dados atualizados diretamente na tabela 'barbers'.
 * 
 * Retorna { supabase, user, barber } ou { error: "AUTH_EXPIRED" | "FORBIDDEN" }.
 */
export async function requireBarber(permissionKey = null) {
  // 1. Tenta obter a sessão autenticada pelo cookie direto da barbearia
  const session = await getBarberSessionFromCookie();

  const admin = createAdminClient();
  let barber = null;

  if (session?.barberId) {
    const { data, error } = await admin
      .from("barbers")
      .select(BARBER_COLUMNS)
      .eq("id", session.barberId)
      .maybeSingle();

    if (!error && data && data.active !== false) {
      barber = data;
    }
  }

  // 2. Fallback de compatibilidade caso ainda exista sessão ativa do Supabase
  if (!barber) {
    try {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: allBarbers } = await admin.from("barbers").select(BARBER_COLUMNS);
        const emailDigits = (user.email || "").split("@")[0].replace(/\D/g, "");

        barber = allBarbers?.find((b) => {
          const bDigits = (b.phone || "").replace(/\D/g, "");
          return (
            b.id === user.app_metadata?.barber_id ||
            b.auth_user_id === user.id ||
            (emailDigits && bDigits.endsWith(emailDigits))
          );
        }) || null;
      }
    } catch {}
  }

  // Se nenhum barbeiro ativo for encontrado => Sessão expirada
  if (!barber || barber.active === false) {
    return { error: "AUTH_EXPIRED" };
  }

  const formattedBarber = {
    ...barber,
    permissions: { ...DEFAULT_PERMISSIONS, ...(barber.permissions || {}) },
  };

  if (permissionKey && !hasPermission(formattedBarber, permissionKey)) {
    return { error: "FORBIDDEN" };
  }

  // Retorna o cliente admin como supabase para que todas as ações seguintes
  // executem sem bloqueios de RLS ou tokens desatualizados.
  return {
    supabase: admin,
    user: { id: barber.id, name: barber.name, phone: barber.phone },
    barber: formattedBarber,
  };
}

export async function requireChefe() {
  const ctx = await requireBarber();
  if (ctx.error) return ctx;
  if (!isChefe(ctx.barber)) return { error: "FORBIDDEN" };
  return ctx;
}
