'use client';

import { CalendarPlus, Zap, RefreshCcw, X } from 'lucide-react';
import { useNotifications } from '@/lib/notifications';

const ICONS = {
  new_appointment: CalendarPlus,
  walk_in: Zap,
  status_change: RefreshCcw,
};

/**
 * Alertas visuais que aparecem sozinhos no topo da tela quando chega um
 * evento em tempo real (novo agendamento, walk-in, mudança de status) e
 * somem depois de alguns segundos — não exigem que o barbeiro abra o sino.
 */
export default function ToastStack() {
  const { toasts, dismissToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none safe-top">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] || CalendarPlus;
        return (
          <div
            key={toast.toastId}
            className="pointer-events-auto w-full max-w-sm flex items-center gap-2.5 bg-elevated border border-accent/30 rounded-xl px-3.5 py-3 shadow-accent-glow animate-fade-in"
          >
            <Icon size={16} className="text-accent-light shrink-0" />
            <p className="flex-1 text-white text-xs font-medium">{toast.message}</p>
            <button
              onClick={() => dismissToast(toast.toastId)}
              aria-label="Fechar"
              className="text-zinc-500 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
