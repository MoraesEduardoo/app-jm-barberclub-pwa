'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Normaliza o preço para reais para consumo visual e de relatórios,
 * garantindo compatibilidade se estiver gravado em reais (ex: 25.00) ou centavos (ex: 2500).
 */
function normalizeServicePrice(price, priceInCents) {
  if (priceInCents !== undefined && priceInCents !== null) {
    const cents = Number(priceInCents);
    return cents >= 100 ? Number((cents / 100).toFixed(2)) : Number(cents.toFixed(2));
  }
  const num = Number(price || 0);
  if (num >= 1000) {
    return Number((num / 100).toFixed(2));
  }
  return Number(num.toFixed(2));
}

export async function listServices() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .select('id, name, description, category, price, price_in_cents, default_duration_minutes, display_order, active')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(`Não foi possível carregar os serviços: ${error.message}`);

  return (data || []).map((s, idx) => ({
    ...s,
    display_order: s.display_order ?? idx,
    normalized_price: normalizeServicePrice(s.price, s.price_in_cents),
    price: normalizeServicePrice(s.price, s.price_in_cents),
    price_in_cents: s.price_in_cents ?? Math.round(normalizeServicePrice(s.price, s.price_in_cents) * 100),
  }));
}

/**
 * Reordenação em lote dos serviços no Supabase.
 * Salva a nova sequência de display_order (0, 1, 2, ...) selecionada pelo gestor.
 */
export async function reorderServices(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { success: true };

  const supabase = await createClient();

  // Executa as atualizações de display_order
  const updates = orderedIds.map((id, index) =>
    supabase
      .from('services')
      .update({
        display_order: index,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
  );

  const results = await Promise.all(updates);
  const failure = results.find((r) => r.error);
  if (failure) {
    console.error('[reorderServices] Erro ao persistir nova ordenação:', failure.error);
    throw new Error(`Não foi possível salvar a nova ordem: ${failure.error.message}`);
  }

  revalidatePath('/admin/servicos');
  return { success: true };
}

export async function createService({ name, price, default_duration_minutes, category }) {
  const supabase = await createClient();
  const numPrice = Number(price || 0);
  const inReais = numPrice >= 1000 ? numPrice / 100 : numPrice;
  const inCents = Math.round(inReais * 100);

  // Obtém o maior display_order atual para inserir no final
  const { data: maxRow } = await supabase
    .from('services')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.display_order ?? -1) + 1;

  const { error } = await supabase.from('services').insert({
    name: name.trim(),
    price: inReais,
    price_in_cents: inCents,
    default_duration_minutes: Number(default_duration_minutes || 30),
    category: category || 'cabelo',
    display_order: nextOrder,
    active: true,
  });

  if (error) throw new Error(`Não foi possível criar o serviço: ${error.message}`);
  revalidatePath('/admin/servicos');
}

export async function updateService(id, { name, price, default_duration_minutes, category, display_order, active }) {
  const supabase = await createClient();
  const payload = {};

  if (name !== undefined) payload.name = name.trim();
  if (price !== undefined) {
    const numPrice = Number(price || 0);
    const inReais = numPrice >= 1000 ? numPrice / 100 : numPrice;
    payload.price = inReais;
    payload.price_in_cents = Math.round(inReais * 100);
  }
  if (default_duration_minutes !== undefined) payload.default_duration_minutes = Number(default_duration_minutes);
  if (category !== undefined) payload.category = category;
  if (display_order !== undefined) payload.display_order = Number(display_order);
  if (active !== undefined) payload.active = Boolean(active);

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