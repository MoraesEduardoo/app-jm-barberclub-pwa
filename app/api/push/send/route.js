import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * POST /api/push/send
 *
 * Dispara uma notificação push para as inscrições salvas na tabela
 * "push_subscriptions". Estrutura esperada da tabela (ajuste os nomes
 * das colunas abaixo caso a sua tabela use nomes diferentes):
 *   - id          uuid (PK)
 *   - barber_id   uuid (FK -> barbers.id)
 *   - endpoint    text (único)
 *   - p256dh      text
 *   - auth        text
 *
 * Body aceito (JSON):
 *   {
 *     "title": "Novo agendamento",       // obrigatório
 *     "body": "Cliente X às 14h",        // obrigatório
 *     "url": "/admin/agenda",            // opcional — para onde abrir ao clicar
 *     "barberId": "uuid-do-barbeiro"     // opcional — se ausente, envia pra TODOS
 *   }
 */

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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

  const supabase = getSupabaseServerClient();

  let query = supabase
    .from('push_subscriptions')
    .select('id, barber_id, endpoint, p256dh, auth');

  if (barberId) {
    query = query.eq('barber_id', barberId);
  }

  const { data: subscriptions, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: `Não foi possível carregar as inscrições: ${error.message}` },
      { status: 500 }
    );
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({
      sent: 0,
      failed: 0,
      removed: 0,
      message: 'Nenhuma inscrição encontrada para notificar.',
    });
  }

  const notificationPayload = JSON.stringify({
    title,
    body,
    url: url || '/admin',
    icon: '/icons/logo-192.png',
    badge: '/icons/logo-192.png',
  });

  let sent = 0;
  let failed = 0;
  const staleIds = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload);
        sent += 1;
      } catch (err) {
        failed += 1;

        // 404/410 = a inscrição expirou ou foi revogada pelo navegador do
        // barbeiro (ex.: desinstalou o app, limpou os dados do site).
        // Nesses casos, não faz sentido manter a linha no banco.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          staleIds.push(sub.id);
        } else {
          console.error(
            `[push/send] Falha ao notificar ${sub.endpoint}:`,
            err?.statusCode,
            err?.body || err?.message
          );
        }
      }
    })
  );

  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds);
  }

  return NextResponse.json({ sent, failed, removed: staleIds.length });
}
