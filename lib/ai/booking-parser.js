/**
 * Motor de Processamento de Linguagem Natural (NLP) e IA para o Chatbot de Agendamento.
 * Transforma comandos livres do cliente em dados estruturados de agendamento.
 *
 * Exemplo de entrada: "quero dar um tapa no visual com o Matheus amanhã à tarde"
 * Exemplo de saída: {
 *   intent: 'booking',
 *   service: 'Corte Tradicional / Degradê',
 *   barberName: 'Matheus',
 *   relativeDay: 'amanhã',
 *   date: '2026-10-11',
 *   period: 'tarde',
 *   summary: 'Entendi! Agendamento de corte com Matheus para amanhã no período da tarde.'
 * }
 */

const COMMON_SERVICES = [
  { match: /degrad[eê]|disfarce|fade|tapa no visual/i, name: 'Degradê', category: 'corte' },
  { match: /corte|cortar( o cabelo)?|cabelo/i, name: 'Corte Cabelo', category: 'corte' },
  { match: /barba|barboterapia|fazer a barba/i, name: 'Barba', category: 'barba' },
  { match: /sobrancelha/i, name: 'Sobrancelha', category: 'acabamento' },
  { match: /pezinho|acabamento|pezin/i, name: 'Pézinho', category: 'acabamento' },
  { match: /platinad[oa]|nevou|luzes/i, name: 'Platinado / Nevou', category: 'quimica' },
];

const WEEKDAYS = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  terça: 2,
  'terca-feira': 2,
  'terça-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
  sábado: 6,
};

/**
 * Calcula a data alvo a partir de termos como "hoje", "amanhã" ou dias da semana
 */
function resolveDateFromText(text, referenceDate = new Date()) {
  const lower = text.toLowerCase();
  const target = new Date(referenceDate);

  if (/\bhoje\b/i.test(lower)) {
    return {
      dateString: target.toISOString().slice(0, 10),
      label: 'hoje',
    };
  }

  if (/\bamanh[aã]\b/i.test(lower)) {
    target.setDate(target.getDate() + 1);
    return {
      dateString: target.toISOString().slice(0, 10),
      label: 'amanhã',
    };
  }

  if (/\bdepois de amanh[aã]\b/i.test(lower)) {
    target.setDate(target.getDate() + 2);
    return {
      dateString: target.toISOString().slice(0, 10),
      label: 'depois de amanhã',
    };
  }

  // Busca dias da semana (ex: "na sexta", "no sábado")
  for (const [dayName, dayIndex] of Object.entries(WEEKDAYS)) {
    const regex = new RegExp(`\\b${dayName}\\b`, 'i');
    if (regex.test(lower)) {
      const currentDay = target.getDay();
      let diff = dayIndex - currentDay;
      if (diff <= 0) diff += 7; // Próxima ocorrência do dia
      target.setDate(target.getDate() + diff);
      return {
        dateString: target.toISOString().slice(0, 10),
        label: dayName,
      };
    }
  }

  return {
    dateString: null,
    label: null,
  };
}

/**
 * Detecta o período do dia ou horário numérico específico (ex: "à tarde", "às 15h", "10:30")
 */
function resolveTimeOrPeriod(text) {
  const lower = text.toLowerCase();

  // Horário numérico específico: "14h", "14:30", "às 15"
  const timeMatch = lower.match(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h(?:([0-5]\d))?)\b/i);
  if (timeMatch) {
    const hours = String(timeMatch[1]).padStart(2, '0');
    const minutes = String(timeMatch[2] || timeMatch[3] || '00').padStart(2, '0');
    return {
      specificTime: `${hours}:${minutes}`,
      period: Number(hours) < 12 ? 'manha' : Number(hours) < 18 ? 'tarde' : 'noite',
    };
  }

  if (/\b(de\s+)?manh[aã]\b/i.test(lower)) {
    return { specificTime: null, period: 'manha' };
  }
  if (/\b(à|a\s+)?tarde\b/i.test(lower)) {
    return { specificTime: null, period: 'tarde' };
  }
  if (/\b(à|a\s+)?noite\b/i.test(lower)) {
    return { specificTime: null, period: 'noite' };
  }

  return { specificTime: null, period: null };
}

/**
 * Detecta menção a nomes comuns de profissionais conhecidos na barbearia
 */
function resolveBarber(text, knownBarbers = []) {
  const lower = text.toLowerCase();

  // Verifica na lista de barbeiros cadastrados da equipe
  for (const b of knownBarbers) {
    if (b.name && lower.includes(b.name.toLowerCase())) {
      return b;
    }
  }

  // Fallback heurístico: "com o Matheus", "com João", "com o barbeiro X"
  const match = lower.match(/\bcom (?:o\s+)?([a-zà-ú]{3,15})\b/i);
  if (match) {
    const rawName = match[1];
    // Ignora termos comuns que não são nomes
    if (!['tempo', 'certeza', 'calma', 'corte', 'barba'].includes(rawName.toLowerCase())) {
      return {
        id: null,
        name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
      };
    }
  }

  return null;
}

/**
 * Função principal: analisa a mensagem livre e retorna a intenção e os slots estruturados
 */
export function parseBookingMessage(message, { knownBarbers = [], referenceDate = new Date() } = {}) {
  if (!message || typeof message !== 'string') {
    return { success: false, reason: 'Mensagem vazia' };
  }

  const raw = message.trim();

  // Detecta serviços mencionados
  const detectedServices = COMMON_SERVICES.filter((srv) => srv.match.test(raw)).map((s) => s.name);

  // Detecta barbeiro
  const barber = resolveBarber(raw, knownBarbers);

  // Detecta data
  const dateInfo = resolveDateFromText(raw, referenceDate);

  // Detecta horário ou turno
  const timeInfo = resolveTimeOrPeriod(raw);

  // Monta resumo amigável em português
  const parts = [];
  if (detectedServices.length > 0) {
    parts.push(`serviço de ${detectedServices.join(' + ')}`);
  }
  if (barber?.name) {
    parts.push(`com ${barber.name}`);
  }
  if (dateInfo.label) {
    parts.push(`para ${dateInfo.label}`);
  }
  if (timeInfo.specificTime) {
    parts.push(`às ${timeInfo.specificTime}`);
  } else if (timeInfo.period) {
    parts.push(`no turno da ${timeInfo.period}`);
  }

  const isBookingIntent =
    detectedServices.length > 0 ||
    Boolean(barber) ||
    Boolean(dateInfo.dateString) ||
    Boolean(timeInfo.period) ||
    /agendar|marcar|hor[aá]rio|vaga/i.test(raw);

  const summary =
    parts.length > 0
      ? `Perfeito! Entendi: ${parts.join(', ')}.`
      : 'Gostaria de agendar um horário na JM Barberclub?';

  return {
    success: true,
    isBookingIntent,
    detectedServices,
    barber,
    date: dateInfo.dateString,
    dateLabel: dateInfo.label,
    time: timeInfo.specificTime,
    period: timeInfo.period,
    summary,
    confidence: parts.length >= 2 ? 'high' : parts.length === 1 ? 'medium' : 'low',
  };
}
