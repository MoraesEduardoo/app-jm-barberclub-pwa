'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server';
// ... resto do código

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function listSchedule(barberId) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('barber_schedules')
    .select(
      'id, barber_id, day_of_week, start_time, end_time, is_working, has_lunch_break, lunch_start, lunch_end'
    )
    .eq('barber_id', barberId);

  if (error) throw new Error(`Não foi possível carregar o expediente: ${error.message}`);
  // Normaliza is_working -> active, pra manter os componentes de UI simples.
  return data.map((row) => ({ ...row, active: row.is_working }));
}

export async function upsertScheduleDay(
  barberId,
  dayOfWeek,
  { start_time, end_time, active, has_lunch_break = false, lunch_start = null, lunch_end = null }
) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from('barber_schedules')
    .upsert(
      {
        barber_id: barberId,
        day_of_week: dayOfWeek,
        start_time,
        end_time,
        is_working: active,
        has_lunch_break,
        // zera os horários de almoço quando o intervalo está desativado,
        // pra não deixar lixo salvo que confunda a geração de grade depois
        lunch_start: has_lunch_break ? lunch_start : null,
        lunch_end: has_lunch_break ? lunch_end : null,
      },
      { onConflict: 'barber_id,day_of_week' }
    );

  if (error) throw new Error(`Não foi possível salvar o expediente desse dia: ${error.message}`);
  revalidatePath('/admin/expediente');
}

export async function listExceptions(barberId) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('barber_exceptions')
    .select('id, barber_id, exception_date, start_time, end_time, reason')
    .eq('barber_id', barberId)
    .gte('exception_date', new Date().toISOString().slice(0, 10))
    .order('exception_date', { ascending: true });

  if (error) throw new Error(`Não foi possível carregar os bloqueios de agenda: ${error.message}`);
  return data;
}

// Bloqueia o dia inteiro (start_time/end_time nulos = folga completa).
export async function createException(barberId, { date, reason }) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('barber_exceptions').insert({
    barber_id: barberId,
    exception_date: date,
    start_time: null,
    end_time: null,
    reason: reason?.trim() || null,
  });

  if (error) throw new Error(`Não foi possível bloquear essa data: ${error.message}`);
  revalidatePath('/admin/expediente');
}

export async function deleteException(id) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('barber_exceptions').delete().eq('id', id);
  if (error) throw new Error(`Não foi possível remover o bloqueio: ${error.message}`);
  revalidatePath('/admin/expediente');
}
