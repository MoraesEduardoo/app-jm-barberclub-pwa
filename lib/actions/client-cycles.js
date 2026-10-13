"use server";

import { requireBarber } from "@/lib/auth-server";
import { todayInShop } from "@/lib/dates";

/**
 * Análise de Recorrência e Ciclo de Retorno dos Clientes.
 * 
 * Percorre os agendamentos anteriores (concluídos/confirmados/pagos), agrupa por telefone do cliente
 * e calcula:
 * - Total de visitas históricas
 * - Intervalo médio (em dias) entre os cortes de cada cliente
 * - Dias transcorridos desde o último corte
 * - Status do ciclo:
 *     - "em_dia": dentro do ciclo habitual
 *     - "atrasado": ultrapassou a média em mais de 7 dias (alvo prioritário de lembrete/reativação)
 *     - "recente": cortou há menos de 7 dias
 *     - "novo": apenas 1 visita registrada
 * 
 * @param {Object} options
 * @param {string|null} options.scopeBarberId - Filtra por barbeiro específico ou toda a barbearia
 * @returns {Promise<{ data?: Array, error?: string }>}
 */
export async function getClientReturnCycles({ scopeBarberId = null } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    // Busca histórico de agendamentos não cancelados
    let query = ctx.supabase
      .from("appointments")
      .select("id, client_name, client_phone, appointment_date, status, barbers ( id, name ), services ( id, name, price )")
      .neq("status", "cancelado")
      .order("appointment_date", { ascending: true });

    if (scopeBarberId) {
      query = query.eq("barber_id", scopeBarberId);
    }

    const { data: appointments, error } = await query;
    if (error) throw error;

    if (!appointments || appointments.length === 0) {
      return { data: [] };
    }

    const todayStr = todayInShop();
    const todayMs = new Date(`${todayStr}T12:00:00Z`).getTime();

    // Agrupa visitas por telefone normalizado
    const clientsMap = new Map();

    for (const app of appointments) {
      const phone = (app.client_phone || "").replace(/\D/g, "");
      if (!phone || phone.length < 10) continue;

      const dateObj = new Date(app.appointment_date);
      if (isNaN(dateObj.getTime())) continue;

      if (!clientsMap.has(phone)) {
        clientsMap.set(phone, {
          client_phone: phone,
          client_name: app.client_name || "Cliente",
          last_barber: app.barbers?.name || "Barbeiro",
          last_service: app.services?.name || "Corte",
          visits: [],
        });
      }

      const clientRecord = clientsMap.get(phone);
      // Mantém o nome mais recente caso tenha mudado
      if (app.client_name) clientRecord.client_name = app.client_name;
      if (app.barbers?.name) clientRecord.last_barber = app.barbers.name;
      if (app.services?.name) clientRecord.last_service = app.services.name;

      clientRecord.visits.push(dateObj.getTime());
    }

    const results = [];

    for (const client of clientsMap.values()) {
      const { visits } = client;
      visits.sort((a, b) => a - b);

      const totalVisits = visits.length;
      const lastVisitMs = visits[visits.length - 1];
      const daysSinceLast = Math.max(0, Math.floor((todayMs - lastVisitMs) / (1000 * 60 * 60 * 24)));

      let averageCycleDays = null;

      if (totalVisits >= 2) {
        // Calcula a média das diferenças entre visitas consecutivas
        let totalIntervalDays = 0;
        for (let i = 1; i < visits.length; i++) {
          const diffDays = Math.max(1, Math.round((visits[i] - visits[i - 1]) / (1000 * 60 * 60 * 24)));
          totalIntervalDays += diffDays;
        }
        averageCycleDays = Math.round(totalIntervalDays / (visits.length - 1));
      }

      // Ciclo padrão sugerido se for cliente novo: 21 dias (3 semanas)
      const expectedCycle = averageCycleDays || 21;
      const daysOverdue = daysSinceLast - expectedCycle;

      let status = "em_dia";
      if (daysSinceLast < 7) {
        status = "recente";
      } else if (daysOverdue > 7) {
        status = "atrasado"; // Passou mais de uma semana da média habitual
      } else if (totalVisits === 1) {
        status = "novo";
      }

      results.push({
        client_name: client.client_name,
        client_phone: client.client_phone,
        total_visits: totalVisits,
        last_visit_date: new Date(lastVisitMs).toISOString().slice(0, 10),
        days_since_last: daysSinceLast,
        average_cycle_days: averageCycleDays,
        expected_cycle_days: expectedCycle,
        days_overdue: daysOverdue,
        status, // "atrasado" | "em_dia" | "recente" | "novo"
        last_barber: client.last_barber,
        last_service: client.last_service,
      });
    }

    // Ordena: primeiro os clientes com maior urgência de reativação (atrasados há mais tempo)
    results.sort((a, b) => {
      if (a.status === "atrasado" && b.status !== "atrasado") return -1;
      if (b.status === "atrasado" && a.status !== "atrasado") return 1;
      return b.days_overdue - a.days_overdue;
    });

    return { data: results };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[getClientReturnCycles]", error?.message || error);
    }
    return { error: "Não foi possível carregar os ciclos de clientes." };
  }
}
