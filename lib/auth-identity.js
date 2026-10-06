// Usado no cliente (login) e no servidor (criar utilizador). Sem dependências.
const DOMAIN = process.env.NEXT_PUBLIC_BARBER_AUTH_DOMAIN || "barbers.jmbarberclub.app";

export function phoneDigits(phone) {
  return (phone || "").replace(/\D/g, "");
}

export function phoneToAuthEmail(phone) {
  return `${phoneDigits(phone)}@${DOMAIN}`;
}
