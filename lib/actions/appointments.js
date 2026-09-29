'use server'

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { notifyNewAppointment } from '@/lib/push';

function dayRange(date) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function listAppointmentsByDate(date, scopeBarberId = null) {
  try {
    const supabase = await createClient();

    // Validar autenticação
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'AUTH_EXPIRED' };
    }

    const { start, end } = dayRange(date);

    let query = supabase
      .from('appointments')
      .select(`
        id, appointment_date, status, payment_method, payment_status, is_walk_in,
        client_name, client_phone,
        services ( id, name, price, default_duration_minutes ),
        barbers ( id, name )
      `)
      .gte('appointment_date', start)
      .lt('appointment_date', end)
      .order('appointment_date', { ascending: true });

    if (scopeBarberId) {
      query = query.eq('barber_id', scopeBarberId);
    }

    const { data, error } = await query;
    if (error) return { error: `Não foi possível carregar os agendamentos: ${error.message}` };

    return { data };
  } catch (error) {
    return { error: 'Ocorreu um erro ao carregar os agendamentos' };
  }
}

export async function createWalkInAppointment({
  barber_id,
  service_id,
  client_name,
  client_phone,
  date,
  time,
}) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'AUTH_EXPIRED' };
    }

    const appointmentDate = time
      ? new Date(`${date}T${time}:00`)
      : new Date();

    const { data: created, error } = await supabase
      .from('appointments')
      .insert({
        barber_id,
        service_id,
        client_name: client_name?.trim() || 'Cliente avulso',
        client_phone: client_phone?.replace(/\D/g, '') || null,
        appointment_date: appointmentDate.toISOString(),
        status: 'confirmado',
        payment_status: 'pendente',
        is_walk_in: true,
      })
      .select('id')
      .single();

    if (error) return { error: `Não foi possível registrar o walk-in: ${error.message}` };

    try {
      await notifyNewAppointment(created.id);
    } catch (pushError) {
      console.error('[appointments] Agendamento salvo, mas o push falhou:', pushError);
    }

    revalidatePath('/admin/agenda');
    return { success: true };
  } catch (error) {
    return { error: 'Ocorreu um erro ao registrar o agendamento' };
  }
}

export async function updateAppointmentStatus(id, status) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'AUTH_EXPIRED' };
    }

    const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
    if (error) return { error: `Não foi possível atualizar o status: ${error.message}` };

    revalidatePath('/admin/agenda');
    return { success: true };
  } catch (error) {
    return { error: 'Ocorreu um erro ao atualizar o status' };
  }
}

export async function registerPayment(id, { barber_id, payment_method, amount, description }) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'AUTH_EXPIRED' };
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return { error: 'Valor de pagamento inválido.' };
    }

    const { error: rpcError } = await supabase.rpc('register_payment_atomic', {
      p_appointment_id: id,
      p_barber_id: barber_id,
      p_payment_method: payment_method,
      p_amount: parsedAmount,
      p_description: description?.trim() || null,
    });

    if (rpcError) {
      return { error: `Erro na transação de pagamento: ${rpcError.message}` };
    }

    revalidatePath('/admin/agenda');
    revalidatePath('/admin/financeiro');
    return { success: true };
  } catch (error) {
    return { error: 'Ocorreu um erro crítico ao registrar o pagamento' };
  }
}