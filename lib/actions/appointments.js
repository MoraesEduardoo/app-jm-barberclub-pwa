"use server"

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";
import { notifyNewAppointment, notifyCancelledAppointment } from "@/lib/push";
import { executeAppointmentCancellation } from "@/lib/cancellation";
import { shopRange, SHOP_UTC_OFFSET, todayInShop } from "@/lib/dates";
import { galleryPublicUrl } from "@/lib/gallery-url";

function dayRange(date) {
  return shopRange(date, date);
}

/**
 * Consulta os horários livres de 10 em 10 minutos diretamente pela função RPC canônica
 * `chatbot_get_available_slots(p_barber_id, p_date, p_service_id)` no Supabase.
 */
export async function getAvailableSlotsForBarber({ barberId, date, serviceId = null }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { slots: [] };

    const { data, error } = await ctx.supabase.rpc("chatbot_get_available_slots", {
      p_barber_id: barberId,
      p_date: date || todayInShop(),
      p_service_id: serviceId || null,
    });

    if (error || !Array.isArray(data)) {
      return { slots: [] };
    }

    return {
      slots: data.map((row) => String(row.slot_time || row).slice(0, 5)).filter(Boolean),
    };
  } catch {
    return { slots: [] };
  }
}

// Barbeiro sem "ver toda a agenda" só mexe nos próprios atendimentos.
async function loadOwnedAppointment(ctx, id) {
  const { data, error } = await ctx.supabase
    .from("appointments")
    .select("id, barber_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { error: "Agendamento não encontrado." };

  const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
  if (!canAll && String(data.barber_id) !== String(ctx.barber.id)) {
    return { error: "Sem permissão para este agendamento." };
  }
  return { appointment: data };
}

// Foto de referência escolhida pelo cliente ao agendar. Best-effort e em consulta separada:
// se a migration 004 ainda não rodou (ou der qualquer erro), a agenda continua igual.
async function attachReferencePhotos(supabase, rows) {
  try {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return rows;

    const { data, error } = await supabase
      .from("appointments")
      .select("id, haircut_gallery ( id, title, image_path )")
      .in("id", ids)
      .not("reference_photo_id", "is", null);
    if (error || !data?.length) return rows;

    const byId = new Map(data.filter((r) => r.haircut_gallery).map((r) => [r.id, r.haircut_gallery]));
    return rows.map((r) => {
      const g = byId.get(r.id);
      return g
        ? { ...r, reference_photo: { id: g.id, title: g.title, image_url: galleryPublicUrl(g.image_path) } }
        : r;
    });
  } catch {
    return rows;
  }
}

// Tenta carregar flags de pré-agendamento sem quebrar se a coluna ainda não existir
async function attachPreScheduledFlags(supabase, rows) {
  try {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return rows;

    const { data, error } = await supabase
      .from("appointments")
      .select("id, is_pre_scheduled, pre_scheduled, origin, source")
      .in("id", ids);

    if (error || !data?.length) return rows;

    const byId = new Map(data.map((r) => [r.id, r]));
    return rows.map((r) => {
      const extra = byId.get(r.id);
      return extra ? { ...r, ...extra } : r;
    });
  } catch {
    return rows;
  }
}

export async function listAppointmentsByDate(date, scopeBarberId = null) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const { start, end } = dayRange(date);
    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

    // O servidor decide o escopo; o parâmetro do cliente não é confiável.
    const effectiveBarberId = canAll ? scopeBarberId : ctx.barber.id;

    let query = ctx.supabase
      .from("appointments")
      .select(`
        id, appointment_date, appointment_time, appointment_end_time, end_time, duration_minutes,
        status, payment_method, payment_status, is_walk_in, price, total_price, barber_commission_amount,
        client_name, client_phone, service, notes,
        services ( id, name, price, duration_minutes, default_duration_minutes ),
        barbers ( id, name, commission_percent, commission_rate )
      `)
      .or(`appointment_date.eq.${date},and(appointment_date.gte.${start},appointment_date.lt.${end})`)
      .order("appointment_time", { ascending: true })
      .order("appointment_date", { ascending: true });

    if (effectiveBarberId) query = query.eq("barber_id", effectiveBarberId);

    const { data, error } = await query;
    if (error) return { error: `Não foi possível carregar os agendamentos: ${error.message}` };

    const withPhotos = await attachReferencePhotos(ctx.supabase, data || []);
    return { data: await attachPreScheduledFlags(ctx.supabase, withPhotos) };
  } catch (error) {
    return { error: "Ocorreu um erro ao carregar os agendamentos" };
  }
}

