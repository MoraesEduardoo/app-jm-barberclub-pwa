'use client';

import { useState } from 'react';
import { Bell, CalendarPlus, Zap, RefreshCcw } from 'lucide-react';
import { useNotifications } from '@/lib/notifications';
import BottomSheet from './BottomSheet';

const ICONS = {
  new_appointment: CalendarPlus,
  walk_in: Zap,
  status_change: RefreshCcw,
};

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `${minutes} min atrás`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h atrás`;
}

export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          markAllRead();
        }}
        aria-label="Notificações"
        className="relative h-8 w-8 rounded-full flex items-center justify-center text-zinc-500 active:text-accent-light active:bg-zinc-900 transition-colors"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Notificações">
        {notifications.length === 0 ? (
          <p className="text-zinc-600 text-sm text-center py-8">
            Nenhuma notificação por enquanto.
          </p>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const Icon = ICONS[n.type] || Bell;
              return (
                <div
                  key={n.id}
                  className="flex items-start gap-3 bg-elevated border border-zinc-800 rounded-xl px-3.5 py-3"
                >
                  <div className="h-8 w-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <Icon size={15} className="text-accent-light" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm">{n.message}</p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
