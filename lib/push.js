import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

/**
 * Camada única de Web Push do servidor com privilégios de Admin (Service Role).
 * 
 * IMPORTANTE: este módulo é server-only. Nunca importe em Client Component,
 * senão a VAPID_PRIVATE_KEY vazaria no bundle do navegador.
 */

let vapidConfigured = false;

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

// Cria um client do Supabase com Service Role para bypassar o RLS com segurança
function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

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
        console.log('[PUSH SUCESSO]', sub.endpoint);
      } catch (err) {
        failed += 1;
        console.error('[PUSH ERRO DETALHADO]:', err);
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          staleIds.push(sub.id);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    const supabase = getServiceSupabase();
    if (supabase) {
      const { error } = await supabase.from('push_subscriptions').delete().in('id', staleIds);
      if (error) {
        console.error('[push] Não foi possível remover inscrições expiradas:', error.message);
      }
    }
  }

  return { sent, failed, removed: staleIds.length };
}

export async function sendPushToBarbers({ barberIds = null, title, body, url = '/admin/agenda', tag }) {
  if (Array.isArray(barberIds) && barberIds.length === 0) {
    return { sent: 0, failed: 0, removed: 0, message: 'Nenhum destinatário encontrado.' };
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    console.error('[push] SUPABASE_SERVICE_ROLE_KEY ausente nas variáveis de ambiente do servidor.');
    return { sent: 0, failed: 0, removed: 0, error: 'Configuração de servidor incompleta.' };
  }

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

/**
 * Formata o horário do agendamento para a notificação push preservando
 * rigorosamente o horário local da barbearia (America/Fortaleza = UTC-3).
 * Evita a falha onde '2026-10-16' sem hora virava 21:00 (meia-noite UTC - 3h).
 */
export function formatAppointmentPushTime(dateVal, timeVal) {
  // 1. Prioridade máxima: appointment_time explícito (ex: "14:30:00" ou "14:30")
  if (timeVal) {
    const str = String(timeVal).trim();
    if (/^\d{1,2}:\d{2}/.test(str)) {
      const parts = str.split(':');
      const h = parts[0].padStart(2, '0');
      const m = parts[1].slice(0, 2);
      return `${h}:${m}`;
    }
  }

  // 2. Se a string de data possui T e não for meia-noite UTC (T00:00:00)
  if (dateVal && typeof dateVal === 'string' && dateVal.includes('T')) {
    if (!dateVal.includes('T00:00:00')) {
      try {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Fortaleza',
          });
        }
      } catch {
        // fallback silencioso
      }
    }
  }

  return '';
}

export function formatAppointmentPushDate(dateVal) {
  if (!dateVal) return '';
  const raw = String(dateVal).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [, m, d] = raw.split('-');
    return `${d}/${m}`;
  }
  return '';
}

export async function notifyNewAppointment(appointmentId, optionalRecord = null) {
  if (!appointmentId && !optionalRecord?.id) {
    return { sent: 0, failed: 0, removed: 0, error: 'appointmentId ausente' };
  }

  const targetId = appointmentId || optionalRecord?.id;
  const supabase = getServiceSupabase();
  if (!supabase) return { sent: 0, failed: 0, removed: 0, error: 'Configuração de servidor incompleta.' };

  // Busca agendamento completo incluindo appointment_time
  const { data: dbAppointment, error } = await supabase
    .from('appointments')
    .select(`
      id, appointment_date, appointment_time, client_name, is_walk_in, barber_id,
      services ( name, price ),
      barbers ( id, name, role )
    `)
    .eq('id', targetId)
    .single();

  const appointment = dbAppointment || optionalRecord;

  if (!appointment) {
    console.error('[push] Agendamento não encontrado para notificar:', error?.message);
    return { sent: 0, failed: 0, removed: 0, error: error?.message || 'não encontrado' };
  }

  const clientName = appointment.client_name || 'Cliente';
  const serviceName = appointment.services?.name || appointment.service || 'Serviço';
  
  // Extrai o horário exato (14:30) sem conversão indevida de UTC
  const hour = formatAppointmentPushTime(appointment.appointment_date, appointment.appointment_time);
  const barberName = appointment.barbers?.name;

  const title = appointment.is_walk_in ? 'Cliente sem hora!' : 'Novo agendamento!';

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
    tag: `appointment-${appointment.id}`,
  });
}

/**
 * Dispara notificação push de cancelamento de agendamento para o barbeiro responsável e para o chefe.
 * Utilizado quando o status do agendamento é alterado para 'cancelado' (seja pelo painel ou via webhook/chatbot).
 */
export async function notifyCancelledAppointment(appointmentId, { reason = null } = {}) {
  if (!appointmentId) return { sent: 0, failed: 0, removed: 0, error: 'appointmentId ausente' };

  const supabase = getServiceSupabase();
  if (!supabase) return { sent: 0, failed: 0, removed: 0, error: 'Configuração de servidor incompleta.' };

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(`
      id, appointment_date, appointment_time, client_name, is_walk_in, barber_id,
      services ( name, price ),
      barbers ( id, name, role )
    `)
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    console.error('[push] Agendamento não encontrado para notificar cancelamento:', error?.message);
    return { sent: 0, failed: 0, removed: 0, error: error?.message || 'não encontrado' };
  }

  const clientName = appointment.client_name || 'Cliente';
  const serviceName = appointment.services?.name || appointment.service || 'Serviço';
  const hour = formatAppointmentPushTime(appointment.appointment_date, appointment.appointment_time);
  const barberName = appointment.barbers?.name;

  const title = '⚠️ Agendamento cancelado!';

  const parts = [`${clientName} cancelou ${serviceName}`];
  if (hour) parts.push(`das ${hour}`);
  if (barberName) parts.push(`(com ${barberName})`);
  if (reason) parts.push(`— Motivo: ${reason}`);

  const body = parts.join(' ');

  const recipients = new Set();
  if (appointment.barber_id) recipients.add(appointment.barber_id);

  const { data: chefes } = await supabase.from('barbers').select('id').eq('role', 'admin');
  (chefes || []).forEach((chefe) => recipients.add(chefe.id));

  return sendPushToBarbers({
    barberIds: [...recipients],
    title,
    body,
    url: '/admin/agenda',
    tag: `appointment-cancelled-${appointment.id}`,
  });
}
