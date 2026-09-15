import { NextResponse } from 'next/server';
import { sendPushToBarbers } from '@/lib/push';

/**
 * POST /api/push/send
 *
 * Disparo manual/avulso de notificação (útil para testar se o aparelho do
 * barbeiro está realmente recebendo). A lógica de envio em si mora em
 * lib/push.js — esta rota é só a casca HTTP.
 *
 * Body (JSON):
 *   {
 *     "title": "Novo agendamento!",   // obrigatório
 *     "body": "Cliente X às 14h",     // obrigatório
 *     "url": "/admin/agenda",         // opcional
 *     "barberId": "uuid-do-barbeiro"  // opcional — se ausente, envia pra TODOS
 *   }
 */
export const runtime = 'nodejs';

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo da requisição inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const { title, body, url, barberId } = payload || {};

  if (!title || !body) {
    return NextResponse.json(
      { error: 'Os campos "title" e "body" são obrigatórios.' },
      { status: 400 }
    );
  }

  const result = await sendPushToBarbers({
    barberIds: barberId ? [barberId] : null,
    title,
    body,
    url: url || '/admin/agenda',
  });

  return NextResponse.json(result);
}
