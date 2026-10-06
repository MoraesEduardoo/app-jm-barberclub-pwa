'use server'

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function listServices() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .select('id, name, price, default_duration_minutes, active')
    .order('name', { ascending: true });

  if (error) throw new Error(`Não foi possível carregar os serviços: ${error.message}`);
  return data;
}

export async function createService({ name, price, default_duration_minutes }) {
  const supabase = await createClient();
  const { error } = await supabase.from('services').insert({
    name: name.trim(),
    price,
    default_duration_minutes,
    active: true,
  });

  if (error) throw new Error(`Não foi possível criar o serviço: ${error.message}`);
  revalidatePath('/admin/servicos');
}

export async function updateService(id, { name, price, default_duration_minutes, active }) {
  const supabase = await createClient();
  const payload = {};
  if (name !== undefined) payload.name = name.trim();
  if (price !== undefined) payload.price = price;
  if (default_duration_minutes !== undefined) payload.default_duration_minutes = default_duration_minutes;
  if (active !== undefined) payload.active = active;

  const { error } = await supabase.from('services').update(payload).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o serviço: ${error.message}`);
  revalidatePath('/admin/servicos');
}

export async function deleteService(id) {
  const supabase = await createClient();
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) throw new Error(`Não foi possível remover o serviço: ${error.message}`);
  revalidatePath('/admin/servicos');
}