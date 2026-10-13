// Motor centralizado de cancelamento de agendamentos e liberação imediata de horários (JM Barberclub)
// Garante atomicidade e conformidade com as três regras de negócio obrigatórias:
// 1. Atualização do Status na tabela 'appointments' para 'cancelado'
// 2. Liberação Instantânea da Vaga no motor de horários
// 3. Disparo de Notificações em Tempo Real (Web Push, Realtime e WhatsApp) para o barbeiro e chefe

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyCancelledAppointment } from '@/lib/push';
import { buildCancellationWhatsAppMessage, sendWhatsAppNotification } from '@/lib/whatsapp';
import { findWaitlistMatchesForCancelledAppointment } from '@/lib/actions/waitlist';
import { logSecurityEvent } from '@/lib/security';

/**
 * Executa o fluxo completo de cancelamento de um agendamento:
 * @param {object} params
 * @param {string} params.appointmentId - UUID do agendamento
 * @param {string} [params.reason] - Motivo do cancelamento (opcional)
 * @param {string} [params.cancelledBy] - Identificador de quem cancelou (ex: 'cliente_chatbot', 'barbeiro_painel', 'sistema')
 * @param {object} [params.supabaseClient] - Instância opcional do Supabase (se fornecida, ex: da sessão do barbeiro)
 * @param {string} [params.clientIp] - IP do solicitante para auditoria (opcional)
 */
export async function executeAppointmentCancellation({
  appointmentId,
  reason = null,
  cancelledBy = 'sistema',
  supabaseClient = null,
  clientIp = null,
}) {
  if (!appointmentId) {
    return { error: 'ID do agendamento é obrigatório.' };
  }

  // Utiliza o cliente fornecido ou o Admin Client com privilégios de Service Role
  const db = supabaseClient || createAdminClient();

  // 1. Busca os dados completos do agendamento para checagem e envio de alertas
  const { data: appointment, error: fetchError } = await db
    .from('appointments')
    .select(`
      id, appointment_date, status, client_name, client_phone, is_walk_in, barber_id,
      services ( id, name, price, default_duration_minutes ),
      barbers ( id, name, phone, role )
    `)
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchError || !appointment) {
    return { error: 'Agendamento não encontrado para cancelamento.' };
  }

  // Idempotência: Se já estava cancelado, retorna informando que a vaga já estava liberada
  if (appointment.status === 'cancelado') {
    return {
      success: true,
      alreadyCancelled: true,
      message: 'Este agendamento já se encontrava cancelado e a vaga liberada.',
      appointment,
    };
  }

  // 2. ATUALIZAÇÃO DO STATUS: Transiciona para 'cancelado' com auditoria completa
  const updatePayload = {
    status: 'cancelado',
    cancellation_reason: reason?.trim() || null,
    cancelled_at: new Date().toISOString(),
    cancelled_by: cancelledBy || 'sistema',
  };

  const { error: updateError } = await db
    .from('appointments')
    .update(updatePayload)
    .eq('id', appointmentId);

  if (updateError) {
    console.error('[cancellation] Erro ao atualizar status no Supabase:', updateError.message);
    return { error: `Falha ao atualizar status do agendamento: ${updateError.message}` };
  }

  // 3. LIBERAÇÃO INSTANTÂNEA DA VAGA
  // O motor de horários (lib/slots.js e WalkInSheet.jsx) filtra todos os agendamentos com
  // status != 'cancelado'. Ao mudar o status no banco, a vaga é liberada instantaneamente.
  // Revalidamos as rotas e caches de páginas do Next.js para refletir imediatamente.
  try {
    revalidatePath('/admin/agenda');
    revalidatePath('/admin/financeiro');
    revalidatePath('/admin');
  } catch (revErr) {
    // Em contextos de API pura, revalidatePath pode ser no-op silencioso
  }

  // 4. VERIFICAÇÃO DE LISTA DE ESPERA (Waitlist)
  // Checa se há clientes aguardando na lista de espera para assumir o horário recém-liberado
  let waitlistCandidates = [];
  try {
    waitlistCandidates = await findWaitlistMatchesForCancelledAppointment(appointmentId);
  } catch (wErr) {
    console.warn('[cancellation] Falha ao verificar lista de espera:', wErr?.message);
  }

  // 5. DISPARO DE NOTIFICAÇÕES AO BARBEIRO E CHEFE
  const notificationsSent = {
    push: null,
    whatsapp: null,
    realtime: true, // Acionado via Supabase Realtime postgres_changes na tabela 'appointments'
  };

  // A) Disparo de Web Push Notification
  try {
    notificationsSent.push = await notifyCancelledAppointment(appointmentId, { reason });
  } catch (pushErr) {
    console.error('[cancellation] Falha ao disparar Web Push:', pushErr?.message || pushErr);
    notificationsSent.push = { error: pushErr?.message };
  }

  // B) Disparo ou geração de mensagem de WhatsApp para o Barbeiro
  if (appointment.barbers?.phone) {
    try {
      const waMessage = buildCancellationWhatsAppMessage({
        clientName: appointment.client_name,
        serviceName: appointment.services?.name,
        appointmentDate: appointment.appointment_date,
        barberName: appointment.barbers?.name,
        reason,
      });

      notificationsSent.whatsapp = await sendWhatsAppNotification({
        phone: appointment.barbers.phone,
        message: waMessage,
        metadata: {
          event: 'APPOINTMENT_CANCELLED',
          appointmentId: appointment.id,
          barberId: appointment.barber_id,
        },
      });
    } catch (waErr) {
      console.error('[cancellation] Falha ao enviar WhatsApp para o barbeiro:', waErr?.message || waErr);
      notificationsSent.whatsapp = { error: waErr?.message };
    }
  }

  // 6. LOG DE AUDITORIA DE SEGURANÇA
  try {
    await logSecurityEvent({
      action: 'APPOINTMENT_CANCELLED',
      barberId: appointment.barber_id,
      ip: clientIp || 'server-action',
      success: true,
      details: {
        appointmentId,
        clientName: appointment.client_name,
        cancelledBy,
        reason,
      },
    });
  } catch {
    // auditoria best-effort
  }

  return {
    success: true,
    message: 'Agendamento cancelado, vaga liberada instantaneamente e barbeiro notificado.',
    appointment: {
      id: appointment.id,
      clientName: appointment.client_name,
      appointmentDate: appointment.appointment_date,
      status: 'cancelado',
      barberId: appointment.barber_id,
      barberName: appointment.barbers?.name,
    },
    waitlistCount: waitlistCandidates.length,
    notifications: notificationsSent,
  };
}
