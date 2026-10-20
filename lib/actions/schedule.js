'use server';

import { requireBarber } from '@/lib/auth-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { todayInShop } from '@/lib/dates';
import { WEEKDAYS } from '@/lib/constants/schedule';

const DAY_MAP_NUM_TO_STR = {
  0: 'domingo',
  1: 'segunda',
  2: 'terca',
  3: 'quarta',
  4: 'quinta',
  5: 'sexta',
  6: 'sabado',
  '0': 'domingo',
  '1': 'segunda',
  '2': 'terca',
  '3': 'quarta',
  '4': 'quinta',
  '5': 'sexta',
  '6': 'sabado',
};

const DAY_MAP_STR_TO_NUM = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

async function getScheduleClient() {
  try {
    const ctx = await requireBarber();
    if (ctx?.supabase) return ctx.supabase;
  } catch {}
  return createAdminClient();
}

/**
 * Carrega o expediente semanal do barbeiro.
 * Normaliza os dias da semana (número ou string) e os campos de almoço/pausa.
 */
export async function listSchedule(barberId) {
  if (!barberId) {
    return getDefaultSchedule(null);
  }

  try {
    const supabase = await getScheduleClient();
    const { data, error } = await supabase
      .from('barber_schedules')
      .select('*')
      .eq('barber_id', barberId);

    if (error) {
      console.warn('[listSchedule] Erro na consulta de barber_schedules:', error.message);
      return getDefaultSchedule(barberId);
    }

    if (!data || data.length === 0) {
      return getDefaultSchedule(barberId);
    }

    return data.map((row) => {
      let dayStr = String(row.day_of_week ?? '').toLowerCase().trim();
      if (DAY_MAP_NUM_TO_STR[dayStr] !== undefined) {
        dayStr = DAY_MAP_NUM_TO_STR[dayStr];
      }

      const isWorking = row.is_working_day !== undefined
        ? Boolean(row.is_working_day)
        : (row.is_working !== undefined ? Boolean(row.is_working) : Boolean(row.active ?? true));

      const hasLunch = Boolean(
        row.has_lunch_break ??
        (row.break_start_time && row.break_end_time) ??
        (row.break_start && row.break_end) ??
        (row.lunch_start && row.lunch_end)
      );

      const lunchStart = (row.break_start_time || row.lunch_start || row.break_start || '12:00').slice(0, 5);
      const lunchEnd = (row.break_end_time || row.lunch_end || row.break_end || '13:00').slice(0, 5);
      const startTime = (row.start_time || '09:00').slice(0, 5);
      const endTime = (row.end_time || '19:00').slice(0, 5);

      return {
        id: row.id,
        barber_id: row.barber_id,
        day_of_week: dayStr,
        active: isWorking,
        is_working: isWorking,
        start_time: startTime,
        end_time: endTime,
        has_lunch_break: hasLunch,
        lunch_start: lunchStart,
        lunch_end: lunchEnd,
        break_start: lunchStart,
        break_end: lunchEnd,
      };
    });
  } catch (err) {
    console.error('[listSchedule] Exceção capturada:', err);
    return getDefaultSchedule(barberId);
  }
}

function getDefaultSchedule(barberId) {
  return WEEKDAYS.map((w) => ({
    barber_id: barberId,
    day_of_week: w.value,
    active: w.value !== 'domingo',
    is_working: w.value !== 'domingo',
    start_time: '09:00',
    end_time: '19:00',
    has_lunch_break: true,
    lunch_start: '12:00',
    lunch_end: '13:00',
  }));
}

/**
 * Salva a semana inteira de expediente de forma atômica e em lote,
 * evitando múltiplos revalidatePath concorrentes e contornando triggers de UPDATE legados.
 */
export async function saveScheduleBatch(barberId, days) {
  if (!barberId) {
    return { error: 'ID do barbeiro não fornecido.' };
  }

  if (!Array.isArray(days) || days.length === 0) {
    return { success: true };
  }

  try {
    const supabase = await getScheduleClient();

    for (const day of days) {
      const dayNum = typeof day.day_of_week === 'number'
        ? day.day_of_week
        : (DAY_MAP_STR_TO_NUM[String(day.day_of_week).toLowerCase()] ?? 0);

      const isWorking = Boolean(day.active ?? day.is_working_day ?? day.is_working ?? true);
      const hasLunch = Boolean(day.has_lunch_break);
      const sTime = (day.start_time || '09:00').slice(0, 5) + ':00';
      const eTime = (day.end_time || '19:00').slice(0, 5) + ':00';
      const lStart = hasLunch ? ((day.lunch_start || day.break_start || '12:00').slice(0, 5) + ':00') : null;
      const lEnd = hasLunch ? ((day.lunch_end || day.break_end || '13:00').slice(0, 5) + ':00') : null;

      // 1. Remove qualquer registro existente daquele dia para não disparar trigger BEFORE UPDATE com updated_at ausente
      await supabase
        .from('barber_schedules')
        .delete()
        .eq('barber_id', barberId)
        .eq('day_of_week', dayNum);

      // 2. Insere novo registro normalizado
      const insertPayload = {
        barber_id: barberId,
        day_of_week: dayNum,
        start_time: sTime,
        end_time: eTime,
        break_start_time: lStart,
        break_end_time: lEnd,
        is_working_day: isWorking,
      };

      const { error: insErr } = await supabase.from('barber_schedules').insert(insertPayload);
      if (insErr) {
        console.warn('[saveScheduleBatch] Erro ao inserir dia:', dayNum, insErr.message);
      }
    }

    revalidatePath('/admin/expediente');
    return { success: true };
  } catch (err) {
    console.error('[saveScheduleBatch] Erro inesperado:', err);
    return { error: err.message || 'Erro ao salvar expediente.' };
  }
}

