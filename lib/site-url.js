// Resolução rigorosa do host de produção/redirecionamento.
// Garante o uso de NEXT_PUBLIC_SITE_URL em produção para evitar falhas com proxies reversos.

export const CHATBOT_URL = 'https://chatbot-jmbarberclub.vercel.app/';

export function getSiteUrl(reqHeaders = null) {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (fromEnv && typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/+$/, "");
  }

  // Em produção, a ausência de NEXT_PUBLIC_SITE_URL deve acionar um aviso crítico
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    // Log controlado de aviso de configuração sem vazar dados sensíveis
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[getSiteUrl] ATENÇÃO: NEXT_PUBLIC_SITE_URL não configurada em ambiente de produção.");
    }
  }

  if (reqHeaders) {
    const host = reqHeaders.get?.("x-forwarded-host") || reqHeaders.get?.("host") || "";
    if (host) {
      const proto =
        reqHeaders.get?.("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  }

  return "http://localhost:3000";
}
