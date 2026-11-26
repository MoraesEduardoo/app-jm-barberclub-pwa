"use server";

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";

/**
 * Consulta a lista de clientes com filtros otimizados diretamente no banco de dados,
 * evitando carregamento integral sem limites em memória e respeitando paginação/limites adequados.
 * Usa createAdminClient() como garantia de leitura para respeitar a sessão do painel.
 */
export async function listClients({
  search = "",
  filter = "todos",
  scopeBarberId = null,
  page = 1,
  limit = 50,
} = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const admin = createAdminClient();
    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
    const effectiveBarberId = canAll ? scopeBarberId : ctx.barber.id;

    const trimmedSearch = String(search || "").trim();
    const cleanSearchDigits = trimmedSearch.replace(/\D/g, "");
    const sanitizedSearchName = trimmedSearch.replace(/[%_,()]/g, " ").trim();

    // 1. Consulta direcionada na tabela `public.clients` com filtro SQL sempre que houver busca
    let clientsQuery = admin
      .from("clients")
      .select("id, name, phone, clean_phone, email, notes, last_appointment_at, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (cleanSearchDigits.length >= 2 && sanitizedSearchName) {
      clientsQuery = clientsQuery.or(`name.ilike.%${sanitizedSearchName}%,phone.ilike.%${cleanSearchDigits}%,clean_phone.ilike.%${cleanSearchDigits}%`);
    } else if (cleanSearchDigits.length >= 2) {
      clientsQuery = clientsQuery.or(`phone.ilike.%${cleanSearchDigits}%,clean_phone.ilike.%${cleanSearchDigits}%`);
    } else if (sanitizedSearchName) {
      clientsQuery = clientsQuery.ilike("name", `%${sanitizedSearchName}%`);
    }

    // Limite de segurança na tabela de clientes
    const maxClientRows = trimmedSearch ? 200 : 500;
    clientsQuery = clientsQuery.limit(maxClientRows);

    const { data: tableClients, error: clientsErr } = await clientsQuery;
    if (clientsErr) {
      console.warn("[listClients] Aviso ao ler public.clients:", clientsErr.message);
    }

    // 2. Consulta de agendamentos: filtra por barbeiro e/ou termos de busca no próprio SQL
    let appQuery = admin
      .from("appointments")
      .select(`
        id, client_id, client_name, client_phone, clean_phone, appointment_date, appointment_time, price, status,
        service, payment_status, barber_id,
        barbers ( id, name )
      `)
      .order("appointment_date", { ascending: false });

    if (effectiveBarberId) {
      appQuery = appQuery.eq("barber_id", effectiveBarberId);
    }

    if (cleanSearchDigits.length >= 2 && sanitizedSearchName) {
      appQuery = appQuery.or(`client_name.ilike.%${sanitizedSearchName}%,client_phone.ilike.%${cleanSearchDigits}%,clean_phone.ilike.%${cleanSearchDigits}%`);
    } else if (cleanSearchDigits.length >= 2) {
      appQuery = appQuery.or(`client_phone.ilike.%${cleanSearchDigits}%,clean_phone.ilike.%${cleanSearchDigits}%`);
    } else if (sanitizedSearchName) {
      appQuery = appQuery.ilike("client_name", `%${sanitizedSearchName}%`);
    }

    // Limita o histórico recente no banco (suficiente para consolidar métricas recentes sem estourar memória)
    const maxAppRows = trimmedSearch ? 500 : 1500;
    appQuery = appQuery.limit(maxAppRows);

    const { data: rawAppointments, error: appErr } = await appQuery;
    if (appErr && clientsErr) {
      return { error: `Erro ao buscar clientes: ${appErr.message}` };
    }

    const clientsMap = new Map();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Índices de public.clients
    const directoryByPhone = new Map();
    const directoryById = new Map();
    for (const row of tableClients || []) {
      const cp = (row.clean_phone || row.phone || "").replace(/\D/g, "");
      if (cp && cp !== "00000000000") directoryByPhone.set(cp, row);
      if (row.id) directoryById.set(String(row.id), row);
    }

    // Se não estiver restrito a um barbeiro específico, pré-popula a partir de public.clients
    if (!effectiveBarberId) {
      for (const row of tableClients || []) {
        const cleanPhone = (row.clean_phone || row.phone || "").replace(/\D/g, "");
        if (cleanPhone === "00000000000") continue;
        const key = cleanPhone || `id:${row.id}`;
        if (!clientsMap.has(key)) {
          clientsMap.set(key, {
            id: row.id,
            phone: cleanPhone || row.phone || "",
            cleanPhone,
            name: row.name || "Cliente",
            email: row.email || null,
            notes: row.notes || null,
            totalAppointments: 0,
            completedAppointments: 0,
            totalSpent: 0,
            lastAppointmentDate: row.last_appointment_at || null,
            lastService: "Sem cortes registrados",
            lastBarberName: "—",
            createdAt: row.created_at,
            history: [],
          });
        }
      }
    }

    // Processa os agendamentos filtrados
    for (const app of rawAppointments || []) {
      const rawCleanPhone = (app.clean_phone || app.client_phone || "").replace(/\D/g, "");
      const validPhone = rawCleanPhone && rawCleanPhone !== "00000000000" ? rawCleanPhone : "";
      const dirById = app.client_id ? directoryById.get(String(app.client_id)) : null;
      const dirCleanPhone = dirById ? (dirById.clean_phone || dirById.phone || "").replace(/\D/g, "") : "";
      const cleanPhone = validPhone || (dirCleanPhone !== "00000000000" ? dirCleanPhone : "");

      const trimmedName = String(app.client_name || "").trim();
      const hasNamedWalkIn =
        trimmedName &&
        trimmedName.toLowerCase() !== "cliente" &&
        trimmedName.toLowerCase() !== "cliente avulso";

      const key =
        cleanPhone ||
        (app.client_id ? `id:${app.client_id}` : null) ||
        (hasNamedWalkIn ? `name:${trimmedName.toLowerCase()}` : null);

      if (!key) continue;

      const dirEntry = (cleanPhone ? directoryByPhone.get(cleanPhone) : null) || dirById || null;

      if (!clientsMap.has(key)) {
        clientsMap.set(key, {
          id: dirEntry?.id || app.client_id || app.id,
          phone: cleanPhone || dirEntry?.phone || (validPhone ? app.client_phone : ""),
          cleanPhone,
          name: dirEntry?.name || trimmedName || "Cliente",
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
      if (
        dirEntry?.name &&
        (client.name === "Cliente" || client.name === "Cliente avulso")
      ) {
        client.name = dirEntry.name;
      } else if (
        hasNamedWalkIn &&
        (client.name === "Cliente" || client.name === "Cliente avulso")
      ) {
        client.name = trimmedName;
      }

      if (!client.lastAppointmentDate || new Date(app.appointment_date) > new Date(client.lastAppointmentDate)) {
        client.lastAppointmentDate = app.appointment_date;
        client.lastService = app.service || "Corte";
        client.lastBarberName = app.barbers?.name || "Equipe";
      }

      client.totalAppointments += 1;

      // Mantém no histórico em memória apenas os 10 mais recentes por cliente (evita inchaço de payload)
      if (client.history.length < 10) {
        client.history.push({
          id: app.id,
          date: app.appointment_date,
          time: app.appointment_time,
          service: app.service,
          price: Number(app.price || 0),
          status: app.status,
          barberName: app.barbers?.name || "Equipe",
        });
      }

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

    if (trimmedSearch) {
      const q = trimmedSearch.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.cleanPhone || "").includes(q) ||
          (c.phone && c.phone.includes(q))
      );
    }

    const totalCount = clientList.length;
    const fielCount = clientList.filter((c) => c.status === "fiel" || c.completedAppointments >= 3).length;
    const atrasadoCount = clientList.filter((c) => c.status === "atrasado").length;
    const novoCount = clientList.filter((c) => c.status === "novo" || c.totalAppointments <= 1).length;

    if (filter === "fiel") {
      filtered = filtered.filter((c) => c.status === "fiel" || c.completedAppointments >= 3);
    } else if (filter === "atrasado") {
      filtered = filtered.filter((c) => c.status === "atrasado");
    } else if (filter === "novo") {
      filtered = filtered.filter((c) => c.status === "novo" || c.totalAppointments <= 1);
    }

    // Suporte a paginação segura (se solicitada ou padrão por página)
    const pageNum = Math.max(1, Number(page) || 1);
    const pageSize = Math.max(1, Math.min(Number(limit) || 50, 100));
    const paginatedData = limit ? filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize) : filtered;

    return {
      data: paginatedData,
      totalCount,
      fielCount,
      atrasadoCount,
      novoCount,
      page: pageNum,
      pageSize,
      totalPages: Math.ceil(filtered.length / pageSize) || 1,
    };
  } catch (err) {
    return { error: `Erro inesperado ao listar clientes: ${err.message}` };
  }
}

