import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyNewAppointment } from '@/lib/push';
import { todayInShop } from '@/lib/dates';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, max-age=0',
};

function addMinutesToTimeStr(timeStr, minutesToAdd) {
  const parts = String(timeStr || '09:00:00').split(':').map(Number);
  const totalMin = (parts[0] || 0) * 60 + (parts[1] || 0) + (Number(minutesToAdd) || 30);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * POST /api/appointments
 * Endpoint público para Homepage e Chatbot criarem agendamentos respeitando
 * estritamente o `custom_duration` e `custom_price` da tabela `public.barber_services`
 * (ou herdando os valores padrão da tabela `public.services` caso `custom_duration` seja null).
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const barberId = body?.barber_id || body?.barberId;
    const serviceId = body?.service_id || body?.serviceId || null;
    const serviceIdsRaw = body?.service_ids || body?.serviceIds || (serviceId ? [serviceId] : []);
    const serviceIds = Array.isArray(serviceIdsRaw) ? serviceIdsRaw.filter(Boolean) : [];
    const clientName = String(body?.client_name || body?.clientName || 'Cliente').trim();
    const clientPhoneRaw = String(body?.client_phone || body?.clientPhone || '').replace(/\D/g, '');
    const date = String(body?.date || body?.appointment_date || todayInShop()).slice(0, 10);
    const timeRaw = String(body?.time || body?.appointment_time || '09:00').slice(0, 5);
    const formattedTime = `${timeRaw}:00`;
    const notes = body?.notes || 'Agendamento via Homepage / Chatbot';
    const source = body?.source || body?.origin || 'chatbot';

    if (!barberId || serviceIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Profissional (barber_id) e serviço (service_id) são obrigatórios.' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const admin = createAdminClient();

    // 1. Consulta services e barber_services (filtrando por barber_id e service_id)
    const [svcRes, bsRes] = await Promise.all([
      admin
        .from('services')
        .select('id, name, price, duration_minutes, default_duration_minutes')
        .in('id', serviceIds),
      admin
        .from('barber_services')
        .select('*')
        .eq('barber_id', barberId)
        .in('service_id', serviceIds),
    ]);

    const svcById = new Map((svcRes.data || []).map((s) => [String(s.id), s]));
    const bsByServiceId = new Map((bsRes.data || []).map((b) => [String(b.service_id), b]));

    let totalDuration = 0;
    let totalPrice = 0;
    const resolvedItems = [];

    for (const sid of serviceIds) {
      const svc = svcById.get(String(sid));
      const bs = bsByServiceId.get(String(sid));

      const defaultDur = Number(svc?.duration_minutes ?? svc?.default_duration_minutes ?? 30);
      const rawPrice = Number(svc?.price || 0);
      const defaultPrice = rawPrice >= 1000 ? rawPrice / 100 : rawPrice;

      const rawCustomDur = bs ? bs.custom_duration ?? bs.custom_duration_minutes ?? null : null;
      const customDur =
        rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0
          ? Number(rawCustomDur)
          : null;

      const rawCustomPrice = bs ? bs.custom_price : null;
      const customPrice =
        rawCustomPrice !== null && rawCustomPrice !== undefined && Number(rawCustomPrice) >= 0
          ? Number(Number(rawCustomPrice).toFixed(2))
          : null;

      const effectiveDuration = customDur ?? defaultDur;
      const effectivePrice = customPrice ?? defaultPrice;

      totalDuration += effectiveDuration;
      totalPrice = Number((totalPrice + effectivePrice).toFixed(2));

      resolvedItems.push({
        service_id: sid,
        name: svc?.name || 'Serviço',
        duration_minutes: effectiveDuration,
        price: effectivePrice,
      });
    }

    // 2. Tenta criar via RPC transacional chatbot_create_appointment e sincroniza a duração personalizada exata
    if (clientPhoneRaw.length >= 8) {
      const { data: rpcRes, error: rpcErr } = await admin.rpc('chatbot_create_appointment', {
        p_client_name: clientName,
        p_client_phone: clientPhoneRaw,
        p_barber_id: barberId,
        p_service_id: serviceIds[0],
        p_service_ids: serviceIds,
        p_date: date,
        p_time: formattedTime,
        p_duration_minutes: totalDuration,
        p_buffer_minutes: 10,
        p_notes: notes,
      });

      if (!rpcErr && rpcRes?.success) {
        const createdIds = Array.isArray(rpcRes.appointment_ids)
          ? rpcRes.appointment_ids
          : rpcRes.appointment_id
          ? [rpcRes.appointment_id]
          : [];

        // Garante que cada agendamento gravado reflita exatamente o duration_minutes e end_time personalizados
        let currentStart = formattedTime;
        for (let i = 0; i < createdIds.length; i++) {
          const apptId = createdIds[i];
          const item = resolvedItems[i] || resolvedItems[0];
          const endTime = addMinutesToTimeStr(currentStart, item.duration_minutes);
          await admin
            .from('appointments')
            .update({
              appointment_time: currentStart,
              end_time: endTime,
              duration_minutes: item.duration_minutes,
              price: item.price,
              total_price: item.price,
              source,
              origin: source,
            })
            .eq('id', apptId);
          currentStart = endTime;
        }

        if (createdIds[0]) {
          try {
            await notifyNewAppointment(createdIds[0]);
          } catch {}
        }

        return NextResponse.json(
          {
            ok: true,
            success: true,
            appointment_id: createdIds[0],
            appointment_ids: createdIds,
            date,
            start_time: timeRaw,
            end_time: addMinutesToTimeStr(formattedTime, totalDuration).slice(0, 5),
            total_duration: totalDuration,
            total_price: totalPrice,
          },
          { headers: CORS_HEADERS }
        );
      }

      if (rpcRes && rpcRes.success === false && rpcRes.code === 'SLOT_OCCUPIED') {
        return NextResponse.json(
          { ok: false, error: rpcRes.error, code: rpcRes.code },
          { status: 409, headers: CORS_HEADERS }
        );
      }
    }

    // 3. Fallback direto de inserção em public.appointments com a duração personalizada exata
    const primaryItem = resolvedItems[0];
    const endTime = addMinutesToTimeStr(formattedTime, totalDuration);

    const { data: created, error: insErr } = await admin
      .from('appointments')
      .insert({
        barber_id: barberId,
        service_id: primaryItem.service_id,
        service: resolvedItems.map((i) => i.name).join(' + '),
        client_name: clientName,
        client_phone: clientPhoneRaw || '00000000000',
        appointment_date: date,
        appointment_time: formattedTime,
        end_time: endTime,
        duration_minutes: totalDuration,
        buffer_minutes: 10,
        status: 'confirmado',
        payment_status: 'pendente',
        price: totalPrice,
        total_price: totalPrice,
        notes,
        source,
        origin: source,
      })
      .select('id')
      .single();

    if (insErr) {
      return NextResponse.json(
        { ok: false, error: insErr.message },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    try {
      await notifyNewAppointment(created.id);
    } catch {}

    return NextResponse.json(
      {
        ok: true,
        success: true,
        appointment_id: created.id,
        date,
        start_time: timeRaw,
        end_time: endTime.slice(0, 5),
        total_duration: totalDuration,
        total_price: totalPrice,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || 'Erro ao criar agendamento.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
