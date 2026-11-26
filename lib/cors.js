/**
 * Utilitário centralizado para configuração segura de CORS nas rotas de API públicas do painel.
 * Substitui o curinga irrestrito '*' por origens estritamente permitidas e validadas:
 * - NEXT_PUBLIC_CHATBOT_URL (produção do chatbot)
 * - NEXT_PUBLIC_SITE_URL (domínio do painel)
 * - Origens de desenvolvimento locais (localhost:3000, localhost:3001, etc.)
 */

function sanitizeOrigin(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

export function getAllowedOrigins() {
  const origins = new Set();

  const chatbotEnv = sanitizeOrigin(process.env.NEXT_PUBLIC_CHATBOT_URL || process.env.CHATBOT_URL);
  if (chatbotEnv) origins.add(chatbotEnv);
  origins.add('https://chatbot-jmbarberclub.vercel.app');

  const siteEnv = sanitizeOrigin(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL);
  if (siteEnv) origins.add(siteEnv);
  origins.add('https://app-jm-barberclub-pwa.vercel.app');

  // Adiciona origens de desenvolvimento local
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3001');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://127.0.0.1:3001');
  }

  return origins;
}

export function resolveCorsOrigin(request) {
  const allowed = getAllowedOrigins();
  const requestOrigin = request?.headers?.get('origin');

  if (requestOrigin && allowed.has(requestOrigin)) {
    return requestOrigin;
  }

  // Fallback padrão seguro (domínio do chatbot oficial em produção ou localhost em dev)
  const defaultChatbot = sanitizeOrigin(process.env.NEXT_PUBLIC_CHATBOT_URL) || 'https://chatbot-jmbarberclub.vercel.app';
  return defaultChatbot;
}

export function buildCorsHeaders(request, { methods = 'GET, OPTIONS' } = {}) {
  const origin = resolveCorsOrigin(request);

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, x-push-secret, x-api-key',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store, max-age=0',
    Vary: 'Origin',
  };
}
