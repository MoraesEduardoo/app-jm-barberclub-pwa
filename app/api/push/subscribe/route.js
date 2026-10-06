import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function serverConfigurationError() {
  return NextResponse.json(
    { error: 'SUPABASE_SERVICE_ROLE_KEY não está configurada no servidor.' },
    { status: 503 }
  );
}

// Cria um client com privilégios de Administrador (Service Role)
function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

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

  const supabase = getServiceSupabase();
  if (!supabase) return serverConfigurationError();

  const { data, error } = await supabase.from('push_subscriptions').upsert(
    {
      barber_id: barberId,
      subscription: subscription,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: request.headers.get('user-agent') || null,
    },
    { onConflict: 'endpoint' }
  )
    .select('id, barber_id')
    .single();

  if (error) {
    console.error('[PUSH SUBSCRIBE ERROR]:', error);
    return NextResponse.json(
      { error: `Não foi possível salvar a inscrição: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, subscriptionId: data.id, barberId: data.barber_id });
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

  const { endpoint, barberId } = payload || {};

  if (!endpoint || !barberId) {
    return NextResponse.json(
      { error: 'Os campos "endpoint" e "barberId" são obrigatórios.' },
      { status: 400 }
    );
  }

  const supabase = getServiceSupabase();
  if (!supabase) return serverConfigurationError();

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('barber_id', barberId);

  if (error) {
    return NextResponse.json(
      { error: `Não foi possível remover a inscrição: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}