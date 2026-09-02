'use server';

import { getSupabaseServerClient } from '@/lib/supabase/server';

function dayRange(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Monta o resumo financeiro de um intervalo de datas.
 * Separa "quem pagou" (payment_status = 'pago') de "quem não pagou"
 * (qualquer outro status, exceto cancelado), usando o preço do serviço
 * (services.price) como valor de referência.
 */
export async function getFinanceSummary({ from, to, scopeBarberId = null }) {
  const supabase = getSupabaseServerClient();
  const { start, end } = dayRange(from, to);

  let query = supabase
    .from('appointments')
    .select(`
      id, appointment_date, status, payment_method, payment_status,
      client_name,
      services ( id, name, price ),
      barbers ( id, name )
    `)
    .gte('appointment_date', start)
    .lt('appointment_date', end)
    .neq('status', 'cancelado')
    .order('appointment_date', { ascending: false });

  if (scopeBarberId) {
    query = query.eq('barber_id', scopeBarberId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível carregar o faturamento: ${error.message}`);

  const withAmount = data.map((a) => ({ ...a, amount: Number(a.services?.price || 0) }));

  const pagos = withAmount.filter((a) => a.payment_status === 'pago');
  const pendentes = withAmount.filter((a) => a.payment_status !== 'pago');

  const totalFaturado = pagos.reduce((sum, a) => sum + a.amount, 0);
  const totalPendente = pendentes.reduce((sum, a) => sum + a.amount, 0);

  const porMetodo = pagos.reduce((acc, a) => {
    const key = a.payment_method || 'não informado';
    acc[key] = (acc[key] || 0) + a.amount;
    return acc;
  }, {});

  return { pagos, pendentes, totalFaturado, totalPendente, porMetodo };
}
