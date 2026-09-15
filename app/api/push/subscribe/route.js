import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Rota de "salvamento" usada pelo <PushNotificationButton />. O botão em
 * si só cuida de pedir permissão e gerar a subscription no navegador —
 * quem persiste isso no Supabase é esta rota.
 *
 * POST /api/push/subscribe
 *   Body: { subscription: PushSubscriptionJSON, barberId: string }
 *   Faz upsert por "endpoint" (chave natural de uma inscrição push),
 *   então reinscrever o mesmo dispositivo não gera duplicata.
 *
 * DELETE /api/push/subscribe
 *   Body: { endpoint: string }
 *   Remove a inscrição (usado ao desativar as notificações no botão).
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

  const { subscription, barberId } = payload || {};

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json(
      { error: 'Objeto "subscription" inválido ou incompleto.' },
      { status: 400 }
    );
  }

  if (!barberId) {
    return NextResponse.json({ error: 'O campo "barberId" é obrigatório.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      barber_id: barberId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: request.headers.get('user-agent') || null,
    },
    { onConflict: 'endpoint' }
  );

  if (error) {
    return NextResponse.json(
      { error: `Não foi possível salvar a inscrição: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo da requisição inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const { endpoint } = payload || {};

  if (!endpoint) {
    return NextResponse.json({ error: 'O campo "endpoint" é obrigatório.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);

  if (error) {
    return NextResponse.json(
      { error: `Não foi possível remover a inscrição: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
