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
import { hasPermission, isChefe as checkIsChefe, PERMISSION_KEYS } from "@/lib/auth";
import { listTeam } from "@/lib/actions/team";

export const BarberContext = createContext(null);

/**
 * Retorna:
 *  - barber            quem está LOGADO (identidade e permissões — nunca muda)
 *  - isChefe, can(key), signOut
 *  - selectedBarberId  id do profissional que o Chefe escolheu ver, ou null
 *                      (null = visão padrão: o Chefe vê tudo / o barbeiro vê o seu)
 *  - viewedBarber      objeto de quem está a ser visualizado (cai no próprio barber)
 *  - isViewingOther    true quando há um profissional selecionado
 *  - scopeBarberId     id para filtrar agenda/finanças; null = sem filtro (todos)
 *  - selectBarber(id)  só tem efeito para o Chefe; devolve false se foi cancelado
 *  - resetView()       volta à visão padrão
 *  - team, refreshTeam() equipa carregada uma vez (só para o Chefe)
 *  - setSelectionGuard(fn|null)  uma página pode vetar a troca (ex.: alterações por salvar)
 */
export function useBarber() {
  const ctx = useContext(BarberContext);
  if (!ctx) {
    throw new Error("useBarber precisa ser usado dentro de <BarberProvider>");
  }
  return ctx;
}

export function BarberProvider({ barber, signOut, children }) {
  const chefe = checkIsChefe(barber);
  const canViewAll = hasPermission(barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [selectedBarberId, setSelectedBarberId] = useState(null);
  const [team, setTeam] = useState([]);
  const guardRef = useRef(null);

  const refreshTeam = useCallback(async () => {
    if (!chefe) return [];
    try {
      const members = await listTeam();
      setTeam(members);
      return members;
    } catch {
      return [];
    }
  }, [chefe]);

  useEffect(() => {
    refreshTeam();
  }, [refreshTeam]);

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
      if (!chefe) return false; // a UI esconde o seletor, mas o contexto também protege
      const next = id || null;
      if (next === selectedBarberId) return true;
      if (guardRef.current && guardRef.current() === false) return false;
      setSelectedBarberId(next);
      return true;
    },
    [chefe, selectedBarberId]
  );

  const resetView = useCallback(() => selectBarber(null), [selectBarber]);

  const value = useMemo(() => {
    const viewedBarber = selectedBarberId
      ? team.find((m) => m.id === selectedBarberId) ||
        (selectedBarberId === barber.id ? barber : { id: selectedBarberId, name: "", avatar_url: null })
      : barber;

    return {
      barber,
      isChefe: chefe,
      can: (key) => hasPermission(barber, key),
      signOut,

      selectedBarberId,
      viewedBarber,
      isViewingOther: selectedBarberId !== null,
      scopeBarberId: selectedBarberId ?? (canViewAll ? null : barber.id),
      selectBarber,
      resetView,
      setSelectionGuard,

      team,
      refreshTeam,
    };
  }, [barber, chefe, canViewAll, signOut, selectedBarberId, team, selectBarber, resetView, setSelectionGuard, refreshTeam]);

  return <BarberContext.Provider value={value}>{children}</BarberContext.Provider>;
}
