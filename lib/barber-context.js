'use client';

import { createContext, useContext } from 'react';

export const BarberContext = createContext(null);

/**
 * Retorna { barber, isChefe, can(key), signOut } do barbeiro logado no painel.
 * Deve ser usado dentro de app/admin/layout.jsx.
 */
export function useBarber() {
  const ctx = useContext(BarberContext);
  if (!ctx) {
    throw new Error('useBarber precisa ser usado dentro de <BarberProvider>');
  }
  return ctx;
}