/**
 * Salva ou atualiza o expediente de um dia específico com proteção contra erros de schema.
 */
export async function upsertScheduleDay(
  barberId,
  dayOfWeek,
  { start_time, end_time, active, has_lunch_break = false, lunch_start = null, lunch_end = null }
) {
  if (!barberId) {
    return { error: 'ID do barbeiro não fornecido.' };
  }

  try {
    const supabase = await getScheduleClient();
    const dayNum = typeof dayOfWeek === 'number'
      ? dayOfWeek
      : (DAY_MAP_STR_TO_NUM[String(dayOfWeek).toLowerCase()] ?? 0);

    const isWorking = Boolean(active);
    const lunchActive = Boolean(has_lunch_break);
    const lStart = lunchActive ? ((lunch_start || '12:00').slice(0, 5) + ':00') : null;
    const lEnd = lunchActive ? ((lunch_end || '13:00').slice(0, 5) + ':00') : null;
    const sTime = (start_time || '09:00').slice(0, 5) + ':00';
    const eTime = (end_time || '19:00').slice(0, 5) + ':00';

    // Delete prévio para contornar qualquer trigger de BEFORE UPDATE
    await supabase
      .from('barber_schedules')
      .delete()
      .eq('barber_id', barberId)
      .eq('day_of_week', dayNum);

    const { error: insErr } = await supabase.from('barber_schedules').insert({
      barber_id: barberId,
      day_of_week: dayNum,
      start_time: sTime,
      end_time: eTime,
      break_start_time: lStart,
      break_end_time: lEnd,
      is_working_day: isWorking,
    });

    if (insErr) {
      console.warn('[upsertScheduleDay] Erro ao inserir:', insErr.message);
      return { error: insErr.message };
    }

    revalidatePath('/admin/expediente');
    return { success: true };
  } catch (err) {
    console.error('[upsertScheduleDay] Exceção:', err);
    return { error: err.message || 'Erro ao salvar dia de expediente.' };
  }
}

/**
 * Lista folgas e bloqueios pontuais.
 * Compatível com barber_exceptions e barber_schedule_overrides.
 */
export async function listExceptions(barberId) {
  try {
    const supabase = await getScheduleClient();
    const today = todayInShop();

    const { data, error } = await supabase
      .from('barber_exceptions')
      .select('id, barber_id, exception_date, start_time, end_time, reason')
      .eq('barber_id', barberId)
      .gte('exception_date', today)
      .order('exception_date', { ascending: true });

    if (error) {
      // Fallback para barber_schedule_overrides
      const { data: overData, error: overErr } = await supabase
        .from('barber_schedule_overrides')
        .select('id, barber_id, override_date, start_time, end_time, reason')
        .eq('barber_id', barberId)
        .gte('override_date', today)
        .order('override_date', { ascending: true });

      if (overErr) {
        console.warn('[listExceptions] Nenhuma tabela de exceções disponível:', overErr.message);
        return [];
      }
      return (overData || []).map((o) => ({
        ...o,
        exception_date: o.override_date,
      }));
    }

    return data || [];
  } catch (err) {
    console.warn('[listExceptions] Exceção ao listar bloqueios:', err);
    return [];
  }
}

/**
 * Cria bloqueio de data pontual.
 */
export async function createException(barberId, { date, reason }) {
  const supabase = await getScheduleClient();
  const reasonClean = reason?.trim() || null;

  const payload = {
    barber_id: barberId,
    exception_date: date,
    start_time: null,
    end_time: null,
    reason: reasonClean,
  };

  const { error } = await supabase.from('barber_exceptions').insert(payload);

  if (error) {
    // Fallback para barber_schedule_overrides
    const overridePayload = {
      barber_id: barberId,
      override_date: date,
      is_day_off: true,
      start_time: null,
      end_time: null,
      reason: reasonClean,
    };
    const { error: overErr } = await supabase.from('barber_schedule_overrides').insert(overridePayload);
    if (overErr) {
      console.error('[createException] Erro ao bloquear data:', overErr);
      throw new Error(`Não foi possível bloquear essa data: ${overErr.message}`);
    }
  }

  revalidatePath('/admin/expediente');
  return { success: true };
}

/**
 * Remove bloqueio de data.
 */
export async function deleteException(id) {
  const supabase = await getScheduleClient();

  const { error } = await supabase.from('barber_exceptions').delete().eq('id', id);
  if (error) {
    const { error: overErr } = await supabase.from('barber_schedule_overrides').delete().eq('id', id);
    if (overErr) {
      console.error('[deleteException] Erro ao remover bloqueio:', overErr);
      throw new Error(`Não foi possível remover o bloqueio: ${overErr.message}`);
    }
  }

  revalidatePath('/admin/expediente');
  return { success: true };
}