'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_PERMISSIONS } from '@/lib/auth';

export async function listTeam() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('barbers')
    .select('id, name, phone, role, active, permissions')
    .order('role', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(`Não foi possível carregar a equipe: ${error.message}`);
  return data.map((b) => ({ ...b, permissions: { ...DEFAULT_PERMISSIONS, ...(b.permissions || {}) } }));
}

/**
 * Apenas o barbeiro chefe pode chamar esta action (checagem feita na tela).
 * Cadastra um novo barbeiro secundário na equipe.
 */
export async function addTeamMember({ name, phone }) {
  const supabase = getSupabaseServerClient();
  const cleanPhone = phone.replace(/\D/g, '');

  const { error } = await supabase.from('barbers').insert({
    name: name.trim(),
    phone: cleanPhone,
    role: 'barber',
    active: true,
    permissions: DEFAULT_PERMISSIONS,
  });

  if (error) throw new Error(`Não foi possível adicionar o barbeiro: ${error.message}`);
  revalidatePath('/admin/equipe');
}

export async function toggleTeamMemberActive(id, active) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('barbers').update({ active }).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o status do barbeiro: ${error.message}`);
  revalidatePath('/admin/equipe');
}

export async function updateTeamMemberPermission(id, key, value) {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from('barbers')
    .select('permissions')
    .eq('id', id)
    .single();

  if (fetchError) throw new Error(`Barbeiro não encontrado: ${fetchError.message}`);

  const nextPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...(current.permissions || {}),
    [key]: value,
  };

  const { error } = await supabase
    .from('barbers')
    .update({ permissions: nextPermissions })
    .eq('id', id);

  if (error) throw new Error(`Não foi possível atualizar as permissões: ${error.message}`);
  revalidatePath('/admin/equipe');
}

export async function removeTeamMember(id) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('barbers').delete().eq('id', id);
  if (error) throw new Error(`Não foi possível remover o barbeiro: ${error.message}`);
  revalidatePath('/admin/equipe');
}
