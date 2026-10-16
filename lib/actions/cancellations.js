"use server";

import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";

/**
 * Consulta a lista de agendamentos cancelados para auditoria, histórico e reativação.
 */
export async function listCancelledAppointments({ scopeBarberId = null } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
    const effectiveBarberId = canAll ? scopeBarberId : ctx.barber.id;

    let query = ctx.supabase
      .from("appointments")
      .select(`
        id, client_name, client_phone, appointment_date, appointment_time, price,
        service, cancelled_at, cancelled_by, cancellation_reason, notes,
        barbers ( id, name )
      `)
      .eq("status", "cancelado")
      .order("appointment_date", { ascending: false });

    if (effectiveBarberId) {
      query = query.eq("barber_id", effectiveBarberId);
    }

    const { data, error } = await query;
    if (error) {
      return { error: `Erro ao buscar cancelamentos: ${error.message}` };
    }

    return { data: data || [] };
  } catch (err) {
    return { error: `Erro inesperado: ${err.message}` };
  }
}
