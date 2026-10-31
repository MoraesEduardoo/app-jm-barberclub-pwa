import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listSchedule, listExceptions } from '@/lib/actions/schedule';
import { dayOfWeekFromDate } from '@/lib/constants/schedule';
import { shopRange, todayInShop } from '@/lib/dates';
import {
  generateAvailableSlots,
  roundUpToNextSlot,
  extractBusyRangesFromAppointments,
} from '@/lib/slots';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, max-age=0',
};

/**
 * Resolve o tempo exato (custom_duration de barber_services ou duration_minutes padrão de services)
 * para um ou múltiplos serviços com o profissional selecionado.
 */
async function resolveDurationAndPriceForBarber(admin, barberId, serviceIds) {
  const cleanIds = Array.isArray(serviceIds)
    ? serviceIds.filter(Boolean)
    : serviceIds
    ? [serviceIds]
    : [];

  if (cleanIds.length === 0) {
    return {
      totalDurationMinutes: 30,
      totalPrice: 0,
      services: [],
    };
  }

  const [svcRes, bsRes] = await Promise.all([
    admin
      .from('services')
      .select('id, name, price, duration_minutes, default_duration_minutes')
      .in('id', cleanIds),
    barberId
      ? admin
          .from('barber_services')
          .select('*')
          .eq('barber_id', barberId)
          .in('service_id', cleanIds)
      : Promise.resolve({ data: [] }),
  ]);

  const servicesById = new Map((svcRes.data || []).map((s) => [String(s.id), s]));
  const bsByServiceId = new Map((bsRes.data || []).map((b) => [String(b.service_id), b]));

  let totalDurationMinutes = 0;
  let totalPrice = 0;
  const resolvedItems = [];

  for (const sid of cleanIds) {
    const svc = servicesById.get(String(sid));
    const bs = bsByServiceId.get(String(sid));

    const defaultDuration = Number(
      svc?.duration_minutes ?? svc?.default_duration_minutes ?? 30
    );
    const rawPrice = Number(svc?.price || 0);
    const defaultPrice = rawPrice >= 1000 ? rawPrice / 100 : rawPrice;

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

    const effectiveDuration = customDuration ?? defaultDuration;
    const effectivePrice = customPrice ?? defaultPrice;

    totalDurationMinutes += effectiveDuration;
    totalPrice = Number((totalPrice + effectivePrice).toFixed(2));

    resolvedItems.push({
      service_id: sid,
      service_name: svc?.name || null,
      custom_duration: customDuration,
      default_duration: defaultDuration,
      duration_minutes: effectiveDuration,
      custom_price: customPrice,
      default_price: defaultPrice,
      price: effectivePrice,
    });
  }

  return {
    totalDurationMinutes: totalDurationMinutes || 30,
    totalPrice,
    services: resolvedItems,
  };
}

