// Utilitário puro (sem 'use server' / sem acesso a banco) que gera a grade
// de horários disponíveis de um barbeiro em um dia específico.
//
// É usado pelo agendamento de Walk-in e pelo chatbot de agendamento público.
// Considera o tempo total do serviço somado ao buffer de higienização da bancada
// (5 a 10 min, padrão CLEANING_BUFFER_MINUTES = 10 min) antes de disponibilizar
// o próximo horário na agenda do barbeiro.

import { SLOT_STEP_MINUTES, CLEANING_BUFFER_MINUTES } from '@/lib/constants/schedule';

function timeToMinutes(time) {
  // aceita "09:00" ou "09:00:00"
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * @param {object} daySchedule - linha de barber_schedules do dia (já filtrada
 *   pelo dia da semana desejado). Precisa de: active, start_time, end_time,
 *   has_lunch_break, lunch_start, lunch_end.
 * @param {Array<{start: string, end: string, bufferMinutes?: number}>} busyRanges - horários "HH:mm"
 *   já ocupados por outros agendamentos (não cancelados) daquele dia.
 * @param {number} serviceDurationMinutes - duração do serviço a encaixar.
 * @param {object} [options]
 * @param {number} [options.stepMinutes] - passo da grade (default: 10 min).
 * @param {string} [options.nowTime] - "HH:mm" atual, pra não sugerir
 *   horário que já passou (usado no walk-in, que é sempre "hoje").
 * @param {number} [options.bufferMinutes] - buffer de higienização entre cortes (default: 10 min).
 * @returns {string[]} lista de horários "HH:mm" disponíveis, em ordem.
 */
export function generateAvailableSlots(
  daySchedule,
  busyRanges,
  serviceDurationMinutes,
  {
    stepMinutes = SLOT_STEP_MINUTES,
    nowTime = null,
    bufferMinutes = CLEANING_BUFFER_MINUTES,
  } = {}
) {
  if (!daySchedule || !daySchedule.active) return [];

  const dayStart = timeToMinutes(daySchedule.start_time);
  const dayEnd = timeToMinutes(daySchedule.end_time);
  const baseDuration = Number(serviceDurationMinutes) || stepMinutes;

  // Tempo total reservado na bancada pelo novo atendimento = serviço + buffer de higienização
  const totalOccupancyMinutes = baseDuration + (Number(bufferMinutes) || 0);

  const lunchStart = daySchedule.has_lunch_break && daySchedule.lunch_start
    ? timeToMinutes(daySchedule.lunch_start)
    : null;
  const lunchEnd = daySchedule.has_lunch_break && daySchedule.lunch_end
    ? timeToMinutes(daySchedule.lunch_end)
    : null;

  // Converte e expande os compromissos existentes com seus respectivos buffers de higienização
  const busyMinuteRanges = (busyRanges || []).map((r) => {
    const startMin = timeToMinutes(r.start);
    const endMin = timeToMinutes(r.end);
    // Cada agendamento existente também segura a bancada pelo seu tempo + buffer de higienização
    const slotBuffer = r.bufferMinutes !== undefined ? Number(r.bufferMinutes) : bufferMinutes;
    return {
      start: startMin,
      end: endMin + (slotBuffer || 0),
    };
  });

  const nowMinutes = nowTime ? timeToMinutes(nowTime) : null;

  const slots = [];
  // Itera pelo expediente garantindo que o tempo total (serviço + higienização) cabe antes de fechar a loja
  for (let start = dayStart; start + baseDuration <= dayEnd; start += stepMinutes) {
    const endOfService = start + baseDuration;
    const endWithBuffer = start + totalOccupancyMinutes;

    if (nowMinutes !== null && start < nowMinutes) continue;

    // Bloqueia se o atendimento (ou a higienização subsequente) invadir o horário de almoço
    const overlapsLunch =
      lunchStart !== null && lunchEnd !== null && start < lunchEnd && endOfService > lunchStart;
    if (overlapsLunch) continue;

    // Bloqueia se houver sobreposição com agendamentos existentes (período exato do serviço + buffer_minutes)
    const overlapsAppointment = busyMinuteRanges.some(
      (busy) => start < busy.end && endOfService > busy.start
    );
    if (overlapsAppointment) continue;

    slots.push(minutesToTime(start));
  }

  return slots;
}

/**
 * Horário "HH:mm" mais próximo no futuro (arredondado para cima no passo de 10 em 10 min
 * considerando o fuso horário America/Fortaleza).
 */
export function roundUpToNextSlot(date = null, stepMinutes = SLOT_STEP_MINUTES) {
  const d =
    date instanceof Date
      ? date
      : new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const minutesFloat =
    d.getHours() * 60 + d.getMinutes() + (d.getSeconds() > 0 ? d.getSeconds() / 60 : 0);
  const rounded = Math.ceil(minutesFloat / stepMinutes) * stepMinutes;
  return minutesToTime(rounded);
}

/**
 * Converte uma lista de agendamentos brutos em intervalos ocupados (busyRanges).
 * REGRA MANDATÓRIA DE LIBERAÇÃO DE VAGAS:
 * Agendamentos com status 'cancelado' são estritamente EXCLUÍDOS.
 * Desta forma, assim que o status transiciona para 'cancelado', a vaga fica
 * instantaneamente disponível para novas marcações no motor de horários.
 */
export function extractBusyRangesFromAppointments(appointments = [], barberId = null) {
  if (!Array.isArray(appointments)) return [];

  return appointments
    .filter((a) => {
      // Descarta agendamentos cancelados
      if (a.status === 'cancelado' || a.status === 'cancelled') return false;

      // Se barberId foi especificado, restringe ao profissional
      if (barberId) {
        const id = a.barbers?.id || a.barber_id;
        if (id && String(id) !== String(barberId)) return false;
      }

      return Boolean(a.appointment_date || a.appointment_time);
    })
    .map((a) => {
      let startTime = '09:00';
      if (a.appointment_time) {
        startTime = String(a.appointment_time).slice(0, 5);
      } else if (a.appointment_date && String(a.appointment_date).includes('T')) {
        try {
          const start = new Date(a.appointment_date);
          startTime = start.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Fortaleza',
          });
        } catch {
          startTime = '09:00';
        }
      }

      const durationMin = Number(a.duration_minutes || a.services?.default_duration_minutes || 30);
      const [sh, sm] = startTime.split(':').map(Number);
      const totalStartMin = (sh || 0) * 60 + (sm || 0);
      const totalEndMin = totalStartMin + durationMin;
      const eh = Math.floor(totalEndMin / 60);
      const em = totalEndMin % 60;
      const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      const rowBuffer =
        a.buffer_minutes !== undefined && a.buffer_minutes !== null
          ? Number(a.buffer_minutes)
          : CLEANING_BUFFER_MINUTES;

      return {
        start: startTime,
        end: endTime,
        bufferMinutes: rowBuffer,
      };
    });
}