/**
 * Exclui um cliente da base de dados (`public.clients`) de forma segura,
 * desvinculando chaves estrangeiras em `public.appointments` e `public.chat_sessions`
 * para preservar o histórico financeiro do caixa sem recriar o cliente na listagem.
 */
export async function deleteClient({ id, phone } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const cleanPhone = (phone || "").replace(/\D/g, "");
    if (!id && !cleanPhone) {
      return { error: "Identificador do cliente inválido." };
    }

    const admin = createAdminClient();

    // 1. Localiza possíveis registos na tabela `public.clients` por ID ou telefone
    const matchedClientIds = new Set();
    if (id) matchedClientIds.add(id);

    if (cleanPhone) {
      const { data: byPhoneRows } = await admin
        .from("clients")
        .select("id, phone");

      for (const row of byPhoneRows || []) {
        const rowClean = (row.phone || "").replace(/\D/g, "");
        if (rowClean && rowClean === cleanPhone) {
          matchedClientIds.add(row.id);
        }
      }
    }

    const clientIdList = Array.from(matchedClientIds);

    // 2. Desvincula referências de chave estrangeira em `chat_sessions` e `appointments`
    if (clientIdList.length > 0) {
      await admin
        .from("chat_sessions")
        .update({ client_id: null })
        .in("client_id", clientIdList);

      await admin
        .from("appointments")
        .update({ client_id: null, client_phone: "00000000000" })
        .in("client_id", clientIdList);
    }

    // 3. Caso existam agendamentos vinculados apenas pelo número de telefone,
    // anonimiza o telefone para "00000000000" mantendo os valores financeiros do caixa intactos
    if (cleanPhone) {
      const { data: appRows } = await admin
        .from("appointments")
        .select("id, client_phone")
        .neq("client_phone", "00000000000");

      const matchingAppIds = (appRows || [])
        .filter((a) => (a.client_phone || "").replace(/\D/g, "") === cleanPhone)
        .map((a) => a.id);

      if (matchingAppIds.length > 0) {
        await admin
          .from("appointments")
          .update({ client_id: null, client_phone: "00000000000" })
          .in("id", matchingAppIds);
      }
    }

    // 4. Remove o registo oficial da tabela `public.clients`
    if (clientIdList.length > 0) {
      const { error: delErr } = await admin
        .from("clients")
        .delete()
        .in("id", clientIdList);

      if (delErr) {
        return { error: `Não foi possível excluir o cliente: ${delErr.message}` };
      }
    }

    revalidatePath("/admin/clientes");
    revalidatePath("/admin/agenda");

    return { data: { deleted: true } };
  } catch (err) {
    return { error: `Erro ao excluir cliente: ${err.message}` };
  }
}

