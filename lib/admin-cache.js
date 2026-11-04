"use client";

import { listAppointmentsByDate } from "@/lib/actions/appointments";
import { listServices } from "@/lib/actions/services";
import { listProducts } from "@/lib/actions/products";
import {
  listSchedule,
  listExceptions,
  getWeekScheduleStatus,
} from "@/lib/actions/schedule";
import { listTeam } from "@/lib/actions/team";
import { getShopBootstrapStatus } from "@/lib/actions/bootstrap";
import { todayInShop, addDaysStr } from "@/lib/dates";

/**
 * Armazenamento em memória (client-side) para estratégia Stale-While-Revalidate (SWR).
 * Mantém os dados já carregados entre trocas de abas no App Router com latência zero (0ms).
 */
const memoryStore = new Map();
const inflightRequests = new Map();
const listeners = new Set();

export const DEFAULT_TTL_MS = 60 * 1000; // 60s considerado fresco antes de revalidar em background

export const cacheKeys = {
  sessionBarber: () => "session:barber",
  team: () => "team:list",
  bootstrapStatus: () => "bootstrap:status",
  appointments: (date, scopeBarberId) =>
    `appointments:${date || "today"}:${scopeBarberId || "all"}`,
  services: () => "catalog:services",
  products: () => "catalog:products",
  schedule: (barberId) => `schedule:days:${barberId || "none"}`,
  exceptions: (barberId) => `schedule:exceptions:${barberId || "none"}`,
  weekSchedule: (fromDate, toDate, barberId) =>
    `schedule:week:${fromDate}:${toDate}:${barberId || "all"}`,
  finance: (from, to, scopeBarberId) =>
    `finance:${from}:${to}:${scopeBarberId || "all"}`,
  clients: (search, filter, scopeBarberId) =>
    `clients:${(search || "").trim().toLowerCase()}:${filter || "todos"}:${scopeBarberId || "all"}`,
  cancellations: (scopeBarberId) => `cancellations:${scopeBarberId || "all"}`,
};

/**
 * Lê sincronamente um valor do cache em memória.
 */
export function getCache(key) {
  if (!key) return undefined;
  const entry = memoryStore.get(key);
  return entry ? entry.data : undefined;
}

function isNonEmptyRequiredKey(key) {
  if (!key || typeof key !== "string") return false;
  return (
    key === "catalog:services" ||
    key === "catalog:products" ||
    key === "team:list" ||
    key.startsWith("schedule:days:")
  );
}

/**
 * Verifica se uma chave existe no cache em memória.
 */
export function hasCache(key) {
  if (!key || !memoryStore.has(key)) return false;
  const entry = memoryStore.get(key);
  if (isNonEmptyRequiredKey(key) && Array.isArray(entry?.data) && entry.data.length === 0) {
    return false;
  }
  return true;
}

/**
 * Verifica se o dado em cache ainda está dentro do TTL (fresco).
 */
export function isCacheFresh(key, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return false;
  const entry = memoryStore.get(key);
  if (!entry) return false;
  if (isNonEmptyRequiredKey(key) && Array.isArray(entry.data) && entry.data.length === 0) {
    return false;
  }
  return Date.now() - entry.updatedAt < ttlMs;
}

/**
 * Grava ou atualiza sincronamente um valor no cache em memória.
 */
export function setCache(key, data) {
  if (!key) return data;
  memoryStore.set(key, {
    data,
    updatedAt: Date.now(),
  });
  listeners.forEach((fn) => {
    try {
      fn(key, data);
    } catch {
      // ignora erros de listener
    }
  });
  return data;
}

/**
 * Atualiza um valor existente no cache usando uma função updater.
 */
export function updateCache(key, updater) {
  if (!key) return undefined;
  const current = getCache(key);
  const next = typeof updater === "function" ? updater(current) : updater;
  if (next !== undefined) {
    setCache(key, next);
  }
  return next;
}

/**
 * Invalida uma chave exata ou todas as chaves que começam com determinado prefixo.
 */
