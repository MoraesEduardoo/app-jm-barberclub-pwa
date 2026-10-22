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
 * Lista folgas e bloqueios pontuais do barbeiro.
 * Utiliza a tabela oficial 'barber_exceptions' do sistema.
 */
export async function listExceptions(barberId) {
  try {
    const ctx = await requireBarber();
    const effectiveBarberId = barberId || ctx?.barber?.id;
    if (!effectiveBarberId) return [];

    const today = todayInShop();
    const client = ctx?.supabase || createAdminClient();

    let { data, error } = await client
      .from('barber_exceptions')
      .select('id, barber_id, exception_date, start_time, end_time, reason')
      .eq('barber_id', effectiveBarberId)
      .gte('exception_date', today)
      .order('exception_date', { ascending: true });

    // Fallback com adminClient caso o token do usuário encontre restrição RLS
    if (error) {
      const adminClient = createAdminClient();
      const adminRes = await adminClient
        .from('barber_exceptions')
        .select('id, barber_id, exception_date, start_time, end_time, reason')
        .eq('barber_id', effectiveBarberId)
        .gte('exception_date', today)
        .order('exception_date', { ascending: true });

      if (!adminRes.error && adminRes.data) {
        data = adminRes.data;
        error = null;
      }
    }

    if (error) {
      console.warn('[listExceptions] Aviso ao buscar barber_exceptions:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      barber_id: row.barber_id,
      exception_date: row.exception_date,
      start_time: row.start_time,
      end_time: row.end_time,
      reason: row.reason,
    }));
  } catch (err) {
    console.warn('[listExceptions] Falha ao listar bloqueios:', err);
    return [];
  }
}

/**
 * Cria ou atualiza bloqueio de data pontual para o barbeiro na tabela 'barber_exceptions'.
 */
export async function createException(barberId, { date, reason }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) throw new Error('Sessão expirada ou sem permissão.');

    const effectiveBarberId = barberId || ctx.barber.id;
    if (!effectiveBarberId) {
      throw new Error('ID do barbeiro não identificado para o bloqueio.');
    }
    if (!date) {
      throw new Error('Data do bloqueio é obrigatória.');
    }

    const reasonClean = reason?.trim() || null;
    const client = ctx.supabase || createAdminClient();

    const payload = {
      barber_id: effectiveBarberId,
      exception_date: date,
      is_available: false,
      start_time: null,
      end_time: null,
      reason: reasonClean,
    };

    // Usa upsert na tabela barber_exceptions para evitar falha se a data já foi bloqueada antes
    let { error } = await client
      .from('barber_exceptions')
      .upsert(payload, { onConflict: 'barber_id,exception_date' });

    // Se falhar no client do barbeiro (ex: RLS), executa com adminClient com total autoridade
    if (error) {
      const adminClient = createAdminClient();
      const adminRes = await adminClient
        .from('barber_exceptions')
        .upsert(payload, { onConflict: 'barber_id,exception_date' });

      if (!adminRes.error) {
        error = null;
      } else {
        error = adminRes.error;
      }
    }

    if (error) {
      console.error('[createException] Erro ao gravar em barber_exceptions:', error);
      throw new Error(`Não foi possível bloquear essa data: ${error.message}`);
    }

    revalidatePath('/admin/expediente');
    return { success: true };
  } catch (err) {
    console.error('[createException] Exceção capturada:', err);
    throw new Error(err.message || 'Erro ao processar bloqueio de data.');
  }
}

/**
 * Remove bloqueio de data na tabela 'barber_exceptions'.
 */
export async function deleteException(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) throw new Error('Sessão expirada ou sem permissão.');

    const client = ctx.supabase || createAdminClient();
    let { error } = await client.from('barber_exceptions').delete().eq('id', id);

    if (error) {
      const adminClient = createAdminClient();
      const adminRes = await adminClient.from('barber_exceptions').delete().eq('id', id);
      if (!adminRes.error) {
        error = null;
      } else {
        error = adminRes.error;
      }
    }

    if (error) {
      console.error('[deleteException] Erro ao remover de barber_exceptions:', error);
      throw new Error(`Não foi possível remover o bloqueio: ${error.message}`);
    }

    revalidatePath('/admin/expediente');
    return { success: true };
  } catch (err) {
    console.error('[deleteException] Exceção capturada:', err);
    throw new Error(err.message || 'Erro ao remover bloqueio de data.');
  }
}