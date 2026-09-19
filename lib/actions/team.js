'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server';
// ... resto do código

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_PERMISSIONS } from '@/lib/auth';

export async function listTeam() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('barbers')
    .select('id, name, phone, role, active, permissions, commission_percent, avatar_url')
    .order('role', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(`Não foi possível carregar a equipe: ${error.message}`);
  return data.map((b) => ({ ...b, permissions: { ...DEFAULT_PERMISSIONS, ...(b.permissions || {}) } }));
}

/**
 * Só o chefe pode chamar (checagem feita na tela, como as demais actions
 * de equipe). Define o percentual de comissão (0 a 100) usado no cálculo
 * automático do painel financeiro daquele barbeiro.
 */
export async function updateTeamMemberCommission(id, commissionPercent) {
  const supabase = getSupabaseServerClient();
  const value = Math.min(100, Math.max(0, Number(commissionPercent) || 0));

  const { error } = await supabase
    .from('barbers')
    .update({ commission_percent: value })
    .eq('id', id);

  if (error) throw new Error(`Não foi possível atualizar a comissão: ${error.message}`);
  return value;
}

/**
 * Cada barbeiro pode editar apenas o próprio nome e foto (nunca telefone,
 * cargo ou permissões — isso continua exclusivo do chefe via listTeam/
 * updateTeamMemberPermission).
 */
export async function updateOwnProfile(id, { name, avatar_url }) {
  const supabase = getSupabaseServerClient();
  const payload = {};
  if (name !== undefined && name.trim()) payload.name = name.trim();
  if (avatar_url !== undefined) payload.avatar_url = avatar_url;

  const { error } = await supabase.from('barbers').update(payload).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o perfil: ${error.message}`);
  revalidatePath('/admin', 'layout');
}

/**
 * Recebe a foto enviada (FormData com um File em "file") e sobe pro bucket
 * "avatars" do Supabase Storage usando o cliente com service role — assim
 * não depende de policy de upload liberada pro público. Retorna a URL
 * pública já pronta pra salvar em barbers.avatar_url.
 */
export async function uploadBarberAvatar(barberId, formData) {
  const supabase = getSupabaseServerClient();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new Error('Nenhuma imagem foi enviada.');
  }

  const extension = file.name?.split('.').pop() || 'jpg';
  const path = `${barberId}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });

  if (uploadError) throw new Error(`Não foi possível enviar a foto: ${uploadError.message}`);

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  await updateOwnProfile(barberId, { avatar_url: data.publicUrl });
  return data.publicUrl;
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
}

export async function toggleTeamMemberActive(id, active) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('barbers').update({ active }).eq('id', id);
  if (error) throw new Error(`Não foi possível atualizar o status do barbeiro: ${error.message}`);
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
}

export async function removeTeamMember(id) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('barbers').delete().eq('id', id);
  if (error) throw new Error(`Não foi possível remover o barbeiro: ${error.message}`);
}
