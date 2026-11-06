import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyNewAppointment } from '@/lib/push';
import { todayInShop } from '@/lib/dates';
import { listAppointmentsByDate } from '@/lib/actions/appointments';

export const dynamic = 'force-dynamic';

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
 * Identifica se um erro do PostgreSQL/Supabase ou resposta da RPC representa
 * colisão de horário / violação de unicidade (`SQLSTATE 23505` / `idx_appointments_unique_active_slot`).
 */
function isSlotConflict(payloadOrErr) {
  if (!payloadOrErr) return false;
  const code = String(payloadOrErr.code || payloadOrErr.sqlstate || '').toUpperCase();
  const msg = String(
    payloadOrErr.error || payloadOrErr.message || payloadOrErr.details || ''
  ).toUpperCase();

  return (
    code === 'SLOT_ALREADY_BOOKED' ||
    code === 'SLOT_OCCUPIED' ||
    code === '23505' ||
    code === '23P01' ||
    msg.includes('CONFLITO_HORARIO') ||
    msg.includes('IDX_APPOINTMENTS_UNIQUE_ACTIVE_SLOT') ||
    msg.includes('DUPLICATE KEY') ||
    msg.includes('OCUPADO') ||
    msg.includes('PREENCHIDO')
  );
}

/**
 * GET /api/appointments?date=YYYY-MM-DD&barber_id=<uuid>
 * Também suporta `?action=available_slots&barber_id=<uuid>&date=YYYY-MM-DD&service_id=<uuid>`
 * para consulta rápida em milissegundos pelo Chatbot.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || searchParams.get('mode') || null;
    const date = searchParams.get('date') || todayInShop();
    const rawBarberId = searchParams.get('barber_id') || searchParams.get('barberId') || null;
    const serviceId = searchParams.get('service_id') || searchParams.get('serviceId') || null;

    // Modo dedicado de consulta de slots disponíveis em milissegundos (Chatbot / Público)
    if (action === 'available_slots' && rawBarberId) {
      const admin = createAdminClient();
      const { data: slotsData, error: slotsErr } = await admin.rpc(
        'chatbot_get_available_slots',
        {
          p_barber_id: rawBarberId,
          p_date: String(date).slice(0, 10),
          p_service_id: serviceId || null,
        }
      );

      if (slotsErr) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SLOTS_QUERY_ERROR',
            error: slotsErr.message,
            slots: [],
          },
          { status: 500, headers: CORS_HEADERS }
        );
      }

      const slots = (slotsData || []).map((row) =>
        typeof row === 'string' ? row : row.slot_time
      );

      return NextResponse.json(
        {
          ok: true,
          success: true,
          barber_id: rawBarberId,
          date: String(date).slice(0, 10),
          service_id: serviceId,
          slots,
        },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const scopeBarberId =
      rawBarberId && rawBarberId !== 'all' && rawBarberId !== 'null' ? rawBarberId : null;

    const res = await listAppointmentsByDate(date, scopeBarberId);
    if (res?.error) {
      return NextResponse.json(
        { ok: false, error: res.error, data: [] },
        { status: res.error === 'AUTH_EXPIRED' ? 401 : 200, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      { ok: true, date, data: Array.isArray(res?.data) ? res.data : [] },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Erro ao buscar agendamentos.', data: [] },
      { status: 200, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /api/appointments
 * Endpoint transacional de alta concorrência para o Chatbot e Homepage criarem agendamentos
 * respeitando `custom_duration` e `custom_price` da tabela `public.barber_services`,
 * com bloqueios pessimistas (`SELECT ... FOR UPDATE` + `pg_advisory_xact_lock`) e captura
 * limpa de `SQLSTATE 23505` retornando `code: 'SLOT_ALREADY_BOOKED'` (HTTP 409).
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
    const notes = body?.notes || 'Agendamento via WhatsApp Chatbot';
    const source = body?.source || body?.origin || 'chatbot';

    if (!barberId || serviceIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: 'MISSING_PARAMETERS',
          error: 'Profissional (barber_id) e serviço (service_id) são obrigatórios.',
          message: 'Profissional (barber_id) e serviço (service_id) são obrigatórios.',
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const admin = createAdminClient();

    // 1. Consulta paralela leve de services e barber_services (Index-Only Scan)
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

    // 2. Executa a RPC transacional atômica `chatbot_create_appointment`
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
        p_buffer_minutes: 0,
        p_notes: notes,
      });

      // 2.1. Tratamento imediato de conflito de concorrência (SQLSTATE 23505 / SLOT_ALREADY_BOOKED)
      if (isSlotConflict(rpcErr) || (rpcRes && rpcRes.success === false && isSlotConflict(rpcRes))) {
        const conflictMsg =
          rpcRes?.message ||
          rpcRes?.error ||
          'Este horário acabou de ser reservado por outro cliente. Por favor, escolha outro horário disponível.';
        return NextResponse.json(
          {
            ok: false,
            success: false,
            code: 'SLOT_ALREADY_BOOKED',
            sqlstate: '23505',
            error: conflictMsg,
            message: conflictMsg,
          },
          { status: 409, headers: CORS_HEADERS }
        );
      }

      // 2.2. Tratamento de outras rejeições de regra de negócio da RPC (ex: BARBER_ON_LEAVE, BARBER_INACTIVE, INVALID_PHONE)
      //      Não permite cair no fallback de inserção direta!
      if (rpcRes && rpcRes.success === false) {
        const businessCode = rpcRes.code || 'BOOKING_REJECTED';
        const businessMsg =
          rpcRes.message || rpcRes.error || 'Não foi possível confirmar este horário.';
        return NextResponse.json(
          {
            ok: false,
            success: false,
            code: businessCode,
            error: businessMsg,
            message: businessMsg,
          },
          { status: 422, headers: CORS_HEADERS }
        );
      }

      // 2.3. Sucesso atômico via RPC
      if (!rpcErr && rpcRes?.success) {
        const createdIds = Array.isArray(rpcRes.appointment_ids)
          ? rpcRes.appointment_ids
          : rpcRes.appointment_id
          ? [rpcRes.appointment_id]
          : [];

        // Notificação Push assíncrona (best-effort)
        if (createdIds[0]) {
          try {
            await notifyNewAppointment(createdIds[0]);
          } catch {}
        }

        return NextResponse.json(
          {
            ok: true,
            success: true,
            code: 'APPOINTMENT_CREATED',
            appointment_id: createdIds[0],
            appointment_ids: createdIds,
            barber_id: barberId,
            date,
            start_time: timeRaw,
            end_time:
              rpcRes.end_time || addMinutesToTimeStr(formattedTime, totalDuration).slice(0, 5),
            total_duration: rpcRes.total_duration || totalDuration,
            total_price: rpcRes.total_price ?? totalPrice,
            message: 'Agendamento confirmado com sucesso!',
          },
          { status: 200, headers: CORS_HEADERS }
        );
      }
    }

    // 3. Fallback direto de inserção em public.appointments (protegido no banco pelo
    //    índice único `idx_appointments_unique_active_slot` e trigger `trg_prevent_appointment_overlap`)
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
        clean_phone: clientPhoneRaw || '00000000000',
        appointment_date: date,
        appointment_time: formattedTime,
        end_time: endTime,
        duration_minutes: totalDuration,
        buffer_minutes: 0,
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
      if (isSlotConflict(insErr)) {
        const conflictMsg =
          'Este horário acabou de ser reservado simultaneamente por outro cliente. Por favor, escolha outro horário disponível.';
        return NextResponse.json(
          {
            ok: false,
            success: false,
            code: 'SLOT_ALREADY_BOOKED',
            sqlstate: '23505',
            error: conflictMsg,
            message: conflictMsg,
          },
          { status: 409, headers: CORS_HEADERS }
        );
      }

      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: insErr.code || 'INSERT_ERROR',
          error: insErr.message,
          message: insErr.message,
        },
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
        code: 'APPOINTMENT_CREATED',
        appointment_id: created.id,
        barber_id: barberId,
        date,
        start_time: timeRaw,
        end_time: endTime.slice(0, 5),
        total_duration: totalDuration,
        total_price: totalPrice,
        message: 'Agendamento confirmado com sucesso!',
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    if (isSlotConflict(err)) {
      const conflictMsg =
        'Este horário acabou de ser reservado simultaneamente por outro cliente. Por favor, escolha outro horário disponível.';
      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: 'SLOT_ALREADY_BOOKED',
          sqlstate: '23505',
          error: conflictMsg,
          message: conflictMsg,
        },
        { status: 409, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'INTERNAL_ERROR',
        error: err.message || 'Erro ao criar agendamento.',
        message: err.message || 'Erro ao criar agendamento.',
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
