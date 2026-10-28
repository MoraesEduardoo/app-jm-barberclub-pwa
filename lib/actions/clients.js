"use server";

import { requireBarber } from "@/lib/auth-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";

/**
 * Consulta a lista consolidada de clientes unificando os registos da tabela `public.clients`
 * com o histórico de agendamentos em `public.appointments`.
 * Usa createAdminClient() como garantia de leitura para respeitar a sessão do painel.
 */
export async function listClients({ search = "", filter = "todos", scopeBarberId = null } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const admin = createAdminClient();
    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
    const effectiveBarberId = canAll ? scopeBarberId : ctx.barber.id;

    // 1. Consulta todos os clientes da tabela oficial `public.clients`
    const { data: tableClients, error: clientsErr } = await admin
      .from("clients")
      .select("id, name, phone, email, notes, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (clientsErr) {
      console.warn("[listClients] Aviso ao ler public.clients:", clientsErr.message);
    }

    // 2. Consulta o histórico de agendamentos em `public.appointments`
    let appQuery = admin
      .from("appointments")
      .select(`
        id, client_id, client_name, client_phone, appointment_date, appointment_time, price, status,
        service, payment_status,
        barbers ( id, name )
      `)
      .order("appointment_date", { ascending: false });

    if (effectiveBarberId) {
      appQuery = appQuery.eq("barber_id", effectiveBarberId);
    }

    const { data: rawAppointments, error: appErr } = await appQuery;
    if (appErr && clientsErr) {
      return { error: `Erro ao buscar clientes: ${appErr.message}` };
    }

    const clientsMap = new Map();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Se não estiver filtrando por um barbeiro específico (ou se for visão geral),
    // pré-popula o mapa com todos os registos de `public.clients`
    if (!effectiveBarberId) {
      for (const row of tableClients || []) {
        const cleanPhone = (row.phone || "").replace(/\D/g, "");
        const key = cleanPhone || `id:${row.id}`;
        if (!clientsMap.has(key)) {
          clientsMap.set(key, {
            id: row.id,
            phone: row.phone || "",
            cleanPhone,
            name: row.name || "Cliente",
            email: row.email || null,
            notes: row.notes || null,
            totalAppointments: 0,
            completedAppointments: 0,
            totalSpent: 0,
            lastAppointmentDate: null,
            lastService: "Sem cortes registrados",
            lastBarberName: "—",
            createdAt: row.created_at,
            history: [],
          });
        }
      }
    }

    // Índice rápido de public.clients por telefone limpo para enriquecer nome/notas
    const directoryByPhone = new Map();
    for (const row of tableClients || []) {
      const cp = (row.phone || "").replace(/\D/g, "");
      if (cp) directoryByPhone.set(cp, row);
    }

    for (const app of rawAppointments || []) {
      const cleanPhone = (app.client_phone || "").replace(/\D/g, "");
      const key = cleanPhone || (app.client_id ? `id:${app.client_id}` : null);
      if (!key) continue;

      const dirEntry = cleanPhone ? directoryByPhone.get(cleanPhone) : null;

      if (!clientsMap.has(key)) {
        clientsMap.set(key, {
          id: dirEntry?.id || app.client_id || app.id,
          phone: dirEntry?.phone || app.client_phone || "",
          cleanPhone,
          name: dirEntry?.name || app.client_name || "Cliente",
          email: dirEntry?.email || null,
          notes: dirEntry?.notes || null,
          totalAppointments: 0,
          completedAppointments: 0,
          totalSpent: 0,
          lastAppointmentDate: app.appointment_date,
          lastService: app.service || "Corte",
          lastBarberName: app.barbers?.name || "Equipe",
          createdAt: dirEntry?.created_at || null,
          history: [],
        });
      }

      const client = clientsMap.get(key);
      if (!client.lastAppointmentDate && app.appointment_date) {
        client.lastAppointmentDate = app.appointment_date;
        client.lastService = app.service || "Corte";
        client.lastBarberName = app.barbers?.name || "Equipe";
      }

      client.totalAppointments += 1;

      client.history.push({
        id: app.id,
        date: app.appointment_date,
        time: app.appointment_time,
        service: app.service,
        price: Number(app.price || 0),
        status: app.status,
        barberName: app.barbers?.name || "Equipe",
      });

      if (
        app.status === "concluido" ||
        app.status === "concluído" ||
        app.status === "completed" ||
        app.payment_status === "pago"
      ) {
        client.completedAppointments += 1;
        client.totalSpent += Number(app.price || 0);
      }
    }

    const clientList = Array.from(clientsMap.values()).map((c) => {
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
      } else if (c.totalAppointments <= 1) {
        status = "novo";
      }

      return {
        ...c,
        daysSinceLast,
        status,
      };
    });

    clientList.sort((a, b) => {
      if (a.lastAppointmentDate && b.lastAppointmentDate) {
        return new Date(b.lastAppointmentDate) - new Date(a.lastAppointmentDate);
      }
      if (a.lastAppointmentDate) return -1;
      if (b.lastAppointmentDate) return 1;
      if (a.createdAt && b.createdAt) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      }
      return a.name.localeCompare(b.name, "pt-BR");
    });

    let filtered = clientList;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.cleanPhone || "").includes(q) ||
          (c.phone && c.phone.includes(q))
      );
    }

    if (filter === "fiel") {
      filtered = filtered.filter((c) => c.status === "fiel" || c.completedAppointments >= 3);
    } else if (filter === "atrasado") {
      filtered = filtered.filter((c) => c.status === "atrasado");
    } else if (filter === "novo") {
      filtered = filtered.filter((c) => c.status === "novo" || c.totalAppointments <= 1);
    }

    return {
      data: filtered,
      totalCount: clientList.length,
      fielCount: clientList.filter((c) => c.status === "fiel" || c.completedAppointments >= 3).length,
      atrasadoCount: clientList.filter((c) => c.status === "atrasado").length,
      novoCount: clientList.filter((c) => c.status === "novo" || c.totalAppointments <= 1).length,
    };
  } catch (err) {
    return { error: `Erro inesperado ao listar clientes: ${err.message}` };
  }
}
