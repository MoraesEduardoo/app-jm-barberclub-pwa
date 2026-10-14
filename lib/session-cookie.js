import { cookies } from "next/headers";
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "jm_barber_session";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "jm-barberclub-session-secret-key-2026-safe-production";

function base64url(str) {
  return Buffer.from(str).toString("base64url");
}

function fromBase64url(str) {
  return Buffer.from(str, "base64url").toString("utf-8");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

export function createSessionToken(barber) {
  const data = {
    barberId: barber.id,
    name: barber.name,
    phone: barber.phone,
    role: barber.role,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 dias
  };

  const payload = base64url(JSON.stringify(data));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = sign(payload);
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const data = JSON.parse(fromBase64url(payload));
    if (!data || !data.barberId) return null;
    if (data.exp && Date.now() > data.exp) return null; // Expirado
    return data;
  } catch {
    return null;
  }
}

/**
 * Grava o cookie de sessão do barbeiro no cabeçalho HTTP
 */
export async function setBarberSessionCookie(barber) {
  const cookieStore = await cookies();
  const token = createSessionToken(barber);

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  });

  return token;
}

/**
 * Obtém a sessão do barbeiro através do cookie
 */
export async function getBarberSessionFromCookie() {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!cookie?.value) return null;
    return verifySessionToken(cookie.value);
  } catch {
    return null;
  }
}

/**
 * Remove o cookie de sessão (Logout)
 */
export async function clearBarberSessionCookie() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
  } catch {}
}