/**
 * Consulta rápida e leve de clientes existentes na tabela `public.clients`
 * para uso em autocomplete / busca rápida no modal de agendamento manual (WalkInSheet),
 * sem carregar o histórico completo de agendamentos.
 *
 * @param {{ query: string }} params
 * @returns {Promise<{ data: Array<{ id: string, name: string, phone: string }>, error?: string }>}
 */
export async function searchClientsQuick({ query = "" } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED", data: [] };

    const trimmed = String(query || "").trim();
    if (!trimmed || trimmed.length < 2) {
      return { data: [] };
    }

    const admin = createAdminClient();
    const cleanDigits = trimmed.replace(/\D/g, "");
    // Remove caracteres especiais de filtro do PostgREST para evitar erro de sintaxe na query
    const sanitizedName = trimmed.replace(/[%_,()]/g, " ").trim();

    let queryBuilder = admin
      .from("clients")
      .select("id, name, phone")
      .order("name", { ascending: true })
      .limit(8);

    if (cleanDigits.length >= 2 && sanitizedName) {
      queryBuilder = queryBuilder.or(`name.ilike.%${sanitizedName}%,phone.ilike.%${cleanDigits}%`);
    } else if (cleanDigits.length >= 2) {
      queryBuilder = queryBuilder.ilike("phone", `%${cleanDigits}%`);
    } else if (sanitizedName) {
      queryBuilder = queryBuilder.ilike("name", `%${sanitizedName}%`);
    } else {
      return { data: [] };
    }

    const { data, error } = await queryBuilder;

    if (error) {
      console.warn("[searchClientsQuick] Erro ao buscar clientes:", error.message);
      return { data: [] };
    }

    return { data: data || [] };
  } catch (err) {
    console.error("[searchClientsQuick] Exceção na busca rápida:", err);
    return { data: [] };
  }
}

