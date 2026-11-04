"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  hasPermission,
  isChefe as checkIsChefe,
  isManager as checkIsManager,
  isLeadership as checkIsLeadership,
  PERMISSION_KEYS,
} from "@/lib/auth";
import { listTeam } from "@/lib/actions/team";
import {
  cacheKeys,
  getCache,
  setCache,
  fetchWithCache,
  warmupAdminTabsData,
} from "@/lib/admin-cache";

export const BarberContext = createContext(null);

export function useBarber() {
  const ctx = useContext(BarberContext);
  if (!ctx) {
    throw new Error("useBarber precisa ser usado dentro de <BarberProvider>");
  }
  return ctx;
}

export function BarberProvider({ barber, signOut, children }) {
  const chefe = checkIsChefe(barber);
  const manager = checkIsManager(barber);
  const leadership = checkIsLeadership(barber);
  const canViewAll = hasPermission(barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
  const canManageServices = hasPermission(barber, PERMISSION_KEYS.MANAGE_SERVICES);
  const canManageScheduleOthers = hasPermission(
    barber,
    PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS
  );

  const [selectedBarberId, setSelectedBarberId] = useState(null);
  const [team, setTeam] = useState(() => getCache(cacheKeys.team()) || []);
  const guardRef = useRef(null);

  const refreshTeam = useCallback(
    async ({ force = false } = {}) => {
      if (!leadership && !canViewAll && !canManageScheduleOthers) return [];
      try {
        const members = await fetchWithCache(
          cacheKeys.team(),
          async () => (await listTeam()) || [],
          { ttlMs: 2 * 60 * 1000, force }
        );
        const list = members || [];
        setTeam(list);
        setCache(cacheKeys.team(), list);
        return list;
      } catch {
        return getCache(cacheKeys.team()) || [];
      }
    },
    [leadership, canViewAll, canManageScheduleOthers]
  );

  useEffect(() => {
    refreshTeam();
  }, [refreshTeam]);

  const scopeBarberId = selectedBarberId ?? (canViewAll ? null : barber.id);

  // Pré-aquece os dados das abas principais em background para troca de aba com latência 0ms
  useEffect(() => {
    if (!barber?.id) return;
    warmupAdminTabsData({
      barberId: barber.id,
      scopeBarberId,
      canViewAll: leadership || canViewAll,
      canManageServices,
    });
  }, [barber?.id, scopeBarberId, leadership, canViewAll, canManageServices]);

  // Se o profissional selecionado deixou de existir ou foi desativado, volta à visão padrão.
  useEffect(() => {
    if (!selectedBarberId || team.length === 0) return;
    const member = team.find((m) => m.id === selectedBarberId);
    if (!member || member.active === false) setSelectedBarberId(null);
  }, [team, selectedBarberId]);

  const setSelectionGuard = useCallback((fn) => {
    guardRef.current = fn || null;
  }, []);

  const selectBarber = useCallback(
    (id) => {
      if (!leadership && !canViewAll) return false;
      const next = id || null;
      if (next === selectedBarberId) return true;
      if (guardRef.current && guardRef.current() === false) return false;
      setSelectedBarberId(next);
      return true;
    },
    [leadership, canViewAll, selectedBarberId]
  );

  const resetView = useCallback(() => selectBarber(null), [selectBarber]);

  const value = useMemo(() => {
    const viewedBarber = selectedBarberId
      ? team.find((m) => m.id === selectedBarberId) ||
        (selectedBarberId === barber.id
          ? barber
          : { id: selectedBarberId, name: "", avatar_url: null })
      : barber;

    return {
      barber,
      isChefe: chefe,
      isManager: manager,
      isLeadership: leadership,
      can: (key) => hasPermission(barber, key),
      signOut,

      selectedBarberId,
      viewedBarber,
      isViewingOther: selectedBarberId !== null,
      scopeBarberId,
      selectBarber,
      resetView,
      setSelectionGuard,

      team,
      setTeam: (updater) => {
        setTeam((prev) => {
          const next = typeof updater === "function" ? updater(prev) : updater;
          setCache(cacheKeys.team(), next);
          return next;
        });
      },
      refreshTeam,
    };
  }, [
    barber,
    chefe,
    manager,
    leadership,
    canViewAll,
    signOut,
    selectedBarberId,
    scopeBarberId,
    team,
    selectBarber,
    resetView,
    setSelectionGuard,
    refreshTeam,
  ]);

  return <BarberContext.Provider value={value}>{children}</BarberContext.Provider>;
}