async function computeAvailableSlots({ barberId, date, serviceIds }) {
  const admin = createAdminClient();
  const targetDate = date ? String(date).slice(0, 10) : todayInShop();
  const isToday = targetDate === todayInShop();

  // 1. Consulta barber_services (barber_id + service_id) para buscar custom_duration
  const resolved = await resolveDurationAndPriceForBarber(admin, barberId, serviceIds);
  const serviceDur = resolved.totalDurationMinutes;
  const primaryServiceId = resolved.services[0]?.service_id || null;

  // 2. Carrega expediente, exceções e RPC em paralelo
  const [scheduleRows, exceptions, rpcRes] = await Promise.all([
    listSchedule(barberId),
    listExceptions(barberId),
    barberId && resolved.services.length <= 1
      ? admin.rpc('chatbot_get_available_slots', {
          p_barber_id: barberId,
          p_date: targetDate,
          p_service_id: primaryServiceId,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const isBlockedDate =
    Array.isArray(exceptions) &&
    exceptions.some(
      (ex) =>
        String(ex.exception_date || ex.override_date || '').slice(0, 10) === targetDate &&
        !ex.start_time
    );

  if (isBlockedDate) {
    return {
      ok: true,
      barber_id: barberId,
      date: targetDate,
      is_day_off: true,
      duration_minutes: serviceDur,
      custom_duration: resolved.services[0]?.custom_duration ?? null,
      default_duration: resolved.services[0]?.default_duration ?? 30,
      price: resolved.totalPrice,
      services: resolved.services,
      slots: [],
    };
  }

  const dow = dayOfWeekFromDate(targetDate);
  const daySchedule = (scheduleRows || []).find((r) => r.day_of_week === dow) || null;
  if (!daySchedule || !daySchedule.active) {
    return {
      ok: true,
      barber_id: barberId,
      date: targetDate,
      is_day_off: true,
      duration_minutes: serviceDur,
      custom_duration: resolved.services[0]?.custom_duration ?? null,
      default_duration: resolved.services[0]?.default_duration ?? 30,
      price: resolved.totalPrice,
      services: resolved.services,
      slots: [],
    };
  }

  const { start, end } = shopRange(targetDate, targetDate);
  const { data: appts } = await admin
    .from('appointments')
    .select(
      'id, barber_id, appointment_date, appointment_time, appointment_end_time, end_time, duration_minutes, status'
    )
    .eq('barber_id', barberId)
    .or(`appointment_date.eq.${targetDate},and(appointment_date.gte.${start},appointment_date.lt.${end})`);

  const busyRanges = extractBusyRangesFromAppointments(appts || [], barberId);
  const nowFortaleza = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );

  const engineSlots = generateAvailableSlots(daySchedule, busyRanges, serviceDur, {
    nowTime: isToday ? roundUpToNextSlot(nowFortaleza) : null,
  });

  if (!rpcRes?.error && Array.isArray(rpcRes?.data) && rpcRes.data.length > 0) {
    let rpcSlots = rpcRes.data
      .map((row) => String(row.slot_time || row).slice(0, 5))
      .filter(Boolean);
    if (isToday) {
      const minSlot = roundUpToNextSlot(nowFortaleza);
      rpcSlots = rpcSlots.filter((s) => s >= minSlot);
    }
    const engineSet = new Set(engineSlots);
    const validSlots = engineSet.size > 0 ? rpcSlots.filter((s) => engineSet.has(s)) : rpcSlots;

    return {
      ok: true,
      barber_id: barberId,
      date: targetDate,
      is_day_off: false,
      duration_minutes: serviceDur,
      custom_duration: resolved.services[0]?.custom_duration ?? null,
      default_duration: resolved.services[0]?.default_duration ?? 30,
      price: resolved.totalPrice,
      services: resolved.services,
      slots: validSlots.length > 0 ? validSlots : engineSlots,
    };
  }

  return {
    ok: true,
    barber_id: barberId,
    date: targetDate,
    is_day_off: false,
    duration_minutes: serviceDur,
    custom_duration: resolved.services[0]?.custom_duration ?? null,
    default_duration: resolved.services[0]?.default_duration ?? 30,
    price: resolved.totalPrice,
    services: resolved.services,
    slots: engineSlots,
  };
}

/**
 * GET /api/appointments/slots?barber_id=...&service_id=...&date=YYYY-MM-DD
 * Endpoint público para Homepage e Chatbot consultarem os horários disponíveis
 * respeitando o `custom_duration` do profissional na tabela `barber_services`.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const barberId = searchParams.get('barber_id') || searchParams.get('barberId');
    const date = searchParams.get('date') || todayInShop();
    const serviceId = searchParams.get('service_id') || searchParams.get('serviceId');
    const serviceIdsParam = searchParams.get('service_ids') || searchParams.get('serviceIds');

    if (!barberId) {
      return NextResponse.json(
        { ok: false, error: 'Parâmetro barber_id é obrigatório.' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const serviceIds = serviceIdsParam
      ? serviceIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : serviceId
      ? [serviceId]
      : [];

    const result = await computeAvailableSlots({ barberId, date, serviceIds });
    return NextResponse.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || 'Erro ao calcular horários disponíveis.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const barberId = body?.barber_id || body?.barberId;
    const date = body?.date || todayInShop();
    const serviceIds = Array.isArray(body?.service_ids || body?.serviceIds)
      ? body.service_ids || body.serviceIds
      : body?.service_id || body?.serviceId
      ? [body.service_id || body.serviceId]
      : [];

    if (!barberId) {
      return NextResponse.json(
        { ok: false, error: 'Campo barber_id é obrigatório.' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const result = await computeAvailableSlots({ barberId, date, serviceIds });
    return NextResponse.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || 'Erro ao calcular horários disponíveis.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
