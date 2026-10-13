import { NextResponse } from 'next/server';
import { executeAppointmentCancellation } from '@/lib/cancellation';
import { notifyCancelledAppointment } from '@/lib/push';

/**
 * POST /api/push/appointment-cancelled
 *
 * Endpoint HTTP e Webhook dedicado para cancelamento e notificações de cancelamento
 * de agendamentos realizados FORA do painel administrativo (por exemplo,
 * cancelamento via bot do WhatsApp, site público, ou Database Webhook do Supabase).
 *
 * Formatos suportados no corpo (JSON):
 *
 * 1) Chamada direta da API / Bot:
 *      { "appointmentId": "uuid-do-agendamento", "reason": "Motivo opcional" }
 *      -> Atualiza status para 'cancelado', libera a vaga no motor de horários e notifica barbeiro.
 *
 * 2) Supabase Database Webhook (UPDATE em appointments com status = 'cancelado'):
 *      {
 *        "type": "UPDATE",
 *        "table": "appointments",
 *        "record": { "id": "...", "status": "cancelado" },
 *        "old_record": { "status": "confirmado" }
 *      }
 *      -> O banco já foi atualizado pelo Supabase; dispara Web Push e alertas imediatos.
 *
 * Segurança: Exige o header "x-push-secret" igual ao segredo PUSH_WEBHOOK_SECRET.
 */
export const runtime = 'nodejs';

export async function POST(request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[push/appointment-cancelled] PUSH_WEBHOOK_SECRET não definido no ambiente.');
    return NextResponse.json({ error: 'Endpoint não configurado.' }, { status: 503 });
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

  const isDatabaseWebhook = payload?.type === 'UPDATE';

  // Se for payload de Database Webhook do Supabase:
  if (isDatabaseWebhook) {
    const isNowCancelled = payload?.record?.status === 'cancelado';
    const wasAlreadyCancelled = payload?.old_record?.status === 'cancelado';

    if (!isNowCancelled || wasAlreadyCancelled) {
      return NextResponse.json({
        skipped: true,
        reason: 'Evento de atualização ignorado (status não migrou para cancelado)',
      });
    }

    const appointmentId = payload?.record?.id;
    const reason = payload?.record?.cancellation_reason || payload?.reason || null;

    if (!appointmentId) {
      return NextResponse.json(
        { error: 'ID do agendamento ausente no payload do webhook.' },
        { status: 400 }
      );
    }

    try {
      const result = await notifyCancelledAppointment(appointmentId, { reason });
      return NextResponse.json({ success: true, pushResult: result });
    } catch (err) {
      console.error('[push/appointment-cancelled] Erro ao disparar push do webhook:', err);
      return NextResponse.json({ error: 'Falha ao disparar push' }, { status: 500 });
    }
  }

  // Se for chamada direta de bot ou API externa:
  const appointmentId = payload?.appointmentId || payload?.id;
  const reason = payload?.reason || payload?.cancellation_reason || null;

  if (!appointmentId) {
    return NextResponse.json(
      { error: 'Informe "appointmentId" no corpo da requisição.' },
      { status: 400 }
    );
  }

  try {
    // Executa as 3 etapas: atualiza status, libera vaga e dispara notificações
    const result = await executeAppointmentCancellation({
      appointmentId,
      reason,
      cancelledBy: 'webhook_direto',
    });

    if (result.error) {
      console.error('[push/appointment-cancelled] Erro ao cancelar agendamento:', result.error);
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    console.log('[push/appointment-cancelled] Agendamento cancelado e vaga liberada com sucesso:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[push/appointment-cancelled] Falha inesperada:', error);
    return NextResponse.json(
      { error: 'Falha ao processar envio de notificação de cancelamento.' },
      { status: 500 }
    );
  }
}
