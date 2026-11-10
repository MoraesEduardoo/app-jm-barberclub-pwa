import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/services
 * Endpoint público consumido pela Homepage e pelo Chatbot oficial da JM Barberclub.
 * Suporta filtro opcional `?barber_id=<uuid>` e `?service_id=<uuid>` para retornar
 * automaticamente o `custom_duration` e `custom_price` da tabela `public.barber_services`
 * (ou herdar o tempo/preço padrão da tabela `public.services` caso `custom_duration` seja null).
 */
function resolveServiceOrder(row, fallback = 9999) {
  const candidates = [row?.ordem, row?.position, row?.display_order];
  for (const val of candidates) {
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) return Math.round(num);
    }
  }
  for (const val of candidates) {
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      const num = Number(val);
      if (Number.isFinite(num)) return Math.round(num);
    }
  }
  return fallback;
}

async function queryServicesOrdered(admin) {
  // 1ª tentativa: ORDER BY ordem ASC, name ASC (padrão canônico v2.8)
  const primary = await admin
    .from('services')
    .select('*')
    .order('ordem', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (!primary.error) return primary;

  // 2ª tentativa: ORDER BY display_order ASC, name ASC
  const secondary = await admin
    .from('services')
    .select('*')
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (!secondary.error) return secondary;

  return admin.from('services').select('*');
}

export async function GET(request) {
  try {
    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);
    const barberIdParam = searchParams.get('barber_id') || searchParams.get('barberId') || null;
    const serviceIdParam = searchParams.get('service_id') || searchParams.get('serviceId') || null;

    // 1. Busca serviços (ORDER BY ordem ASC), barbeiros e a tabela barber_services em paralelo
    const [servicesRes, barbersRes, bsRes] = await Promise.all([
      queryServicesOrdered(admin),
      admin.from('barbers').select('*'),
      admin.from('barber_services').select('*'),
    ]);

    if (servicesRes.error) {
      return NextResponse.json({ ok: false, error: servicesRes.error.message, data: [] }, { status: 200 });
    }

    const services = [...(servicesRes.data || [])].sort((a, b) => {
      const orderA = resolveServiceOrder(a, 9999);
      const orderB = resolveServiceOrder(b, 9999);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR');
    });

    const barbers = [...(barbersRes.data || [])]
      .filter((b) => b.active !== false && b.is_active !== false)
      .sort((a, b) => {
        const orderA = Number.isFinite(Number(a?.display_order)) ? Number(a.display_order) : 9999;
        const orderB = Number.isFinite(Number(b?.display_order)) ? Number(b.display_order) : 9999;
        if (orderA !== orderB) return orderA - orderB;
        return String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR');
      });
    const barberServices = bsRes.data || [];

    // 2. Busca galeria para fallback de fotos
    let gallery = [];
    try {
      const { data: gData } = await admin
        .from('haircut_gallery')
        .select('*')
        .eq('is_active', true);
      gallery = gData || [];
    } catch {
      // fallback
    }

    const formatted = services.map((s, idx) => {
      let img = s.image_url || s.storage_url || null;
      const seqOrder = resolveServiceOrder(s, idx + 1);

      if (!img && gallery.length > 0) {
        const match = gallery.find((g) => {
          if (!g.title) return false;
          const gT = g.title.toLowerCase();
          const sN = s.name.toLowerCase();
          return (
            gT === sN ||
            gT.includes(sN) ||
            sN.includes(gT) ||
            (sN.includes('degradê') && gT.includes('degradê')) ||
            (sN.includes('lowfade') && gT.includes('lowfade')) ||
            (sN.includes('barboterapia') && gT.includes('barboterapia'))
          );
        });
        if (match) {
          img = match.image_url || match.storage_url;
        }
      }

      const numPrice = Number(s.price || 0);
      const defaultPrice = Number((numPrice >= 1000 ? numPrice / 100 : numPrice).toFixed(2));
      const defaultDuration = Number(s.default_duration_minutes ?? s.duration_minutes ?? 30);

      // Mapeia tempos e preços personalizados por profissional na tabela barber_services
      const serviceBsRows = barberServices.filter(
        (bs) => String(bs.service_id) === String(s.id)
      );

      const barberConfigs = barbers.map((b) => {
        const row = serviceBsRows.find((bs) => String(bs.barber_id) === String(b.id));
        const rawCustomDur = row
          ? row.custom_duration ?? row.custom_duration_minutes ?? null
          : null;
        const customDur =
          rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0
            ? Number(rawCustomDur)
            : null;

        const rawCustomPrice = row ? row.custom_price : null;
        const customPrice =
          rawCustomPrice !== null && rawCustomPrice !== undefined && Number(rawCustomPrice) >= 0
            ? Number(Number(rawCustomPrice).toFixed(2))
            : null;

        const isBarberActive = row
          ? row.is_active !== false
          : s.barber_id
          ? String(s.barber_id) === String(b.id)
          : true;

        return {
          barber_id: b.id,
          barber_name: b.name,
          is_active: isBarberActive,
          custom_duration: customDur,
          custom_duration_minutes: customDur,
          custom_price: customPrice,
          effective_duration: customDur ?? defaultDuration,
          effective_price: customPrice ?? defaultPrice,
        };
      });

      const barberDurationsMap = {};
      for (const cfg of barberConfigs) {
        barberDurationsMap[cfg.barber_id] = cfg;
      }

      // Se um barber_id específico foi informado na query, resolve a duração e o preço exatos daquele profissional
      const selectedBarberCfg = barberIdParam ? barberDurationsMap[barberIdParam] : null;
      const resolvedDuration = selectedBarberCfg
        ? selectedBarberCfg.effective_duration
        : defaultDuration;
      const resolvedPrice = selectedBarberCfg
        ? selectedBarberCfg.effective_price
        : defaultPrice;
      const isAvailableForSelectedBarber = selectedBarberCfg
        ? selectedBarberCfg.is_active !== false
        : true;

      return {
        id: s.id,
        name: s.name,
        description: s.description || null,
        category: s.category || 'corte',
        ordem: seqOrder,
        position: seqOrder,
        display_order: seqOrder,
        price: resolvedPrice,
        default_price: defaultPrice,
        custom_price: selectedBarberCfg ? selectedBarberCfg.custom_price : null,
        price_in_cents: Math.round(resolvedPrice * 100),
        duration_minutes: resolvedDuration,
        default_duration_minutes: defaultDuration,
        custom_duration: selectedBarberCfg ? selectedBarberCfg.custom_duration : null,
        image_url: img,
        is_active:
          s.is_active !== false && s.active !== false && isAvailableForSelectedBarber,
        barber_services: barberConfigs,
        barber_durations: barberDurationsMap,
      };
    });

    let activeServices = formatted.filter((s) => s.is_active);
    if (serviceIdParam) {
      activeServices = activeServices.filter((s) => String(s.id) === String(serviceIdParam));
    }

    return NextResponse.json(
      {
        ok: true,
        barber_id: barberIdParam,
        count: activeServices.length,
        data: activeServices,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
