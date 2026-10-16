"use server";

import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";

/**
 * Consulta a lista consolidada de clientes a partir do histórico de agendamentos.
 * Calcula número de visitas, data do último corte, serviços favoritos e status de retenção.
 */
export async function listClients({ search = "", filter = "todos", scopeBarberId = null } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
    const effectiveBarberId = canAll ? scopeBarberId : ctx.barber.id;

    let query = ctx.supabase
      .from("appointments")
      .select(`
        id, client_name, client_phone, appointment_date, appointment_time, price, status,
        service, payment_status,
        barbers ( id, name )
      `)
      .not("client_phone", "is", null)
      .order("appointment_date", { ascending: false });

    if (effectiveBarberId) {
      query = query.eq("barber_id", effectiveBarberId);
    }

    const { data: rawAppointments, error } = await query;
    if (error) {
      return { error: `Erro ao buscar clientes: ${error.message}` };
    }

    // Agrupamento por telefone normalizado
    const clientsMap = new Map();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const app of rawAppointments || []) {
      const cleanPhone = (app.client_phone || "").replace(/\D/g, "");
      if (!cleanPhone) continue;

      if (!clientsMap.has(cleanPhone)) {
        clientsMap.set(cleanPhone, {
          phone: app.client_phone,
          cleanPhone,
          name: app.client_name || "Cliente",
          totalAppointments: 0,
          completedAppointments: 0,
          totalSpent: 0,
          lastAppointmentDate: app.appointment_date,
          lastService: app.service || "Corte",
          lastBarberName: app.barbers?.name || "Equipe",
          history: [],
        });
      }

      const client = clientsMap.get(cleanPhone);
      client.totalAppointments += 1;

      // Adiciona ao histórico do cliente
      client.history.push({
        id: app.id,
        date: app.appointment_date,
        time: app.appointment_time,
        service: app.service,
        price: Number(app.price || 0),
        status: app.status,
        barberName: app.barbers?.name || "Equipe",
      });

      if (app.status === "concluido" || app.payment_status === "pago") {
        client.completedAppointments += 1;
        client.totalSpent += Number(app.price || 0);
      }
    }

    const clientList = Array.from(clientsMap.values()).map((c) => {
      // Ordena histórico mais recente primeiro
      c.history.sort((a, b) => new Date(b.date) - new Date(a.date));

      const lastDate = c.lastAppointmentDate ? new Date(c.lastAppointmentDate) : null;
      let daysSinceLast = null;
      if (lastDate && !isNaN(lastDate.getTime())) {
        const diffTime = today.getTime() - lastDate.getTime();
        daysSinceLast = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
      }

      let status = "em_dia";
      if (daysSinceLast !== null && daysSinceLast > 30) {
        status = "atrasado";
      } else if (c.completedAppointments >= 3) {
        status = "fiel";
      } else if (c.totalAppointments === 1) {
        status = "novo";
      }

      return {
        ...c,
        daysSinceLast,
        status,
      };
    });

    // Ordenação padrão: mais recentes e fiéis primeiro
    clientList.sort((a, b) => {
      if (a.lastAppointmentDate && b.lastAppointmentDate) {
        return new Date(b.lastAppointmentDate) - new Date(a.lastAppointmentDate);
      }
      return b.totalAppointments - a.totalAppointments;
    });

    // Filtros de busca e status
    let filtered = clientList;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.cleanPhone.includes(q) ||
          (c.phone && c.phone.includes(q))
      );
    }

    if (filter === "fiel") {
      filtered = filtered.filter((c) => c.status === "fiel" || c.completedAppointments >= 3);
    } else if (filter === "atrasado") {
      filtered = filtered.filter((c) => c.status === "atrasado");
    } else if (filter === "novo") {
      filtered = filtered.filter((c) => c.status === "novo" || c.totalAppointments === 1);
    }

    return {
      data: filtered,
      totalCount: clientList.length,
      fielCount: clientList.filter((c) => c.status === "fiel" || c.completedAppointments >= 3).length,
      atrasadoCount: clientList.filter((c) => c.status === "atrasado").length,
      novoCount: clientList.filter((c) => c.status === "novo" || c.totalAppointments === 1).length,
    };
  } catch (err) {
    return { error: `Erro inesperado ao listar clientes: ${err.message}` };
  }
}