export function invalidateCache(keyOrPrefix) {
  if (!keyOrPrefix) {
    memoryStore.clear();
    return;
  }
  for (const key of Array.from(memoryStore.keys())) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Busca dados com deduplicação de chamadas concorrentes e atualização automática do cache.
 * - Se `force = false` e o cache estiver fresco (< ttlMs), retorna imediatamente da memória.
 * - Se já houver uma requisição em andamento para a mesma chave, reutiliza a mesma Promise.
 */
export async function fetchWithCache(
  key,
  fetcher,
  { ttlMs = DEFAULT_TTL_MS, force = false, timeoutMs = 8000 } = {}
) {
  if (!key) {
    return fetcher();
  }

  if (!force && isCacheFresh(key, ttlMs)) {
    return getCache(key);
  }

  if (!force && inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }

  const promise = (async () => {
    let timerId = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(`CACHE_FETCH_TIMEOUT:${key}`)), timeoutMs);
      });
      const result = await Promise.race([fetcher(), timeoutPromise]);
      if (result !== undefined && !result?.error) {
        setCache(key, result);
      }
      return result;
    } finally {
      if (timerId) clearTimeout(timerId);
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

/**
 * Calcula a segunda-feira e o domingo da semana atual para aquecer o DateStepper.
 */
function getCurrentWeekRange(dateStr) {
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const monday = addDaysStr(dateStr, -((weekday + 6) % 7));
  const sunday = addDaysStr(monday, 6);
  return { fromDate: monday, toDate: sunday };
}

/**
 * Pré-aquece (em segundo plano, sem bloquear a thread principal) os dados essenciais
 * das abas principais (Agenda, Serviços, Produtos, Expediente e Equipe).
 */
export function warmupAdminTabsData({
  barberId,
  scopeBarberId = null,
  canViewAll = false,
  canManageServices = false,
} = {}) {
  if (typeof window === "undefined") return;

  const today = todayInShop();
  const { fromDate, toDate } = getCurrentWeekRange(today);
  const targetBarberId = scopeBarberId || barberId;

  const runWarmup = () => {
    // 1. Agenda do dia atual
    const apptKey = cacheKeys.appointments(today, scopeBarberId);
    if (!isCacheFresh(apptKey, DEFAULT_TTL_MS)) {
      fetchWithCache(apptKey, async () => {
        const res = await listAppointmentsByDate(today, scopeBarberId);
        if (res?.error) throw new Error(res.error);
        return res?.data || [];
      }).catch(() => {});
    }

    // 2. Indicadores de semana aberta/fechada do DateStepper
    const weekKey = cacheKeys.weekSchedule(fromDate, toDate, scopeBarberId);
    if (!isCacheFresh(weekKey, 5 * 60 * 1000)) {
      fetchWithCache(
        weekKey,
        () => getWeekScheduleStatus({ fromDate, toDate, barberId: scopeBarberId }),
        { ttlMs: 5 * 60 * 1000 }
      ).catch(() => {});
    }

    // 3. Catálogo de Serviços e Produtos (usados na aba Serviços e nos modais da Agenda)
    const servicesKey = cacheKeys.services();
    if (!isCacheFresh(servicesKey, 2 * 60 * 1000)) {
      fetchWithCache(
        servicesKey,
        async () => (await listServices()) || [],
        { ttlMs: 2 * 60 * 1000 }
      ).catch(() => {});
    }

    const productsKey = cacheKeys.products();
    if (!isCacheFresh(productsKey, 2 * 60 * 1000)) {
      fetchWithCache(
        productsKey,
        async () => (await listProducts()) || [],
        { ttlMs: 2 * 60 * 1000 }
      ).catch(() => {});
    }

    // 4. Expediente e bloqueios do profissional atual
    if (targetBarberId) {
      const schedKey = cacheKeys.schedule(targetBarberId);
      if (!isCacheFresh(schedKey, 2 * 60 * 1000)) {
        fetchWithCache(
          schedKey,
          async () => (await listSchedule(targetBarberId)) || [],
          { ttlMs: 2 * 60 * 1000 }
        ).catch(() => {});
      }

      const excKey = cacheKeys.exceptions(targetBarberId);
      if (!isCacheFresh(excKey, 2 * 60 * 1000)) {
        fetchWithCache(
          excKey,
          async () => (await listExceptions(targetBarberId)) || [],
          { ttlMs: 2 * 60 * 1000 }
        ).catch(() => {});
      }
    }

    // 5. Equipe e Bootstrap Status para liderança
    if (canViewAll || canManageServices) {
      const teamKey = cacheKeys.team();
      if (!isCacheFresh(teamKey, 2 * 60 * 1000)) {
        fetchWithCache(
          teamKey,
          async () => (await listTeam()) || [],
          { ttlMs: 2 * 60 * 1000 }
        ).catch(() => {});
      }

      const bootKey = cacheKeys.bootstrapStatus();
      if (!isCacheFresh(bootKey, 5 * 60 * 1000)) {
        fetchWithCache(
          bootKey,
          () => getShopBootstrapStatus(),
          { ttlMs: 5 * 60 * 1000 }
        ).catch(() => {});
      }
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(runWarmup, { timeout: 600 });
  } else {
    setTimeout(runWarmup, 80);
  }
}
