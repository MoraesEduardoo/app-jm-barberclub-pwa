'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';

function dayRange(date) {
  // "date" é uma string YYYY-MM-DD; monta o intervalo [00:00, 24:00) do dia
  // pra filtrar a coluna appointment_date (timestamptz).
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Lista agendamentos de uma data específica.
 * Se scopeBarberId for informado, filtra só os desse barbeiro (usado quando
 * o barbeiro logado não tem permissão de ver a agenda de todo mundo).
 */
export async function listAppointmentsByDate(date, scopeBarberId = null) {
  const supabase = getSupabaseServerClient();
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
  if (error) throw new Error(`Não foi possível carregar os agendamentos: ${error.message}`);
  return data;
}

export async function updateAppointmentStatus(id, status) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o status do agendamento: ${error.message}`);
  revalidatePath('/admin/agenda');
}

/**
 * Marca o agendamento como pago e registra a entrada no caixa (cash_flow).
 * "amount" é o valor efetivamente cobrado (pode divergir do preço de tabela
 * em caso de desconto), então fica guardado no cash_flow como o valor real.
 */
export async function registerPayment(id, { barber_id, payment_method, amount, description }) {
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from('appointments')
    .update({ payment_method, payment_status: 'pago' })
    .eq('id', id);

  if (error) throw new Error(`Não foi possível registrar o pagamento: ${error.message}`);

  const { error: cashError } = await supabase.from('cash_flow').insert({
    barber_id,
    appointment_id: id,
    type: 'income',
    amount,
    payment_method,
    description: description || null,
  });

  if (cashError) throw new Error(`Pagamento salvo, mas houve erro ao lançar no caixa: ${cashError.message}`);

  revalidatePath('/admin/agenda');
  revalidatePath('/admin/financeiro');
}