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

  const [activeTab, setActiveTab] = useState("agenda");
  const [selectedBarberId, setSelectedBarberId] = useState(() => barber?.id || null);
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

  // Quando selectedBarberId é null ("Todos"), scopeBarberId é null para quem tem permissão de ver todos
  const scopeBarberId = selectedBarberId ?? (canViewAll ? null : barber?.id);

  // Pré-aquece os dados das abas secundárias após o carregamento prioritário da Agenda
  useEffect(() => {
    if (!barber?.id) return;
    const timer = setTimeout(() => {
      warmupAdminTabsData({
        barberId: barber.id,
        scopeBarberId,
        canViewAll: leadership || canViewAll,
        canManageServices,
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [barber?.id, scopeBarberId, leadership, canViewAll, canManageServices]);

  // Se o profissional selecionado deixou de existir ou foi desativado, volta ao barbeiro logado.
  useEffect(() => {
    if (!selectedBarberId || team.length === 0) return;
    const member = team.find((m) => m.id === selectedBarberId);
    if (!member || member.active === false) setSelectedBarberId(barber?.id || null);
  }, [team, selectedBarberId, barber?.id]);

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

  const resetView = useCallback(
    () => selectBarber(barber?.id || null),
    [selectBarber, barber?.id]
  );

  const value = useMemo(() => {
    const viewedBarber = selectedBarberId
      ? team.find((m) => m.id === selectedBarberId) ||
        (selectedBarberId === barber?.id
          ? barber
          : { id: selectedBarberId, name: "", avatar_url: null })
      : barber;

    const isViewingOther =
      selectedBarberId !== null &&
      String(selectedBarberId) !== String(barber?.id);

    return {
      barber,
      isChefe: chefe,
      isManager: manager,
      isLeadership: leadership,
      can: (key) => hasPermission(barber, key),
      signOut,

      activeTab,
      setActiveTab,

      selectedBarberId,
      viewedBarber,
      isViewingOther,
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
    signOut,
    activeTab,
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
