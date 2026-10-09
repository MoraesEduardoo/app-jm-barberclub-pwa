import { NextResponse } from 'next/server';
import { notifyCancelledAppointment } from '@/lib/push';

/**
 * POST /api/push/appointment-cancelled
 *
 * Endpoint HTTP e Webhook dedicado para notificações push de cancelamento
 * de agendamentos realizados FORA do painel administrativo (por exemplo,
 * cancelamento via bot do WhatsApp, site público, ou Database Webhook do Supabase).
 *
 * Formatos suportados no corpo (JSON):
 *
 * 1) Chamada direta da API / Bot:
 *      { "appointmentId": "uuid-do-agendamento", "reason": "Motivo opcional" }
 *
 * 2) Supabase Database Webhook (UPDATE em appointments com status = 'cancelado'):
 *      {
 *        "type": "UPDATE",
 *        "table": "appointments",
 *        "record": { "id": "...", "status": "cancelado" },
 *        "old_record": { "status": "confirmado" }
 *      }
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

  // Se for payload de Database Webhook, garante que o evento representa um cancelamento
  if (payload?.type === 'UPDATE') {
    const isNowCancelled = payload?.record?.status === 'cancelado';
    const wasAlreadyCancelled = payload?.old_record?.status === 'cancelado';

    if (!isNowCancelled || wasAlreadyCancelled) {
      return NextResponse.json({
        skipped: true,
        reason: 'Evento de atualização ignorado (status não migrou para cancelado)',
      });
    }
  }

  const appointmentId = payload?.appointmentId || payload?.record?.id || payload?.id;
  const reason = payload?.reason || payload?.record?.cancellation_reason || null;

  if (!appointmentId) {
    return NextResponse.json(
      { error: 'Informe "appointmentId" (ou envie payload com record.id).' },
      { status: 400 }
    );
  }

  try {
    const result = await notifyCancelledAppointment(appointmentId, { reason });

    if (result.error) {
      console.error('[push/appointment-cancelled] Erro ao enviar push de cancelamento:', result.error);
      return NextResponse.json(result, { status: 503 });
    }

    console.log('[push/appointment-cancelled] Notificação de cancelamento enviada com sucesso:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[push/appointment-cancelled] Falha inesperada:', error);
    return NextResponse.json(
      { error: 'Falha ao processar envio de notificação de cancelamento.' },
      { status: 500 }
    );
  }
}
