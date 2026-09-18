import webpush from 'web-push';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Camada única de Web Push do servidor.
 *
 * Tudo que dispara notificação no projeto passa por aqui:
 *   - Server Action de agendamento (lib/actions/appointments.js)
 *   - POST /api/push/send            (disparo manual / testes)
 *   - POST /api/push/appointment-created (chat e site público / webhook)
 *
 * IMPORTANTE: este módulo é server-only. Nunca importe em Client Component,
 * senão a VAPID_PRIVATE_KEY vazaria no bundle do navegador.
 */

let vapidConfigured = false;

/**
 * Configura o VAPID sob demanda (e uma vez só). Feito em função, e não no
 * topo do módulo, porque um .env incompleto faria o webpush lançar erro já
 * no import e derrubar a rota inteira — aqui a falta de chave vira um
 * retorno controlado, e o agendamento continua sendo salvo normalmente.
 */
function ensureVapid() {
  if (vapidConfigured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:moraesedu1313@gmail.com';

  if (!publicKey || !privateKey) {
    console.error(
      '[push] VAPID não configurado: defina NEXT_PUBLIC_VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no ambiente.'
    );
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/**
 * Envia o payload para uma lista de inscrições já carregada do banco.
 * Inscrições mortas (404/410 — app desinstalado, dados do site limpos)
 * são removidas da tabela, senão o banco só acumula lixo e o contador de
 * falhas nunca zera.
 */
async function deliver(subscriptions, payload) {
  if (!ensureVapid()) {
    return { sent: 0, failed: subscriptions.length, removed: 0, error: 'VAPID ausente' };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const staleIds = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          staleIds.push(sub.id);
        } else {
          console.error(
            `[push] Falha ao notificar ${sub.endpoint}:`,
            err?.statusCode,
            err?.body || err?.message
          );
        }
      }
    })
  );

  if (staleIds.length > 0) {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from('push_subscriptions').delete().in('id', staleIds);
    if (error) {
      console.error('[push] Não foi possível remover inscrições expiradas:', error.message);
    }
  }

  return { sent, failed, removed: staleIds.length };
}

/**
 * Dispara uma notificação para os dispositivos de um barbeiro.
 * Sem barberIds (null), envia para todo mundo inscrito. Uma lista vazia é
 * tratada como "sem destinatário" para nunca transformar um erro de dados
 * em um push enviado para toda a equipe.
 */
export async function sendPushToBarbers({ barberIds = null, title, body, url = '/admin/agenda', tag }) {
  if (Array.isArray(barberIds) && barberIds.length === 0) {
    return { sent: 0, failed: 0, removed: 0, message: 'Nenhum destinatário encontrado.' };
  }

  const supabase = getSupabaseServerClient();

  let query = supabase.from('push_subscriptions').select('id, barber_id, endpoint, p256dh, auth');

  if (Array.isArray(barberIds) && barberIds.length > 0) {
    query = query.in('barber_id', barberIds);
  }

  const { data: subscriptions, error } = await query;

  if (error) {
    console.error('[push] Não foi possível carregar as inscrições:', error.message);
    return { sent: 0, failed: 0, removed: 0, error: error.message };
  }

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0, removed: 0, message: 'Nenhuma inscrição encontrada.' };
  }

  return deliver(subscriptions, {
    title,
    body,
    url,
    tag,
    icon: '/icons/logo-192.png',
    badge: '/icons/logo-192.png',
  });
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

/**
 * Monta e dispara o aviso de "Novo agendamento!".
 *
 * Recebe só o id do agendamento e busca o resto (serviço, barbeiro,
 * cliente) no banco — assim quem chama não precisa carregar nada extra, e
 * o texto da notificação fica idêntico venha ele do painel, do chat ou do
 * webhook do Supabase.
 *
 * Quem recebe: o barbeiro dono do agendamento e também o chefe
 * (role = 'admin'), que acompanha a agenda inteira. Se o dono já for o
 * chefe, o id não é duplicado.
 */
export async function notifyNewAppointment(appointmentId) {
  if (!appointmentId) return { sent: 0, failed: 0, removed: 0, error: 'appointmentId ausente' };

  const supabase = getSupabaseServerClient();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(`
      id, appointment_date, client_name, is_walk_in, barber_id,
      services ( name, price ),
      barbers ( id, name, role )
    `)
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    console.error('[push] Agendamento não encontrado para notificar:', error?.message);
    return { sent: 0, failed: 0, removed: 0, error: error?.message || 'não encontrado' };
  }

  const clientName = appointment.client_name || 'Cliente';
  const serviceName = appointment.services?.name || 'Serviço';
  const hour = formatTime(appointment.appointment_date);
  const barberName = appointment.barbers?.name;

  const title = appointment.is_walk_in ? 'Cliente sem hora!' : 'Novo agendamento!';

  // Ex.: "João Pedro — Corte + Barba às 14:30 (com Matheus)"
  const parts = [`${clientName} — ${serviceName}`];
  if (hour) parts.push(`às ${hour}`);
  const body = barberName ? `${parts.join(' ')} (com ${barberName})` : parts.join(' ');

  const recipients = new Set();
  if (appointment.barber_id) recipients.add(appointment.barber_id);

  const { data: chefes } = await supabase.from('barbers').select('id').eq('role', 'admin');
  (chefes || []).forEach((chefe) => recipients.add(chefe.id));

  return sendPushToBarbers({
    barberIds: [...recipients],
    title,
    body,
    url: '/admin/agenda',
    // Mesma tag = a notificação do mesmo agendamento não aparece
    // duplicada se o disparo acontecer duas vezes (painel + webhook).
    tag: `appointment-${appointment.id}`,
  });
}
