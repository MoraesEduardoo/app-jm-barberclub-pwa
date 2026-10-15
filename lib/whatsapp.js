// Utilitário de notificações e mensagens via WhatsApp para a JM Barberclub
// Suporta tanto a geração de links diretos (click-to-chat) quanto disparo automatizado
// via Webhook / Gateway de mensagens (ex: Evolution API, Z-API, Baileys ou Twilio)

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
 * Formata data e horário no fuso da barbearia (America/Fortaleza = UTC-3)
 */
export function formatAppointmentDateTimePtBR(isoDate) {
  if (!isoDate) return { dateStr: '', timeStr: '', fullStr: '' };
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return { dateStr: '', timeStr: '', fullStr: '' };

    const timeStr = d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Fortaleza',
    });

    const dateStr = d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Fortaleza',
    });

    return {
      dateStr,
      timeStr,
      fullStr: `${dateStr} às ${timeStr}`,
    };
  } catch {
    return { dateStr: '', timeStr: '', fullStr: '' };
  }
}

/**
 * 1. LEMBRETE DE AGENDAMENTO ESPECÍFICO (Para o botão de Lembrete no card da Agenda)
 * Copywriting profissional, clean e 100% formatado para WhatsApp com emojis universais e UTF-8 puro.
 * Ex: "Eduardo, lembrete do seu corte Degradê com William hoje às 21:00"
 */
export function buildAppointmentReminderWhatsAppMessage({
  clientName,
  serviceName,
  appointmentDate,
  barberName,
}) {
  const firstName = clientName ? clientName.trim().split(' ')[0] : 'Cliente';
  const { dateStr, timeStr } = formatAppointmentDateTimePtBR(appointmentDate);

  const whenText = dateStr && timeStr ? `${dateStr} às ${timeStr}` : (timeStr || 'horário marcado');
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://app-jm-barberclub-pwa.vercel.app').replace(/\/+$/, '');

  const lines = [
    `Fala, *${firstName}*! Tudo certo por aí? 💈`,
    '',
    `Passando para lembrar do seu horário agendado na *JM Barberclub*:`,
    '',
    `🗓️ *Data:* ${whenText}`,
    `✂️ *Serviço:* ${serviceName || 'Corte'}`,
    barberName ? `💈 *Profissional:* ${barberName}` : null,
    '',
    `Estamos te esperando para deixar a régua e o visual alinhados! 🔥`,
    '',
    `🔗 *Gerenciar agendamento:* ${siteUrl}`,
    '',
    `Qualquer imprevisto, é só avisar por aqui. Até logo! 👊`,
  ].filter((line) => line !== null);

  return lines.join('\n');
}

/**
 * 2. LEMBRETE DE RETORNO / FIDELIDADE (Exclusivo para a aba de Ciclos de Retorno de 15-20 dias)
 */
export function buildReturnCycleReminderWhatsAppMessage({
  clientName,
  daysSinceLast,
}) {
  const firstName = clientName ? clientName.trim().split(' ')[0] : 'Cliente';
  const daysText = daysSinceLast ? `cerca de ${daysSinceLast} dias` : 'algumas semanas';
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://app-jm-barberclub-pwa.vercel.app').replace(/\/+$/, '');

  const lines = [
    `Fala, *${firstName}*! Tudo certo por aí? 💈`,
    '',
    `Passando para lembrar de manter a régua e o corte alinhados!`,
    `Já faz ${daysText} desde o seu último atendimento aqui na *JM Barberclub*.`,
    '',
    `Bora renovar o visual? 🔥`,
    '',
    `🔗 *Escolha seu melhor horário:* ${siteUrl}`,
    '',
    `Qualquer dúvida, é só responder por aqui. Abraço! 👊`,
  ];

  return lines.join('\n');
}

/**
 * 3. AVISO DE CANCELAMENTO (Para notificar o barbeiro quando um horário for cancelado)
 */
export function buildCancellationWhatsAppMessage({
  clientName,
  serviceName,
  appointmentDate,
  barberName,
  reason = null,
}) {
  const { dateStr, timeStr } = formatAppointmentDateTimePtBR(appointmentDate);
  const formattedTime = timeStr || 'Horário agendado';
  const formattedDate = dateStr ? ` (${dateStr})` : '';

  const lines = [
    '⚠️ *AVISO DE CANCELAMENTO — JM BARBERCLUB*',
    '',
    `👤 *Cliente:* ${clientName || 'Cliente'}`,
    `💈 *Serviço:* ${serviceName || 'Corte/Barba'}`,
    `📅 *Horário:* ${formattedTime}${formattedDate}`,
    barberName ? `✂️ *Profissional:* ${barberName}` : null,
    reason ? `💬 *Motivo:* ${reason}` : null,
    '',
    '🟢 *Vaga liberada:* Esse horário já voltou a ficar disponível imediatamente no sistema para novos agendamentos!',
  ].filter((line) => line !== null);

  return lines.join('\n');
}

/**
 * Gera URL oficial de envio de WhatsApp.
 * Usa api.whatsapp.com/send diretamente para garantir preservação íntegra de quebras de linha e UTF-8
 * sem passar por redirects 302 do wa.me que causam caracteres corrompidos.
 */
export function getWhatsAppClickToChatUrl(phone, message) {
  const formattedPhone = formatWhatsAppPhone(phone);
  if (!formattedPhone) return null;
  return `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
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
