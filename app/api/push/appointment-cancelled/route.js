import { NextResponse } from 'next/server';
import { executeAppointmentCancellation, isCancelledStatus } from '@/lib/cancellation';
import { notifyCancelledAppointment } from '@/lib/push';

/**
 * POST /api/push/appointment-cancelled
 *
 * Endpoint HTTP e Webhook dedicado para cancelamento e notificações de cancelamento
 * de agendamentos realizados FORA do painel administrativo (por exemplo,
 * cancelamento via bot do WhatsApp, site público, chatbot bridge ou Database Webhook do Supabase).
 *
 * Formatos suportados no corpo (JSON):
 *
 * 1) Chamada direta da API / Bot / Chatbot:
 *      { "appointmentId": "uuid-do-agendamento", "reason": "Motivo opcional" }
 *      ou { "appointment_id": "uuid", "reason": "..." }
 *      ou { "id": "uuid" }
 *      -> Atualiza status para 'cancelado' (se ainda não estiver), libera a vaga e notifica o barbeiro via Web Push.
 *
 * 2) Supabase Database Webhook (UPDATE em appointments com status migrando para 'cancelado' ou 'canceled'):
 *      {
 *        "type": "UPDATE",
 *        "table": "appointments",
 *        "record": { "id": "...", "status": "cancelado" },
 *        "old_record": { "status": "confirmado" }
 *      }
 *      -> O banco já foi atualizado pelo Supabase; dispara Web Push isolado para o barbeiro responsável.
 *
 * Segurança: Exige o header "x-push-secret" igual ao segredo PUSH_WEBHOOK_SECRET.
 */
export const runtime = 'nodejs';

export async function POST(request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[push/appointment-cancelled] PUSH_WEBHOOK_SECRET não definido no ambiente.');
    return NextResponse.json({ error: 'Endpoint não configurado.' }, { status: 500 });
  }

  if (request.headers.get('x-push-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo da requisição inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  // Ignora eventos que não sejam atualização (ex: webhooks configurados para INSERT na mesma tabela)
  if (payload?.type && payload.type !== 'UPDATE') {
    return NextResponse.json({ skipped: true, reason: `evento ${payload.type} ignorado` });
  }

  const isDatabaseWebhook = payload?.type === 'UPDATE';

  // Se for payload de Database Webhook do Supabase:
  if (isDatabaseWebhook) {
    const isNowCancelled = isCancelledStatus(payload?.record?.status);
    const wasAlreadyCancelled = isCancelledStatus(payload?.old_record?.status);

    if (!isNowCancelled || wasAlreadyCancelled) {
      return NextResponse.json({
        skipped: true,
        reason: 'Evento de atualização ignorado (status não migrou para cancelado)',
      });
    }

    const appointmentId =
      payload?.record?.id ||
      payload?.appointmentId ||
      payload?.appointment_id ||
      payload?.id;

    const reason =
      payload?.record?.cancellation_reason ||
      payload?.reason ||
      null;

    if (!appointmentId) {
      return NextResponse.json(
        { error: 'ID do agendamento ausente no payload do webhook.' },
        { status: 400 }
      );
    }

    try {
      const result = await notifyCancelledAppointment(appointmentId, { reason });

      if (result?.error) {
        console.error('[push/appointment-cancelled] Erro detalhado no push do webhook:', result.error);
        return NextResponse.json(result, { status: 503 });
      }

      console.log('[push/appointment-cancelled] Web Push de cancelamento enviado com sucesso:', result);
      return NextResponse.json({ success: true, pushResult: result });
    } catch (err) {
      console.error('[push/appointment-cancelled] Erro ao disparar push do webhook:', err);
      return NextResponse.json({ error: 'Falha ao disparar push' }, { status: 500 });
    }
  }

  // Se for chamada direta de bot, chatbot bridge ou API externa:
  const appointmentId =
    payload?.appointmentId ||
    payload?.appointment_id ||
    payload?.id ||
    payload?.record?.id;

  const reason =
    payload?.reason ||
    payload?.cancellation_reason ||
    payload?.record?.cancellation_reason ||
    null;

  if (!appointmentId) {
    return NextResponse.json(
      { error: 'Informe "appointmentId" (ou "appointment_id") no corpo da requisição.' },
      { status: 400 }
    );
  }

  try {
    // Executa as 3 etapas: atualiza status para 'cancelado', libera vaga e dispara notificações (Web Push exclusivo para o barbeiro)
    const result = await executeAppointmentCancellation({
      appointmentId,
      reason,
      cancelledBy: payload?.cancelledBy || 'webhook_direto',
    });

    if (result.error) {
      console.error('[push/appointment-cancelled] Erro ao cancelar agendamento:', result.error);
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (result.notifications?.push?.error) {
      console.warn('[push/appointment-cancelled] Aviso no envio do push:', result.notifications.push.error);
    }

    console.log('[push/appointment-cancelled] Agendamento cancelado e vaga liberada com sucesso:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[push/appointment-cancelled] Falha inesperada:', error);
    return NextResponse.json(
      { error: 'Não foi possível processar o cancelamento e envio da notificação.' },
      { status: 500 }
    );
  }
}

