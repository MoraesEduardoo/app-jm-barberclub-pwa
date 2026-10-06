'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export const NotificationContext = createContext(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications precisa ser usado dentro de <NotificationProvider>');
  }
  return ctx;
}

const MAX_NOTIFICATIONS = 30;

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Escuta em tempo real (Supabase Realtime) a tabela "appointments" e gera
 * notificações locais para:
 * - novo agendamento criado (INSERT)
 * - mudança de status — confirmado/cancelado (UPDATE em "status")
 *
 * Quando o barbeiro não tem permissão de ver a agenda de todo mundo
 * (VIEW_ALL_APPOINTMENTS), o canal já nasce filtrado pelo barber_id dele,
 * então só recebe eventos dos próprios atendimentos.
 */
export function NotificationProvider({ barberId, scopeAll, children }) {
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const pushNotification = useCallback((notification) => {
    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

    const toastId = ++toastIdRef.current;
    setToasts((prev) => [...prev, { ...notification, toastId }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
    }, 5000);
  }, []);

  useEffect(() => {
    if (!barberId) return;
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel('appointments-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'appointments',
          ...(scopeAll ? {} : { filter: `barber_id=eq.${barberId}` }),
        },
        (payload) => {
          const row = payload.new;
          pushNotification({
            id: `insert-${row.id}-${row.updated_at || row.appointment_date}`,
            type: row.is_walk_in ? 'walk_in' : 'new_appointment',
            message: row.is_walk_in
              ? `Cliente sem hora registrado: ${row.client_name || 'Cliente avulso'}`
              : `Novo agendamento: ${row.client_name || 'Cliente'} às ${formatTime(row.appointment_date)}`,
            createdAt: new Date().toISOString(),
            read: false,
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'appointments',
          ...(scopeAll ? {} : { filter: `barber_id=eq.${barberId}` }),
        },
        (payload) => {
          const row = payload.new;
          const prevStatus = payload.old?.status;
          if (!prevStatus || prevStatus === row.status) return; // ignora updates que não mudaram o status (ex.: pagamento)

          pushNotification({
            id: `update-${row.id}-${row.status}-${Date.now()}`,
            type: 'status_change',
            message:
              row.status === 'cancelado'
                ? `Agendamento cancelado: ${row.client_name || 'Cliente'}`
                : `Agendamento confirmado: ${row.client_name || 'Cliente'}`,
            createdAt: new Date().toISOString(),
            read: false,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barberId, scopeAll, pushNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, markAllRead, toasts, dismissToast }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
