// Utilitário de notificações e mensagens via WhatsApp para a barbearia
// Suporta tanto a geração de links diretos (click-to-chat) quanto disparo automatizado
// via Webhook / Gateway de mensagens (ex: Evolution API, Z-API, Baileys ou Twilio)

import { formatTime } from '@/lib/dates';

/**
 * Formata número de telefone brasileiro para o formato internacional padrão WhatsApp (DDI 55 + DDD + Número)
 */
export function formatWhatsAppPhone(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, '');
  if (!cleaned) return null;
  return cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
}

/**
 * Gera mensagem estruturada de notificação de cancelamento para o barbeiro.
 */
export function buildCancellationWhatsAppMessage({
  clientName,
  serviceName,
  appointmentDate,
  barberName,
  reason = null,
}) {
  const formattedTime = formatTime(appointmentDate) || 'Horário agendado';
  const dateObj = new Date(appointmentDate);
  const formattedDate = !isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '';

  const lines = [
    '⚠️ *AVISO DE CANCELAMENTO — JM BARBERCLUB*',
    '',
    `👤 *Cliente:* ${clientName || 'Cliente'}`,
    `💈 *Serviço:* ${serviceName || 'Corte/Barba'}`,
    `📅 *Horário:* ${formattedTime}${formattedDate ? ` (${formattedDate})` : ''}`,
    barberName ? `✂️ *Profissional:* ${barberName}` : null,
    reason ? `💬 *Motivo:* ${reason}` : null,
    '',
    '🟢 *Vaga liberada:* Esse horário já voltou a ficar disponível imediatamente no sistema para novos agendamentos!',
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Gera URL de WhatsApp (wa.me) para envio direto ao barbeiro ou cliente.
 */
export function getWhatsAppClickToChatUrl(phone, message) {
  const formattedPhone = formatWhatsAppPhone(phone);
  if (!formattedPhone) return null;
  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Disparo automatizado de mensagem de WhatsApp via Webhook configurado.
 * Se WHATSAPP_WEBHOOK_URL estiver configurado no .env, realiza o POST assíncrono.
 * Caso contrário, opera em modo seguro sem travar a requisição.
 */
export async function sendWhatsAppNotification({ phone, message, metadata = {} }) {
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
  const formattedPhone = formatWhatsAppPhone(phone);

  if (!formattedPhone) {
    return { ok: false, error: 'Telefone inválido ou ausente.' };
  }

  // Se houver webhook de mensageria configurado no ambiente
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.WHATSAPP_API_TOKEN ? { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          phone: formattedPhone,
          message,
          ...metadata,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[whatsapp] Erro na resposta do gateway de WhatsApp:', response.status, text);
        return { ok: false, error: `Gateway retornou status ${response.status}` };
      }

      return { ok: true, sent: true };
    } catch (err) {
      console.error('[whatsapp] Falha ao enviar requisição para gateway:', err?.message || err);
      return { ok: false, error: err?.message };
    }
  }

  // Se não houver webhook configurado, gera e disponibiliza a URL para clique
  const clickToChatUrl = getWhatsAppClickToChatUrl(formattedPhone, message);
  return {
    ok: true,
    sent: false,
    directUrl: clickToChatUrl,
    note: 'Webhook não configurado no ambiente. URL direta gerada.',
  };
}
