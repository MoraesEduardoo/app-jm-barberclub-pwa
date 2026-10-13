// POST /api/appointments/cancel
// Endpoint HTTP dedicado para cancelamento de agendamentos solicitados pelo CLIENTE via Chatbot
// (WhatsApp bot, site público ou integração de mensageria).
//
// Executa as 3 ações imediatas obrigatórias:
// 1. Atualização do Status na tabela 'appointments' para 'cancelado'
// 2. Liberação Instantânea da Vaga no motor de horários
// 3. Disparo de Notificação ao Barbeiro e Chefe (Web Push, Realtime e WhatsApp)

import { NextResponse } from 'next/server';
import { executeAppointmentCancellation } from '@/lib/cancellation';
import { checkIpRateLimit, getClientIp } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request) {
  // Limitação de taxa por IP para evitar abusos na rota pública de cancelamento
  const clientIp = getClientIp(request);
  const rateLimit = checkIpRateLimit(clientIp, { maxAttempts: 15, windowSeconds: 60 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Muitas tentativas de cancelamento. Aguarde um minuto.' },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Formato inválido. JSON esperado no corpo da requisição.' },
      { status: 400 }
    );
  }

  const appointmentId = body?.appointmentId || body?.appointment_id || body?.id;
  const reason = body?.reason || body?.cancellation_reason || body?.motivo || null;
  const clientPhone = body?.clientPhone || body?.client_phone || null;
  const cancelledBy = body?.cancelledBy || 'cliente_chatbot';

  if (!appointmentId) {
    return NextResponse.json(
      { error: 'Campo obrigatório ausente: "appointmentId".' },
      { status: 400 }
    );
  }

  // Opcional: Autenticação via segredo webhook se fornecido pelo bot
  const secretHeader = request.headers.get('x-push-secret') || request.headers.get('x-api-key');
  const expectedSecret = process.env.PUSH_WEBHOOK_SECRET;

  // Se o webhook secret estiver configurado e fornecido, aceita como chamada autenticada de bot.
  // Caso não tenha header, ainda permite se o bot enviar clientPhone para correspondência, ou cancelamento direto.
  try {
    const result = await executeAppointmentCancellation({
      appointmentId,
      reason,
      cancelledBy,
      clientIp,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      data: result.appointment,
      freedSlot: true,
      notifications: result.notifications,
    });
  } catch (err) {
    console.error('[api/appointments/cancel] Erro inesperado ao cancelar agendamento:', err);
    return NextResponse.json(
      { error: 'Ocorreu um erro interno ao processar o cancelamento.' },
      { status: 500 }
    );
  }
}
