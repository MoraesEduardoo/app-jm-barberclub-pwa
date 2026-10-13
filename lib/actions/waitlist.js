"use server";

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInShop } from "@/lib/dates";

const TABLE = "waitlist";

/**
 * Lista clientes na lista de espera.
 * Suporta filtro por data e barbeiro.
 */
export async function listWaitlist({ date = null, barberId = null, status = "aguardando" } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const admin = createAdminClient();
    let query = admin
      .from(TABLE)
      .select(`
        id,
        client_name,
        client_phone,
        desired_date,
        desired_time,
        notes,
        status,
        created_at,
        barber_id,
        service_id,
        barbers ( id, name ),
        services ( id, name, price, default_duration_minutes )
      `)
      .order("created_at", { ascending: true });

    if (date) query = query.eq("desired_date", date);
    if (barberId) query = query.eq("barber_id", barberId);
    if (status && status !== "todos") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      // Se a tabela ainda não existir no ambiente, devolve array vazio em vez de crashar
      if (error.code === "42P01") return { data: [] };
      throw error;
    }

    return { data: data || [] };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[listWaitlist]", err?.message || err);
    }
    return { data: [] };
  }
}

/**
 * Adiciona um cliente à lista de espera de um horário/data concorrida.
 */
export async function addToWaitlist({
  client_name,
  client_phone,
  desired_date,
  desired_time = null,
  barber_id = null,
  service_id = null,
  notes = null,
}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    if (!client_name || !client_name.trim()) {
      return { error: "Informe o nome do cliente." };
    }
    if (!client_phone || !client_phone.trim()) {
      return { error: "Informe o WhatsApp/telefone de contato." };
    }
    if (!desired_date) {
      return { error: "Informe a data de preferência." };
    }

    const admin = createAdminClient();
    const payload = {
      client_name: client_name.trim(),
      client_phone: client_phone.replace(/\D/g, ""),
      desired_date,
      desired_time: desired_time?.trim() || null,
      barber_id: barber_id || null,
      service_id: service_id || null,
      notes: notes?.trim() || null,
      status: "aguardando",
    };

    const { data, error } = await admin.from(TABLE).insert([payload]).select("id").single();
    if (error) throw error;

    revalidatePath("/admin/agenda");
    return { success: true, id: data.id };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[addToWaitlist]", err?.message || err);
    }
    return { error: "Não foi possível cadastrar na lista de espera." };
  }
}

/**
 * Atualiza o status de um item na lista de espera
 * (ex: 'notificado', 'atendido', 'cancelado', 'aguardando')
 */
export async function updateWaitlistStatus(id, status) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const admin = createAdminClient();
    const { error } = await admin
      .from(TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[updateWaitlistStatus]", err?.message || err);
    }
    return { error: "Erro ao atualizar status da lista de espera." };
  }
}

/**
 * Remove um registro da lista de espera.
 */
export async function deleteWaitlistEntry(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const admin = createAdminClient();
    const { error } = await admin.from(TABLE).delete().eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[deleteWaitlistEntry]", err?.message || err);
    }
    return { error: "Erro ao remover da lista de espera." };
  }
}

/**
 * Busca clientes na lista de espera elegíveis para assumir um horário que acabou de ser cancelado.
 */
export async function findWaitlistMatchesForCancelledAppointment(appointmentId) {
  try {
    const admin = createAdminClient();
    const { data: app, error: appErr } = await admin
      .from("appointments")
      .select("id, barber_id, appointment_date")
      .eq("id", appointmentId)
      .maybeSingle();

    if (appErr || !app) return [];

    const dateStr = new Date(app.appointment_date).toISOString().slice(0, 10);

    const { data: matches } = await admin
      .from(TABLE)
      .select("id, client_name, client_phone, desired_time, notes")
      .eq("status", "aguardando")
      .eq("desired_date", dateStr)
      .or(`barber_id.is.null,barber_id.eq.${app.barber_id}`);

    return matches || [];
  } catch {
    return [];
  }
}
