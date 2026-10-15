'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { GALLERY_BUCKET } from '@/lib/constants/gallery';
import { galleryPublicUrl } from '@/lib/gallery-url';

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

  // 1. Busca todos os serviços
  const { data: servicesData, error } = await supabase
    .from('services')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(`Não foi possível carregar os serviços: ${error.message}`);

  // 2. Busca fotos da galeria para enriquecer serviços que ainda não tenham image_url direto
  let galleryItems = [];
  try {
    const { data: gData } = await supabase
      .from('haircut_gallery')
      .select('id, title, category, image_url, storage_url, image_path')
      .eq('is_active', true);
    galleryItems = gData || [];
  } catch {
    // fallback se a tabela ainda não estiver pronta
  }

  return (servicesData || []).map((s, idx) => {
    // Tenta usar a foto direta do serviço
    let img = s.image_url || s.storage_url || null;

    // Se não tiver foto direta, busca na galeria pelo título ou similaridade
    if (!img && galleryItems.length > 0) {
      const match = galleryItems.find((g) => {
        if (!g.title) return false;
        const gTitle = g.title.toLowerCase();
        const sName = s.name.toLowerCase();
        return (
          gTitle === sName ||
          gTitle.includes(sName) ||
          sName.includes(gTitle) ||
          (sName.includes('degradê') && gTitle.includes('degradê')) ||
          (sName.includes('lowfade') && gTitle.includes('lowfade')) ||
          (sName.includes('barboterapia') && gTitle.includes('barboterapia')) ||
          (sName.includes('tesoura') && gTitle.includes('tesour'))
        );
      });

      if (match) {
        img = match.image_url || match.storage_url || galleryPublicUrl(match.image_path);
      }
    }

    return {
      ...s,
      image_url: img || null,
      display_order: s.display_order ?? idx,
      normalized_price: normalizeServicePrice(s.price, s.price_in_cents),
      price: normalizeServicePrice(s.price, s.price_in_cents),
      price_in_cents: s.price_in_cents ?? Math.round(normalizeServicePrice(s.price, s.price_in_cents) * 100),
    };
  });
}

/**
 * Upload de Foto Ilustrativa para o Serviço (exibida no Chatbot do Cliente)
 */
export async function uploadServicePhoto(serviceId, formData) {
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new Error('Nenhum arquivo enviado.');
  }

  const admin = createAdminClient();
  const fileExt = file.name?.split('.').pop()?.toLowerCase() || 'webp';
  const filePath = `services/${serviceId}-${randomUUID()}.${fileExt}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload no bucket do Supabase Storage
  const { error: uploadError } = await admin.storage
    .from(GALLERY_BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type || 'image/webp',
      upsert: true,
    });

  if (uploadError) {
    console.error('[uploadServicePhoto] Erro de upload:', uploadError);
    throw new Error(`Falha no upload da foto: ${uploadError.message}`);
  }

  const { data: pubData } = admin.storage.from(GALLERY_BUCKET).getPublicUrl(filePath);
  const publicUrl = pubData?.publicUrl || galleryPublicUrl(filePath);

  // 1. Atualiza diretamente o serviço
  try {
    await admin
      .from('services')
      .update({
        image_url: publicUrl,
        image_path: filePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', serviceId);
  } catch (err) {
    console.warn('[uploadServicePhoto] Aviso ao atualizar image_url em services:', err?.message);
  }

  // 2. Garante sincronia com haircut_gallery para manter catálogo e portfolio unificados
  try {
    const { data: svc } = await admin.from('services').select('name, category').eq('id', serviceId).maybeSingle();
    await admin.from('haircut_gallery').insert({
      title: svc?.name || 'Serviço JM Barberclub',
      category: svc?.category || 'corte',
      image_url: publicUrl,
      storage_url: publicUrl,
      image_path: filePath,
      is_active: true,
    });
  } catch {
    // fallback
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/galeria');
  return { success: true, imageUrl: publicUrl, filePath };
}

/**
 * Remove a foto ilustrativa do serviço
 */
export async function removeServicePhoto(serviceId) {
  const admin = createAdminClient();
  try {
    await admin
      .from('services')
      .update({
        image_url: null,
        image_path: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', serviceId);
  } catch (err) {
    console.error('[removeServicePhoto] Erro:', err);
  }

  revalidatePath('/admin/servicos');
  return { success: true };
}

/**
 * Reordenação em lote dos serviços no Supabase.
 */
export async function reorderServices(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { success: true };

  const supabase = await createClient();

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

export async function createService({ name, price, default_duration_minutes, category, image_url }) {
  const supabase = await createClient();
  const numPrice = Number(price || 0);
  const inReais = numPrice >= 1000 ? numPrice / 100 : numPrice;
  const inCents = Math.round(inReais * 100);

  const { data: maxRow } = await supabase
    .from('services')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.display_order ?? -1) + 1;

  const payload = {
    name: name.trim(),
    price: inReais,
    price_in_cents: inCents,
    default_duration_minutes: Number(default_duration_minutes || 30),
    category: category || 'cabelo',
    display_order: nextOrder,
    active: true,
  };

  if (image_url) payload.image_url = image_url;

  const { data, error } = await supabase.from('services').insert(payload).select().single();

  if (error) throw new Error(`Não foi possível criar o serviço: ${error.message}`);
  revalidatePath('/admin/servicos');
  return data;
}

export async function updateService(id, { name, price, default_duration_minutes, category, display_order, active, image_url }) {
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
  if (image_url !== undefined) payload.image_url = image_url;

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