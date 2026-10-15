// Utilitário de notificações e mensagens via WhatsApp para a JM Barberclub
// Formato limpo e universal (SEM EMOJIS) para garantir 100% de compatibilidade sem caracteres corrompidos.

export const CHATBOT_BOOKING_URL = 'https://chatbot-jmbarberclub.vercel.app/';

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
 * Formata data e horário preservando o fuso local da barbearia (America/Fortaleza = UTC-3)
 * Suporta data ('YYYY-MM-DD') e hora ('HH:MM:SS' ou 'HH:MM') separadas ou timestamps ISO.
 */
export function formatAppointmentDateTimePtBR(appointmentDate, appointmentTime) {
  let dateStr = '';
  let timeStr = '';

  // 1. Se appointmentTime foi informado diretamente pelo banco
  if (appointmentTime) {
    timeStr = String(appointmentTime).slice(0, 5);
  }

  // 2. Se appointmentDate for no padrão 'YYYY-MM-DD'
  if (appointmentDate && /^\d{4}-\d{2}-\d{2}/.test(String(appointmentDate))) {
    const raw = String(appointmentDate);
    const [y, m, d] = raw.slice(0, 10).split('-');
    dateStr = `${d}/${m}`;

    // Se tiver 'T' na string e não havia timeStr explícito
    if (!timeStr && raw.includes('T')) {
      try {
        const dateObj = new Date(raw);
        if (!isNaN(dateObj.getTime())) {
          timeStr = dateObj.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Fortaleza',
          });
        }
      } catch {
        // fallback silencioso
      }
    }
  } else if (appointmentDate) {
    try {
      const dateObj = new Date(appointmentDate);
      if (!isNaN(dateObj.getTime())) {
        dateStr = dateObj.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          timeZone: 'America/Fortaleza',
        });
        if (!timeStr) {
          timeStr = dateObj.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Fortaleza',
          });
        }
      }
    } catch {
      // fallback silencioso
    }
  }

  return {
    dateStr,
    timeStr,
    fullStr: dateStr && timeStr ? `${dateStr} as ${timeStr}` : (timeStr || dateStr),
  };
}

/**
 * 1. LEMBRETE DE AGENDAMENTO ESPECÍFICO (Para o botão de Lembrete no card da Agenda)
 * 100% livre de emojis e caracteres especiais, apontando exclusivamente para o Chatbot oficial.
 */
export function buildAppointmentReminderWhatsAppMessage({
  clientName,
  serviceName,
  appointmentDate,
  appointmentTime,
  barberName,
}) {
  const firstName = clientName ? clientName.trim().split(' ')[0] : 'Amigo';
  const { dateStr, timeStr } = formatAppointmentDateTimePtBR(appointmentDate, appointmentTime);

  const whenText = dateStr && timeStr ? `${dateStr} as ${timeStr}` : (timeStr || 'horario marcado');
  const chatbotUrl = process.env.NEXT_PUBLIC_CHATBOT_URL || CHATBOT_BOOKING_URL;

  const lines = [
    `Fala, ${firstName}! Tudo certo por ai?`,
    '',
    `Passando para lembrar do seu horário agendado na JM Barberclub:`,
    '',
    `Data: ${whenText}`,
    `Servico: ${serviceName || 'Corte'}`,
    barberName ? `Profissional: ${barberName}` : null,
    '',
    `Estamos te esperando para deixar a regua e o visual alinhados!`,
    '',
    `Gerenciar agendamento: ${chatbotUrl}`,
    '',
    `Qualquer imprevisto, e so avisar por aqui. Ate logo!`,
  ].filter((line) => line !== null);

  return lines.join('\n');
}

/**
 * 2. LEMBRETE DE RETORNO / FIDELIDADE (Para reativação na aba de Ciclos de Retorno)
 * Aponta exclusivamente para o Chatbot oficial de agendamento.
 */
export function buildReturnCycleReminderWhatsAppMessage({
  clientName,
  daysSinceLast,
}) {
  const firstName = clientName ? clientName.trim().split(' ')[0] : 'Amigo';
  const daysText = daysSinceLast ? `cerca de ${daysSinceLast} dias` : 'algumas semanas';
  const chatbotUrl = process.env.NEXT_PUBLIC_CHATBOT_URL || CHATBOT_BOOKING_URL;

  const lines = [
    `Fala, ${firstName}! Tudo certo por ai?`,
    '',
    `Passando para lembrar de manter a regua e o corte alinhados!`,
    `Ja faz ${daysText} desde o seu ultimo atendimento aqui na JM Barberclub.`,
    '',
    `Bora renovar o visual?`,
    '',
    `Escolha seu melhor horario: ${chatbotUrl}`,
    '',
    `Qualquer duvida, e so responder por aqui. Abraco!`,
  ];

  return lines.join('\n');
}

/**
 * 3. AVISO DE CANCELAMENTO
 */
export function buildCancellationWhatsAppMessage({
  clientName,
  serviceName,
  appointmentDate,
  appointmentTime,
  barberName,
  reason = null,
}) {
  const { dateStr, timeStr } = formatAppointmentDateTimePtBR(appointmentDate, appointmentTime);
  const formattedTime = timeStr || 'Horario agendado';
  const formattedDate = dateStr ? ` (${dateStr})` : '';

  const lines = [
    'AVISO DE CANCELAMENTO - JM BARBERCLUB',
    '',
    `Cliente: ${clientName || 'Cliente'}`,
    `Servico: ${serviceName || 'Corte/Barba'}`,
    `Horario: ${formattedTime}${formattedDate}`,
    barberName ? `Profissional: ${barberName}` : null,
    reason ? `Motivo: ${reason}` : null,
    '',
    'Vaga liberada: Esse horario ja voltou a ficar disponivel imediatamente no sistema para novos agendamentos!',
  ].filter((line) => line !== null);

  return lines.join('\n');
}

/**
 * Gera URL oficial de envio de WhatsApp usando api.whatsapp.com/send
 */
export function getWhatsAppClickToChatUrl(phone, message) {
  const formattedPhone = formatWhatsAppPhone(phone);
  if (!formattedPhone) return null;
  return `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
}

/**
 * Disparo automatizado de mensagem de WhatsApp via Webhook configurado.
 */
export async function sendWhatsAppNotification({ phone, message, metadata = {} }) {
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
  const formattedPhone = formatWhatsAppPhone(phone);

  if (!formattedPhone) {
    return { ok: false, error: 'Telefone inválido ou ausente.' };
  }

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

  const clickToChatUrl = getWhatsAppClickToChatUrl(formattedPhone, message);
  return {
    ok: true,
    sent: false,
    directUrl: clickToChatUrl,
    note: 'Webhook não configurado no ambiente. URL direta gerada.',
  };
}
