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

/**
 * Retorna o cliente Supabase adequado com fallback para Admin se a sessão do usuário falhar.
 */
async function getServicesSupabaseClient() {
  try {
    const client = await createClient();
    return client;
  } catch {
    return createAdminClient();
  }
}

/**
 * Lista todos os serviços do catálogo da barbearia,
 * enriquecendo com as fotos do storage/galeria e o mapeamento de barbeiros responsáveis.
 */
export async function listServices() {
  const supabase = await getServicesSupabaseClient();
  const admin = createAdminClient();

  // 1. Busca todos os serviços (com fallback para admin se RLS retornar vazio)
  let servicesData = null;
  const { data: sData, error: sErr } = await supabase
    .from('services')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (sErr || !sData || sData.length === 0) {
    // Fallback defensivo com createAdminClient()
    try {
      const { data: adminData } = await admin
        .from('services')
        .select('*')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });
      if (adminData && adminData.length > 0) {
        servicesData = adminData;
      }
    } catch (err) {
      console.warn('[listServices] Erro ao buscar via admin client:', err);
    }
  } else {
    servicesData = sData;
  }

  // 2. Busca barbeiros e associações em barber_services para saber quem atende cada serviço
  let barbersList = [];
  let barberServices = [];
  try {
    const [bRes, bsRes] = await Promise.all([
      admin.from('barbers').select('id, name, active').eq('active', true),
      admin.from('barber_services').select('service_id, barber_id, is_active').eq('is_active', true),
    ]);
    barbersList = bRes.data || [];
    barberServices = bsRes.data || [];
  } catch (err) {
    console.warn('[listServices] Aviso ao buscar barbeiros e barber_services:', err?.message);
  }

  // 3. Busca fotos da galeria para enriquecer serviços que ainda não tenham image_url direto
  let galleryItems = [];
  try {
    const { data: gData } = await admin
      .from('haircut_gallery')
      .select('id, title, category, image_url, storage_url, image_path')
      .eq('is_active', true);
    galleryItems = gData || [];
  } catch {
    // fallback se a tabela ainda não estiver pronta
  }

  return (servicesData || []).map((s, idx) => {
    // Tenta usar a foto direta do serviço
    let img = s.image_url || s.storage_url || s.photo_url || null;

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

    // Identifica profissionais atribuídos
    const assignedBs = barberServices.filter((bs) => bs.service_id === s.id);
    const assignedBarberIds = assignedBs.map((bs) => bs.barber_id);

    // Se s.barber_id estiver preenchido, o serviço é exclusivo daquele profissional.
    // Ou se apenas 1 barbeiro estiver em barber_services e a equipe tiver mais profissionais.
    let targetBarberId = s.barber_id || null;
    if (!targetBarberId && assignedBarberIds.length === 1 && barbersList.length > 1) {
      targetBarberId = assignedBarberIds[0];
    }

    const assignedBarber = targetBarberId
      ? barbersList.find((b) => b.id === targetBarberId)
      : null;

    const isAllBarbers =
      !targetBarberId ||
      assignedBarberIds.length >= barbersList.length ||
      assignedBarberIds.length === 0;

    return {
      ...s,
      image_url: img || null,
      display_order: s.display_order ?? idx,
      normalized_price: normalizeServicePrice(s.price, s.price_in_cents),
      price: normalizeServicePrice(s.price, s.price_in_cents),
      price_in_cents:
        s.price_in_cents ?? Math.round(normalizeServicePrice(s.price, s.price_in_cents) * 100),
      barber_id: targetBarberId,
      assigned_barber_id: targetBarberId,
      assigned_barber_name: assignedBarber ? assignedBarber.name : null,
      is_all_barbers: isAllBarbers,
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

  const admin = createAdminClient();

  const updates = orderedIds.map((id, index) =>
    admin
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

/**
 * Criação de novo serviço com suporte a atribuição de barbeiro específico ou toda a equipe.
 */
export async function createService({
  name,
  price,
  default_duration_minutes,
  category,
  image_url,
  barber_id = null,
}) {
  const admin = createAdminClient();
  const numPrice = Number(price || 0);
  const inReais = numPrice >= 1000 ? numPrice / 100 : numPrice;
  const inCents = Math.round(inReais * 100);

  const { data: maxRow } = await admin
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
  const chosenBarberId = barber_id && barber_id !== 'all' ? barber_id : null;

  // Tenta salvar com barber_id se a coluna já existir na tabela services
  let created = null;
  try {
    const { data, error } = await admin
      .from('services')
      .insert({ ...payload, barber_id: chosenBarberId })
      .select()
      .single();

    if (!error && data) {
      created = data;
    }
  } catch {
    // Se a coluna barber_id não existir ainda no banco, faz fallback limpo sem ela
  }

  if (!created) {
    const { data, error } = await admin.from('services').insert(payload).select().single();
    if (error) throw new Error(`Não foi possível criar o serviço: ${error.message}`);
    created = data;
  }

  // Sincroniza a tabela associativa barber_services
  if (created?.id) {
    await syncBarberServicesRelation(admin, created.id, chosenBarberId);
  }

  revalidatePath('/admin/servicos');
  return created;
}

/**
 * Atualização de serviço existente com suporte a atribuição de barbeiro específico ou toda a equipe.
 */
export async function updateService(
  id,
  {
    name,
    price,
    default_duration_minutes,
    category,
    display_order,
    active,
    image_url,
    barber_id,
  }
) {
  const admin = createAdminClient();
  const payload = {};

  if (name !== undefined) payload.name = name.trim();
  if (price !== undefined) {
    const numPrice = Number(price || 0);
    const inReais = numPrice >= 1000 ? numPrice / 100 : numPrice;
    payload.price = inReais;
    payload.price_in_cents = Math.round(inReais * 100);
  }
  if (default_duration_minutes !== undefined)
    payload.default_duration_minutes = Number(default_duration_minutes);
  if (category !== undefined) payload.category = category;
  if (display_order !== undefined) payload.display_order = Number(display_order);
  if (active !== undefined) payload.active = Boolean(active);
  if (image_url !== undefined) payload.image_url = image_url;

  const chosenBarberId =
    barber_id !== undefined ? (barber_id && barber_id !== 'all' ? barber_id : null) : undefined;

  // 1. Tenta atualizar com barber_id
  let updateSuccess = false;
  if (chosenBarberId !== undefined) {
    try {
      const { error } = await admin
        .from('services')
        .update({ ...payload, barber_id: chosenBarberId, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (!error) updateSuccess = true;
    } catch {
      // fallback se a coluna barber_id não existir
    }
  }

  if (!updateSuccess) {
    const { error } = await admin
      .from('services')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`Não foi possível atualizar o serviço: ${error.message}`);
  }

  // 2. Sincroniza a tabela associativa barber_services
  if (chosenBarberId !== undefined) {
    await syncBarberServicesRelation(admin, id, chosenBarberId);
  }

  revalidatePath('/admin/servicos');
}

/**
 * Remove um serviço e suas associações com segurança.
 */
export async function deleteService(id) {
  const admin = createAdminClient();
  try {
    await admin.from('barber_services').delete().eq('service_id', id);
  } catch {}

  const { error } = await admin.from('services').delete().eq('id', id);
  if (error) throw new Error(`Não foi possível remover o serviço: ${error.message}`);
  revalidatePath('/admin/servicos');
}

/**
 * Helper interno para sincronizar a tabela associativa barber_services
 */
async function syncBarberServicesRelation(supabase, serviceId, specificBarberId) {
  try {
    const { data: allBarbers } = await supabase
      .from('barbers')
      .select('id')
      .eq('active', true);

    if (!allBarbers || allBarbers.length === 0) return;

    if (specificBarberId) {
      // Ativa apenas para o barbeiro específico e desativa/remove para os outros
      for (const b of allBarbers) {
        const isTarget = b.id === specificBarberId;
        await supabase
          .from('barber_services')
          .upsert(
            {
              barber_id: b.id,
              service_id: serviceId,
              is_active: isTarget,
            },
            { onConflict: 'barber_id,service_id' }
          );
      }
    } else {
      // Habilita para todos os barbeiros da barbearia
      for (const b of allBarbers) {
        await supabase
          .from('barber_services')
          .upsert(
            {
              barber_id: b.id,
              service_id: serviceId,
              is_active: true,
            },
            { onConflict: 'barber_id,service_id' }
          );
      }
    }
  } catch (err) {
    console.warn('[syncBarberServicesRelation] Aviso ao sincronizar relação:', err?.message);
  }
}