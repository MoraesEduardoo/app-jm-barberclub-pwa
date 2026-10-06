// Utilitário puro (sem 'use server' / sem acesso a banco) que gera a grade
// de horários disponíveis de um barbeiro em um dia específico.
//
// É usado hoje pelo agendamento de Walk-in (o barbeiro escolhe um horário
// livre pra encaixar o cliente que chegou sem hora marcada) e serve também
// de base para uma futura tela pública de agendamento, já que a regra de
// negócio (almoço, passo de 10 min, duração do serviço, conflito com
// agendamentos existentes) é exatamente a mesma nos dois casos.
import { SLOT_STEP_MINUTES } from '@/lib/constants/schedule';

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
 * @param {Array<{start: string, end: string}>} busyRanges - horários "HH:mm"
 *   já ocupados por outros agendamentos (não cancelados) daquele dia.
 * @param {number} serviceDurationMinutes - duração do serviço a encaixar.
 * @param {object} [options]
 * @param {number} [options.stepMinutes] - passo da grade (default: 10 min).
 * @param {string} [options.nowTime] - "HH:mm" atual, pra não sugerir
 *   horário que já passou (usado no walk-in, que é sempre "hoje").
 * @returns {string[]} lista de horários "HH:mm" disponíveis, em ordem.
 */
export function generateAvailableSlots(
  daySchedule,
  busyRanges,
  serviceDurationMinutes,
  { stepMinutes = SLOT_STEP_MINUTES, nowTime = null } = {}
) {
  if (!daySchedule || !daySchedule.active) return [];

  const dayStart = timeToMinutes(daySchedule.start_time);
  const dayEnd = timeToMinutes(daySchedule.end_time);
  const duration = Number(serviceDurationMinutes) || stepMinutes;

  const lunchStart = daySchedule.has_lunch_break && daySchedule.lunch_start
    ? timeToMinutes(daySchedule.lunch_start)
    : null;
  const lunchEnd = daySchedule.has_lunch_break && daySchedule.lunch_end
    ? timeToMinutes(daySchedule.lunch_end)
    : null;

  const busyMinuteRanges = (busyRanges || []).map((r) => ({
    start: timeToMinutes(r.start),
    end: timeToMinutes(r.end),
  }));

  const nowMinutes = nowTime ? timeToMinutes(nowTime) : null;

  const slots = [];
  for (let start = dayStart; start + duration <= dayEnd; start += stepMinutes) {
    const end = start + duration;

    if (nowMinutes !== null && start < nowMinutes) continue;

    // bloqueia se o serviço invadir o horário de almoço, mesmo que só
    // parcialmente (ex.: serviço de 30 min começando 10 min antes do almoço)
    const overlapsLunch =
      lunchStart !== null && lunchEnd !== null && start < lunchEnd && end > lunchStart;
    if (overlapsLunch) continue;

    const overlapsAppointment = busyMinuteRanges.some(
      (busy) => start < busy.end && end > busy.start
    );
    if (overlapsAppointment) continue;

    slots.push(minutesToTime(start));
  }

  return slots;
}

/**
 * Horário "HH:mm" mais próximo do agora (arredondado pra cima no passo da
 * grade) — usado como sugestão inicial no formulário de walk-in.
 */
export function roundUpToNextSlot(date = new Date(), stepMinutes = SLOT_STEP_MINUTES) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const rounded = Math.ceil(minutes / stepMinutes) * stepMinutes;
  return minutesToTime(rounded);
}
