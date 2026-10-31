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

function parseCustomDurationValue(val) {
  if (val === undefined) return undefined;
  if (val === null || String(val).trim() === '') return null;
  const num = Math.round(Number(val));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(5, num);
}

function parseCustomPriceValue(val) {
  if (val === undefined) return undefined;
  if (val === null || String(val).trim() === '') return null;
  const parsed = Number(String(val).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

/**
 * Persiste uma linha em public.barber_services compatível tanto com a coluna
 * `custom_duration` quanto `custom_duration_minutes` e `custom_price`.
 */
async function upsertBarberServiceRow(
  supabase,
  { barber_id, service_id, is_active, custom_duration, custom_price }
) {
  if (!barber_id || !service_id) return;

  const basePayload = {
    barber_id,
    service_id,
  };

  if (is_active !== undefined) {
    basePayload.is_active = Boolean(is_active);
  }

  const cleanDur = parseCustomDurationValue(custom_duration);
  const cleanPrice = parseCustomPriceValue(custom_price);

  if (cleanPrice !== undefined) {
    basePayload.custom_price = cleanPrice;
  }

  // Se custom_duration foi informado (incluindo null para limpar e herdar de services)
  if (cleanDur !== undefined) {
    const withBothColumns = {
      ...basePayload,
      custom_duration: cleanDur,
      custom_duration_minutes: cleanDur,
    };

    const { error: errBoth } = await supabase
      .from('barber_services')
      .upsert(withBothColumns, { onConflict: 'barber_id,service_id' });

    if (!errBoth) return;

    // Fallback se a coluna custom_duration ainda não existir fisicamente no banco live
    const { error: errFallback } = await supabase
      .from('barber_services')
      .upsert(
        {
          ...basePayload,
          custom_duration_minutes: cleanDur,
        },
        { onConflict: 'barber_id,service_id' }
      );

    if (errFallback) {
      console.warn('[upsertBarberServiceRow] Aviso ao gravar barber_services:', errFallback.message);
    }
    return;
  }

  const { error } = await supabase
    .from('barber_services')
    .upsert(basePayload, { onConflict: 'barber_id,service_id' });

  if (error) {
    console.warn('[upsertBarberServiceRow] Aviso ao atualizar vínculo:', error.message);
  }
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
 * Consulta diretamente na tabela `barber_services` (filtrando por barber_id e service_id)
 * o tempo personalizado (`custom_duration`) e o preço personalizado (`custom_price`).
 * Caso seja null ou não exista, herda automaticamente o tempo e preço padrão de `services`.
 */
export async function getBarberServiceConfig(barberId, serviceId) {
  if (!serviceId) return null;
  const admin = createAdminClient();

  const [svcRes, bsRes] = await Promise.all([
    admin
      .from('services')
      .select('id, name, price, price_in_cents, duration_minutes, default_duration_minutes, is_active, active')
      .eq('id', serviceId)
      .maybeSingle(),
    barberId
      ? admin
          .from('barber_services')
          .select('*')
          .eq('barber_id', barberId)
          .eq('service_id', serviceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const svc = svcRes?.data;
  if (!svc) return null;

  const defaultDuration = Number(svc.default_duration_minutes ?? svc.duration_minutes ?? 30);
  const defaultPrice = normalizeServicePrice(svc.price, svc.price_in_cents);

  const bs = bsRes?.data;
  const rawCustomDur = bs ? bs.custom_duration ?? bs.custom_duration_minutes ?? null : null;
  const customDuration =
    rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0
      ? Number(rawCustomDur)
      : null;

  const rawCustomPrice = bs ? bs.custom_price : null;
  const customPrice =
    rawCustomPrice !== null && rawCustomPrice !== undefined && Number(rawCustomPrice) >= 0
      ? Number(Number(rawCustomPrice).toFixed(2))
      : null;

  return {
    service_id: svc.id,
    barber_id: barberId || null,
    service_name: svc.name,
    is_active: bs ? bs.is_active !== false : true,
    custom_duration: customDuration,
    custom_duration_minutes: customDuration,
    custom_price: customPrice,
    default_duration: defaultDuration,
    default_price: defaultPrice,
    effective_duration: customDuration ?? defaultDuration,
    effective_price: customPrice ?? defaultPrice,
  };
}

/**
 * Lista todos os serviços do catálogo da barbearia,
 * enriquecendo com as fotos do storage/galeria, o mapeamento de barbeiros responsáveis
 * e os tempos/preços personalizados por profissional (`barber_services`).
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

  // 2. Busca barbeiros e todas as linhas de barber_services (incluindo custom_duration e custom_price)
  let barbersList = [];
  let barberServices = [];
  try {
    const [bRes, bsRes] = await Promise.all([
      admin
        .from('barbers')
        .select('id, name, role, active, is_active, display_order')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true }),
      admin.from('barber_services').select('*'),
    ]);
    barbersList = (bRes.data || []).filter((b) => b.active !== false && b.is_active !== false);
    barberServices = bsRes.data || [];
  } catch (err) {
    console.warn('[listServices] Aviso ao buscar barbeiros e barber_services:', err?.message);
  }

  return (servicesData || []).map((s, idx) => {
    const img = s.image_url || s.storage_url || s.photo_url || null;

    const allServiceBs = barberServices.filter((bs) => bs.service_id === s.id);
    const activeServiceBs = allServiceBs.filter((bs) => bs.is_active !== false);
    const assignedBarberIds = activeServiceBs.map((bs) => bs.barber_id);

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

    const durationMin = Number(s.default_duration_minutes ?? s.duration_minutes ?? 30);
    const normalizedPrice = normalizeServicePrice(s.price, s.price_in_cents);
    const isActive = s.active !== undefined ? Boolean(s.active) : Boolean(s.is_active ?? true);

    // Mapeia configurações específicas de cada profissional (Matheus, William, etc.)
    const barberConfigs = barbersList.map((b) => {
      const bsRow = allServiceBs.find((bs) => String(bs.barber_id) === String(b.id));
      const rawCustomDur = bsRow ? bsRow.custom_duration ?? bsRow.custom_duration_minutes ?? null : null;
      const customDur =
        rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0
          ? Number(rawCustomDur)
          : null;

      const rawCustomPrice = bsRow ? bsRow.custom_price : null;
      const customPrice =
        rawCustomPrice !== null && rawCustomPrice !== undefined && Number(rawCustomPrice) >= 0
          ? Number(Number(rawCustomPrice).toFixed(2))
          : null;

      const isBarberActive = bsRow
        ? bsRow.is_active !== false
        : targetBarberId
        ? String(targetBarberId) === String(b.id)
        : true;

      return {
        barber_id: b.id,
        barber_name: b.name,
        is_active: isBarberActive,
        custom_duration: customDur,
        custom_duration_minutes: customDur,
        custom_price: customPrice,
        effective_duration: customDur ?? durationMin,
        effective_price: customPrice ?? normalizedPrice,
      };
    });

    const barberDurationsMap = {};
    for (const cfg of barberConfigs) {
      barberDurationsMap[cfg.barber_id] = cfg;
    }

    return {
      ...s,
      active: isActive,
      is_active: isActive,
      duration_minutes: durationMin,
      default_duration_minutes: durationMin,
      image_url: img || null,
      display_order: s.display_order ?? idx,
      normalized_price: normalizedPrice,
      price: normalizedPrice,
      price_in_cents: s.price_in_cents ?? Math.round(normalizedPrice * 100),
      barber_id: targetBarberId,
      assigned_barber_id: targetBarberId,
      assigned_barber_name: assignedBarber ? assignedBarber.name : null,
      is_all_barbers: isAllBarbers,
      barber_configs: barberConfigs,
      barber_durations: barberDurationsMap,
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
 * Criação de novo serviço com suporte a atribuição de barbeiro e durações personalizadas por profissional.
 */
export async function createService({
  name,
  price,
  default_duration_minutes,
  duration_minutes,
  category,
  image_url,
  barber_id = null,
  barber_durations = null,
}) {
  const admin = createAdminClient();
  const numPrice = Number(price || 0);
  const inReais = numPrice >= 1000 ? numPrice / 100 : numPrice;
  const inCents = Math.round(inReais * 100);
  const dur = Math.max(10, Number(default_duration_minutes ?? duration_minutes ?? 30));

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
    duration_minutes: dur,
    default_duration_minutes: dur,
    category: category || 'cabelo',
    display_order: nextOrder,
    is_active: true,
    active: true,
  };

  if (image_url) payload.image_url = image_url;
  const chosenBarberId = barber_id && barber_id !== 'all' ? barber_id : null;

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
    // fallback sem barber_id
  }

  if (!created) {
    const { data, error } = await admin.from('services').insert(payload).select().single();
    if (error) throw new Error(`Não foi possível criar o serviço: ${error.message}`);
    created = data;
  }

  if (created?.id) {
    await syncBarberServicesRelation(admin, created.id, chosenBarberId, barber_durations);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/equipe');
  revalidatePath('/admin/agenda');
  return created;
}

/**
 * Atualização de serviço existente com suporte a atribuição de barbeiro e durações personalizadas por profissional.
 */
export async function updateService(
  id,
  {
    name,
    price,
    default_duration_minutes,
    duration_minutes,
    category,
    display_order,
    active,
    is_active,
    image_url,
    barber_id,
    barber_durations,
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
  const durVal = default_duration_minutes ?? duration_minutes;
  if (durVal !== undefined) {
    const cleanDur = Math.max(10, Number(durVal));
    payload.duration_minutes = cleanDur;
    payload.default_duration_minutes = cleanDur;
  }
  if (category !== undefined) payload.category = category;
  if (display_order !== undefined) payload.display_order = Number(display_order);
  const activeVal = active ?? is_active;
  if (activeVal !== undefined) {
    payload.active = Boolean(activeVal);
    payload.is_active = Boolean(activeVal);
  }
  if (image_url !== undefined) payload.image_url = image_url;

  const chosenBarberId =
    barber_id !== undefined ? (barber_id && barber_id !== 'all' ? barber_id : null) : undefined;

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

  if (chosenBarberId !== undefined || barber_durations !== undefined) {
    await syncBarberServicesRelation(admin, id, chosenBarberId, barber_durations);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/equipe');
  revalidatePath('/admin/agenda');
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
  revalidatePath('/admin/equipe');
}

/**
 * Sincroniza a tabela associativa barber_services preservando ou atualizando
 * `custom_duration` / `custom_duration_minutes` e `custom_price` por profissional.
 */
async function syncBarberServicesRelation(
  supabase,
  serviceId,
  specificBarberId,
  barberDurations = null
) {
  try {
    const { data: allBarbers } = await supabase
      .from('barbers')
      .select('id, active, is_active');

    const activeBarbers = (allBarbers || []).filter(
      (b) => b.active !== false && b.is_active !== false
    );
    if (activeBarbers.length === 0) return;

    for (const b of activeBarbers) {
      const customCfg =
        barberDurations && typeof barberDurations === 'object'
          ? barberDurations[b.id]
          : undefined;

      let isActiveForBarber = true;
      if (specificBarberId !== undefined) {
        isActiveForBarber = specificBarberId ? String(b.id) === String(specificBarberId) : true;
      }
      if (customCfg && typeof customCfg === 'object' && customCfg.is_active !== undefined) {
        isActiveForBarber = Boolean(customCfg.is_active);
      }

      const customDurationArg =
        customCfg !== undefined
          ? typeof customCfg === 'object'
            ? customCfg.custom_duration
            : customCfg
          : undefined;

      const customPriceArg =
        customCfg && typeof customCfg === 'object' ? customCfg.custom_price : undefined;

      await upsertBarberServiceRow(supabase, {
        barber_id: b.id,
        service_id: serviceId,
        is_active: isActiveForBarber,
        custom_duration: customDurationArg,
        custom_price: customPriceArg,
      });
    }
  } catch (err) {
    console.warn('[syncBarberServicesRelation] Aviso ao sincronizar relação:', err?.message);
  }
}