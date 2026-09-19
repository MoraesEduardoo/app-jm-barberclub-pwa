'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server';
// ... resto do código

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { notifyNewAppointment } from '@/lib/push';

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

/**
 * Registra um atendimento de cliente que chegou sem hora marcada (walk-in).
 * Blindado com verificação de sessão de usuário autenticado.
 */
export async function createWalkInAppointment({
  barber_id,
  service_id,
  client_name,
  client_phone,
  date,
  time,
}) {
  const supabase = getSupabaseServerClient();

  // 1. Guard de Segurança: Validar se há um usuário autenticado na sessão do servidor
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Acesso negado: Sessão de usuário inválida ou expirada.');
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

  if (error) throw new Error(`Não foi possível registrar o walk-in: ${error.message}`);

  // Push é efeito colateral: se o envio falhar, o agendamento continua salvo
  try {
    await notifyNewAppointment(created.id);
  } catch (pushError) {
    console.error('[appointments] Agendamento salvo, mas o push falhou:', pushError);
  }

  revalidatePath('/admin/agenda');
}

/**
 * Atualiza o status do agendamento com validação estrita de sessão.
 */
export async function updateAppointmentStatus(id, status) {
  const supabase = getSupabaseServerClient();

  // 1. Guard de Segurança: Validar se há um usuário autenticado na sessão do servidor
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Acesso negado: Sessão de usuário inválida ou expirada.');
  }

  const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o status do agendamento: ${error.message}`);
  
  revalidatePath('/admin/agenda');
}

/**
 * Registra o pagamento de forma 100% atômica e blindada via transação RPC do Supabase.
 * Valida a sessão do servidor e garante a integridade entre o agendamento e o fluxo de caixa.
 */
export async function registerPayment(id, { barber_id, payment_method, amount, description }) {
  const supabase = getSupabaseServerClient();

  // 1. Guard de Segurança: Validar se há um usuário autenticado na sessão do servidor
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Acesso negado: Sessão de usuário inválida ou expirada.');
  }

  // 2. Validação rigorosa de inputs financeiros
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Valor de pagamento inválido.');
  }

  // 3. Execução Atômica via Procedure do Banco de Dados (RPC)
  const { error: rpcError } = await supabase.rpc('register_payment_atomic', {
    p_appointment_id: id,
    p_barber_id: barber_id,
    p_payment_method: payment_method,
    p_amount: parsedAmount,
    p_description: description?.trim() || null,
  });

  if (rpcError) {
    throw new Error(`Erro crítico na transação atômica de pagamento: ${rpcError.message}`);
  }

  revalidatePath('/admin/agenda');
  revalidatePath('/admin/financeiro');
}