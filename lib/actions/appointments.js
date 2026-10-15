"use server"

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";
import { notifyNewAppointment, notifyCancelledAppointment } from "@/lib/push";
import { executeAppointmentCancellation } from "@/lib/cancellation";
import { shopRange, SHOP_UTC_OFFSET } from "@/lib/dates";
import { galleryPublicUrl } from "@/lib/gallery-url";

function dayRange(date) {
  return shopRange(date, date);
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
        services ( id, name, price, default_duration_minutes ),
        barbers ( id, name, commission_percent, commission_rate )
      `)
      .or(`appointment_date.eq.${date},and(appointment_date.gte.${start},appointment_date.lt.${end})`)
      .order("appointment_time", { ascending: true })
      .order("appointment_date", { ascending: true });

    if (effectiveBarberId) query = query.eq("barber_id", effectiveBarberId);

    const { data, error } = await query;
    if (error) return { error: `Não foi possível carregar os agendamentos: ${error.message}` };

    return { data: await attachReferencePhotos(ctx.supabase, data) };
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
    const formattedTime = time ? (String(time).length === 5 ? `${time}:00` : String(time)) : "09:00:00";

    // Obtém detalhes do serviço para persistir nome e preço corretos
    let servicePrice = 0;
    let serviceTitle = null;
    let durationMin = 30;
    if (service_id) {
      const { data: svc } = await ctx.supabase
        .from("services")
        .select("name, price, default_duration_minutes")
        .eq("id", service_id)
        .maybeSingle();
      if (svc) {
        servicePrice = Number(svc.price || 0);
        serviceTitle = svc.name;
        if (svc.default_duration_minutes) {
          durationMin = Number(svc.default_duration_minutes);
        }
      }
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
        client_phone: client_phone?.replace(/\D/g, "") || null,
        appointment_date: dateOnly,
        appointment_time: formattedTime,
        duration_minutes: durationMin,
        status: "confirmado",
        payment_status: "pendente",
        is_walk_in: true,
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
        waitlistCount: cancelResult.waitlistCount,
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
