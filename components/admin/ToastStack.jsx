'use client';

import {
  CalendarPlus,
  Zap,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react';
import { useNotifications } from '@/lib/notifications';

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    iconClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
    accentClass: 'bg-emerald-500',
  },
  error: {
    icon: AlertCircle,
    iconClass: 'text-red-400',
    borderClass: 'border-red-500/40',
    accentClass: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    accentClass: 'bg-amber-500',
  },
  info: {
    icon: Info,
    iconClass: 'text-blue-400',
    borderClass: 'border-blue-500/30',
    accentClass: 'bg-blue-500',
  },
  new_appointment: {
    icon: CalendarPlus,
    iconClass: 'text-red-400',
    borderClass: 'border-red-500/40',
    accentClass: 'bg-red-500',
  },
  walk_in: {
    icon: Zap,
    iconClass: 'text-amber-400',
    borderClass: 'border-amber-500/40',
    accentClass: 'bg-amber-500',
  },
  status_change: {
    icon: RefreshCcw,
    iconClass: 'text-zinc-300',
    borderClass: 'border-zinc-700/60',
    accentClass: 'bg-zinc-400',
  },
};

/**
 * ToastStack:
 * Notificações flutuantes modernas com tokens de design refinados:
 * fundo escuro #0f0f0f, detalhes em vermelho vivo/acentos temáticos e alto contraste.
 */
export default function ToastStack() {
  const { toasts, dismissToast } = useNotifications();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-[calc(env(safe-area-inset-top,0px)+62px)] inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
    >
      {toasts.map((toast) => {
        const config = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
        const Icon = config.icon;

        return (
          <div
            key={toast.toastId}
            role="status"
            className={`pointer-events-auto w-full max-w-sm flex items-center gap-3 bg-[#0f0f0f]/95 backdrop-blur-md border ${config.borderClass} rounded-2xl px-4 py-3 shadow-xl transition-all animate-fade-in relative overflow-hidden`}
          >
            {/* Linha indicadora sutil no topo do card */}
            <div
              className={`absolute top-0 left-0 right-0 h-[2px] ${config.accentClass} opacity-80`}
            />

            <div className="shrink-0 p-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800">
              <Icon size={16} className={config.iconClass} />
            </div>

            <p className="flex-1 text-zinc-100 text-xs font-medium leading-relaxed">
              {toast.message}
            </p>

            <button
              type="button"
              onClick={() => dismissToast(toast.toastId)}
              aria-label="Fechar notificação"
              className="text-zinc-500 hover:text-white p-1 rounded-lg transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
