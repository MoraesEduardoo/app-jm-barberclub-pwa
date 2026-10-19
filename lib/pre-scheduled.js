/**
 * Utilitários para detecção e gestão de Pré-Agendamentos (pre_scheduled)
 * originados pelo chatbot com recorrência garantida.
 */

export function isPreScheduledAppointment(appointment) {
  if (!appointment) return false;

  // 1. Verificação de flags booleanas
  if (appointment.is_pre_scheduled === true || appointment.pre_scheduled === true) {
    return true;
  }

  // 2. Verificação de origem
  if (
    appointment.origin === 'pre_schedule' ||
    appointment.origin === 'chatbot_pre_schedule' ||
    appointment.origin === 'recorrencia'
  ) {
    return true;
  }

  // 3. Verificação de status
  const statusStr = String(appointment.status || '').toLowerCase().trim();
  if (
    statusStr === 'pre_scheduled' ||
    statusStr === 'pre_agendado' ||
    statusStr === 'pre-agendado' ||
    statusStr === 'prescheduled'
  ) {
    return true;
  }

  // 4. Verificação em anotações (caso tenha vindo com etiqueta no notes)
  if (typeof appointment.notes === 'string') {
    const n = appointment.notes.toLowerCase();
    if (
      n.includes('pré-agendad') ||
      n.includes('pre_scheduled') ||
      n.includes('pre-agendad') ||
      n.includes('pré agendamento') ||
      n.includes('recorrência chatbot')
    ) {
      return true;
    }
  }

  return false;
}

export function getPreScheduledDetails(appointment) {
  const isPre = isPreScheduledAppointment(appointment);
  if (!isPre) return null;

  const statusStr = String(appointment.status || '').toLowerCase().trim();
  const isPendingConfirmation =
    statusStr === 'pre_scheduled' ||
    statusStr === 'pre_agendado' ||
    statusStr === 'pre-agendado' ||
    statusStr === 'pendente' ||
    statusStr === 'pending';

  return {
    isPreScheduled: true,
    isPendingConfirmation,
    badgeLabel: isPendingConfirmation ? 'Pré-agendado (Aguardando)' : 'Pré-agendado',
    colorClasses: isPendingConfirmation
      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  };
}
