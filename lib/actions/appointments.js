"use server"

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";
import { notifyNewAppointment } from "@/lib/push";
import { shopRange, SHOP_UTC_OFFSET } from "@/lib/dates";

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
        id, appointment_date, status, payment_method, payment_status, is_walk_in,
        client_name, client_phone,
        services ( id, name, price, default_duration_minutes ),
        barbers ( id, name )
      `)
      .gte("appointment_date", start)
      .lt("appointment_date", end)
      .order("appointment_date", { ascending: true });

    if (effectiveBarberId) query = query.eq("barber_id", effectiveBarberId);

    const { data, error } = await query;
    if (error) return { error: `Não foi possível carregar os agendamentos: ${error.message}` };

    return { data };
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

    // Hora escolhida é horário da barbearia (UTC-3), não o fuso do servidor.
    const appointmentDate = time ? new Date(`${date}T${time}:00${SHOP_UTC_OFFSET}`) : new Date();

    const { data: created, error } = await ctx.supabase
      .from("appointments")
      .insert({
        barber_id: targetBarberId,
        service_id,
        client_name: client_name?.trim() || "Cliente avulso",
        client_phone: client_phone?.replace(/\D/g, "") || null,
        appointment_date: appointmentDate.toISOString(),
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

export async function updateAppointmentStatus(id, status) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const { error } = await ctx.supabase.from("appointments").update({ status }).eq("id", id);
    if (error) return { error: `Não foi possível atualizar o status: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro ao atualizar o status" };
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

    const { error: rpcError } = await ctx.supabase.rpc("register_payment_atomic", {
      p_appointment_id: id,
      p_barber_id: owned.appointment.barber_id, // vem do banco, não do cliente
      p_payment_method: payment_method,
      p_amount: parsedAmount,
      p_description: description?.trim() || null,
    });

    if (rpcError) return { error: `Erro na transação de pagamento: ${rpcError.message}` };

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro crítico ao registrar o pagamento" };
  }
}
