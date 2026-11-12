'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const supabase = getSupabaseBrowserClient();

const NotificationContext = createContext(null);

function playAlertTone() {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [520, 780].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.2);
    });
  } catch {}
}

function showBrowserNotification(item) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const isCancel = item.type === 'cancelled_appointment' || item.type === 'status_change';
    new Notification(isCancel ? 'Agendamento Cancelado' : 'Novo agendamento', {
      body: item.message || `${item.client_name} • ${item.service_name}`,
      icon: '/icons/icon-192.png',
      tag: `${item.type || 'appt'}-${item.id}`,
    });
  } catch {}
}

function buildNotificationMessage(row, serviceName) {
  const client = row.client_name || 'Cliente';
  const svc = serviceName || row.service_name || row.service || 'Serviço';
  const timeStr = row.appointment_time ? String(row.appointment_time).slice(0, 5) : '';
  const dateStr = row.appointment_date
    ? String(row.appointment_date).slice(0, 10).split('-').reverse().slice(0, 2).join('/')
    : '';
  const when = [dateStr, timeStr ? `às ${timeStr}` : ''].filter(Boolean).join(' ');

  if (row.type === 'cancelled_appointment' || row.status === 'cancelado') {
    return `${client} cancelou ${svc}${when ? ` (${when})` : ''}`;
  }
  if (row.is_walk_in || row.type === 'walk_in') {
    return `Encaixe: ${client} • ${svc}${when ? ` (${when})` : ''}`;
  }
  return `Novo agendamento: ${client} • ${svc}${when ? ` (${when})` : ''}`;
}

/**
 * NotificationProvider (v2.8.2):
 * Isolamento estrito por profissional (`barberId`).
 * Cada barbeiro logado (ex: William, Matheus) recebe APENAS e EXCLUSIVAMENTE
 * as notificações e avisos direcionados à sua própria agenda e clientes.
 */
export function NotificationProvider({ barberId, children }) {
  const [notifications, setNotifications] = useState([]);
  const [permission, setPermission] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  // Limpa e carrega as notificações exclusivas do barbeiro logado ao iniciar ou trocar de perfil
  useEffect(() => {
    if (!barberId) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    setNotifications([]);

    async function loadBarberNotifications() {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('barber_id', barberId)
          .order('created_at', { ascending: false })
          .limit(20);

        if (!cancelled && !error && Array.isArray(data) && data.length > 0) {
          setNotifications(
            data
              .filter((row) => String(row.barber_id || '') === String(barberId))
              .map((row) => ({
                id: row.id,
                appointment_id: row.appointment_id,
                barber_id: row.barber_id,
                type:
                  row.type === 'cancelled_appointment'
                    ? 'status_change'
                    : row.type || 'new_appointment',
                client_name: row.client_name || 'Cliente',
                service_name: row.service_name || 'Atendimento',
                appointment_date: row.appointment_date,
                appointment_time: row.appointment_time,
                message: row.body || buildNotificationMessage(row, row.service_name),
                created_at: row.created_at,
                createdAt: row.created_at,
                read: Boolean(row.is_read),
              }))
          );
        }
      } catch {
        // Caso a tabela notifications ainda não exista, opera via canal Realtime isolado por barber_id
      }
    }

    loadBarberNotifications();

    return () => {
      cancelled = true;
    };
  }, [barberId]);

  useEffect(() => {
    if (!barberId) return;

    const channel = supabase
      .channel(`appointments-feed-barber-${barberId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'appointments',
          filter: `barber_id=eq.${barberId}`,
        },
        async (payload) => {
          const row = payload.new;
          if (!row) return;
          // Trava dupla de segurança: ignora qualquer evento que não pertença ao barbeiro logado
          if (String(row.barber_id || '') !== String(barberId)) return;

          let serviceName = row.service || 'Serviço';
          if (row.service_id) {
            const { data: svc } = await supabase
              .from('services')
              .select('name')
              .eq('id', row.service_id)
              .single();
            if (svc?.name) serviceName = svc.name;
          }

          const createdAt = row.created_at || new Date().toISOString();
          const type = row.is_walk_in ? 'walk_in' : 'new_appointment';
          const item = {
            id: row.id,
            appointment_id: row.id,
            barber_id: row.barber_id,
            type,
            client_name: row.client_name || 'Cliente',
            service_name: serviceName,
            appointment_date: row.appointment_date,
            appointment_time: row.appointment_time,
            message: buildNotificationMessage(row, serviceName),
            created_at: createdAt,
            createdAt,
            read: false,
          };

          setNotifications((prev) => {
            if (prev.some((n) => n.appointment_id === item.appointment_id && n.type === item.type)) {
              return prev;
            }
            return [item, ...prev].slice(0, 20);
          });
          playAlertTone();
          showBrowserNotification(item);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'appointments',
          filter: `barber_id=eq.${barberId}`,
        },
        async (payload) => {
          const row = payload.new;
          const oldRow = payload.old;
          if (!row) return;
          // Trava dupla de segurança: ignora eventos de outros barbeiros
          if (String(row.barber_id || '') !== String(barberId)) return;

          const becameCancelled =
            row.status === 'cancelado' && (!oldRow || oldRow.status !== 'cancelado');
          if (!becameCancelled) return;

          let serviceName = row.service || 'Serviço';
          if (row.service_id) {
            const { data: svc } = await supabase
              .from('services')
              .select('name')
              .eq('id', row.service_id)
              .single();
            if (svc?.name) serviceName = svc.name;
          }

          const createdAt = new Date().toISOString();
          const item = {
            id: `cancel-${row.id}-${Date.now()}`,
            appointment_id: row.id,
            barber_id: row.barber_id,
            type: 'status_change',
            client_name: row.client_name || 'Cliente',
            service_name: serviceName,
            appointment_date: row.appointment_date,
            appointment_time: row.appointment_time,
            message: buildNotificationMessage({ ...row, status: 'cancelado' }, serviceName),
            created_at: createdAt,
            createdAt,
            read: false,
          };

          setNotifications((prev) => [item, ...prev].slice(0, 20));
          playAlertTone();
          showBrowserNotification(item);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barberId]);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (barberId) {
      try {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('barber_id', barberId)
          .eq('is_read', false);
      } catch {}
    }
  }, [barberId]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    if (barberId) {
      try {
        await supabase
          .from('notifications')
          .delete()
          .eq('barber_id', barberId);
      } catch {}
    }
  }, [barberId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        permission,
        requestPermission,
        markAllRead,
        clearAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