export async function createWalkInAppointment({ barber_id, service_id, client_name, client_phone, date, time }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
    const targetBarberId = canAll ? barber_id : ctx.barber.id;

    // Preserva a data e a hora locais exatamente como escolhidas (sem desvio UTC)
    const dateOnly = date ? String(date).slice(0, 10) : todayInShop();
    const nowFortaleza = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Fortaleza" }));
    const nowHHMM = `${String(nowFortaleza.getHours()).padStart(2, "0")}:${String(nowFortaleza.getMinutes()).padStart(2, "0")}:00`;
    const formattedTime = time ? (String(time).length === 5 ? `${time}:00` : String(time)) : nowHHMM;

    // Obtém detalhes do serviço para persistir nome, duração e preço corretos
    let servicePrice = 0;
    let serviceTitle = null;
    let durationMin = 30;
    if (service_id) {
      const { data: svc } = await ctx.supabase
        .from("services")
        .select("name, price, duration_minutes, default_duration_minutes")
        .eq("id", service_id)
        .maybeSingle();
      if (svc) {
        servicePrice = Number(svc.price || 0);
        serviceTitle = svc.name;
        const dur = svc.duration_minutes ?? svc.default_duration_minutes;
        if (dur) {
          durationMin = Number(dur);
        }
      }
    }

    const cleanDigits = client_phone ? client_phone.replace(/\D/g, "") : "";

    // Se houver telefone válido (>= 8 dígitos) e horário agendado manual, tenta usar a RPC transacional atômica
    if (cleanDigits.length >= 8 && time) {
      try {
        const { data: rpcRes, error: rpcErr } = await ctx.supabase.rpc("chatbot_create_appointment", {
          p_client_name: client_name?.trim() || "Cliente avulso",
          p_client_phone: cleanDigits,
          p_barber_id: targetBarberId,
          p_service_id: service_id,
          p_service_ids: [service_id],
          p_date: dateOnly,
          p_time: formattedTime,
          p_duration_minutes: durationMin,
          p_buffer_minutes: 10,
          p_notes: "Registrado pelo Painel do Barbeiro",
        });

        if (!rpcErr && rpcRes?.success && rpcRes?.appointment_id) {
          await ctx.supabase
            .from("appointments")
            .update({ is_walk_in: true, service: serviceTitle, source: "painel" })
            .eq("id", rpcRes.appointment_id);

          try {
            await notifyNewAppointment(rpcRes.appointment_id);
          } catch {}

          revalidatePath("/admin/agenda");
          return { success: true };
        }
      } catch {}
    }

    const { data: created, error } = await ctx.supabase
      .from("appointments")
      .insert({
        barber_id: targetBarberId,
        service_id,
        service: serviceTitle,
        price: servicePrice,
        total_price: servicePrice,
        client_name: client_name?.trim() || "Cliente avulso",
        client_phone: cleanDigits || "00000000000",
        appointment_date: dateOnly,
        appointment_time: formattedTime,
        duration_minutes: durationMin,
        buffer_minutes: 10,
        status: "confirmado",
        payment_status: "pendente",
        is_walk_in: true,
        source: "painel",
        origin: "painel",
      })
      .select("id")
      .single();

    if (error) return { error: `Não foi possível registrar o walk-in: ${error.message}` };

    try {
      await notifyNewAppointment(created.id);
    } catch (pushError) {
      console.error("[appointments] Agendamento salvo, mas o push falhou:", pushError);
    }

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro ao registrar o agendamento" };
  }
}

