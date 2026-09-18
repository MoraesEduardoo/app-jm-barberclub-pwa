import { NextResponse } from 'next/server';
import { notifyNewAppointment } from '@/lib/push';

/**
 * POST /api/push/appointment-created
 *
 * Porta de entrada para agendamentos criados FORA deste painel — o chat do
 * site público, ou qualquer outro sistema que grave direto na tabela
 * "appointments". Recebe o id e dispara o push para o barbeiro + chefe.
 *
 * Aceita dois formatos de corpo:
 *
 * 1) Chamada direta do app/chat:
 *      { "appointmentId": "uuid-do-agendamento" }
 *
 * 2) Database Webhook do Supabase (INSERT em appointments), que manda:
 *      { "type": "INSERT", "table": "appointments", "record": { "id": "..." } }
 *
 * Segurança: exige o header "x-push-secret" igual a PUSH_WEBHOOK_SECRET.
 * Sem isso, qualquer um na internet poderia fazer o telemóvel do barbeiro
 * apitar à vontade.
 */
export const runtime = 'nodejs';

export async function POST(request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[push/appointment-created] PUSH_WEBHOOK_SECRET não definido no ambiente.');
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

  // Ignora eventos que não sejam criação de agendamento (o webhook pode
  // estar configurado para INSERT + UPDATE na mesma tabela).
  if (payload?.type && payload.type !== 'INSERT') {
    return NextResponse.json({ skipped: true, reason: `evento ${payload.type}` });
  }

  const appointmentId = payload?.appointmentId || payload?.record?.id || payload?.id;

  if (!appointmentId) {
    return NextResponse.json(
      { error: 'Informe "appointmentId" (ou envie o payload do webhook com "record.id").' },
      { status: 400 }
    );
  }

  try {
    const result = await notifyNewAppointment(appointmentId);

    // Falha de VAPID, Supabase ou leitura do agendamento precisa ser
    // visível para a ponte do chat. Assim ela registra o problema nos logs
    // sem nunca desfazer o agendamento já confirmado para o cliente.
    if (result.error) {
      return NextResponse.json(result, { status: 503 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[push/appointment-created] erro inesperado:', error);
    return NextResponse.json(
      { error: 'Não foi possível processar o envio da notificação.' },
      { status: 500 }
    );
  }
}