export async function updateAppointmentStatus(id, status, { reason } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    // Se a alteração for para cancelado, aciona o fluxo completo de cancelamento e liberação
    if (status === "cancelado") {
      const cancelResult = await executeAppointmentCancellation({
        appointmentId: id,
        reason,
        cancelledBy: `barbeiro:${ctx.barber.id}`,
        supabaseClient: ctx.supabase,
      });

      if (cancelResult.error) {
        return { error: cancelResult.error };
      }

      return {
        success: true,
        freedSlot: true,
        notifications: cancelResult.notifications,
      };
    }

    const { error } = await ctx.supabase.from("appointments").update({ status }).eq("id", id);
    if (error) return { error: `Não foi possível atualizar o status: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro ao atualizar o status" };
  }
}

/**
 * Server Action dedicada e explícita para cancelamento de agendamento no painel.
 * Executa as 3 regras: atualiza status para 'cancelado', libera vaga e notifica barbeiro/equipe.
 */
export async function cancelAppointment(id, { reason = null } = {}) {
  return updateAppointmentStatus(id, "cancelado", { reason });
}

/**
 * Confirma o agendamento / pré-agendamento no banco de dados.
 */
export async function confirmAppointment(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const { error } = await ctx.supabase
      .from("appointments")
      .update({ status: "confirmado" })
      .eq("id", id);

    if (error) return { error: `Não foi possível confirmar: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch {
    return { error: "Ocorreu um erro ao confirmar o agendamento" };
  }
}

/**
 * Remarca um pré-agendamento ou agendamento para uma nova data e horário.
 */
export async function rescheduleAppointment({ id, newDate, newTime, newBarberId = null }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    if (!newDate || !newTime) {
      return { error: "Nova data e horário são obrigatórios." };
    }

    const payload = {
      appointment_date: newDate,
      appointment_time: newTime.length === 5 ? `${newTime}:00` : newTime,
      status: "confirmado",
    };

    if (newBarberId) {
      payload.barber_id = newBarberId;
    }

    const { error } = await ctx.supabase
      .from("appointments")
      .update(payload)
      .eq("id", id);

    if (error) return { error: `Não foi possível remarcar: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch {
    return { error: "Ocorreu um erro ao remarcar o agendamento" };
  }
}


/**
 * Remove definitivamente um agendamento do banco de dados (exclusão de registro).
 * Apenas barbeiros autorizados ou o dono do atendimento.
 */
export async function deleteAppointment(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const { error } = await ctx.supabase.from("appointments").delete().eq("id", id);
    if (error) return { error: `Não foi possível remover o agendamento: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro ao remover o agendamento" };
  }
}

export async function registerPayment(id, { payment_method, amount, description }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return { error: "Valor de pagamento inválido." };
    }

    const barberId = owned.appointment.barber_id;

    // 1. Tenta a função atômica RPC register_payment_atomic
    let rpcSucceeded = false;
    try {
      const { data: rpcData, error: rpcError } = await ctx.supabase.rpc("register_payment_atomic", {
        p_appointment_id: id,
        p_barber_id: barberId,
        p_payment_method: payment_method,
        p_amount: parsedAmount,
        p_description: description?.trim() || null,
      });

      if (!rpcError && rpcData?.success) {
        rpcSucceeded = true;
      }
    } catch {
      rpcSucceeded = false;
    }

    // 2. Fallback direto e seguro se a RPC não existir ainda no Supabase
    if (!rpcSucceeded) {
      // Busca a taxa de comissão do barbeiro (oficial 50%)
      const { data: bData } = await ctx.supabase
        .from("barbers")
        .select("commission_percent, commission_rate")
        .eq("id", barberId)
        .maybeSingle();

      const rawRate = Number(bData?.commission_percent ?? bData?.commission_rate ?? 50);
      const multiplier = rawRate > 0 && rawRate <= 1 ? rawRate : (rawRate > 0 ? rawRate / 100 : 0.50);
      const commissionAmount = Number((parsedAmount * multiplier).toFixed(2));

      const { error: updateError } = await ctx.supabase
        .from("appointments")
        .update({
          status: "concluido",
          payment_status: "pago",
          payment_method,
          price: parsedAmount,
          barber_commission_amount: commissionAmount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) {
        return { error: `Erro na liquidação do pagamento: ${updateError.message}` };
      }
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro crítico ao registrar o pagamento" };
  }
}
