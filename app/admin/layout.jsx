'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getBarberByPhone, isChefe, hasPermission, PERMISSION_KEYS } from '@/lib/auth';
import { getStoredPhone, clearStoredPhone } from '@/lib/session';
import { BarberContext } from '@/lib/barber-context';
import { NotificationProvider } from '@/lib/notifications';
import Header from '@/components/admin/Header';
import BottomNav from '@/components/admin/BottomNav';
import LoginScreen from '@/components/admin/LoginScreen';
import ProfileSheet from '@/components/admin/ProfileSheet';
import ToastStack from '@/components/admin/ToastStack';

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState('loading'); // loading | ok | login
  const [barber, setBarber] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function authenticate() {
      const phone = getStoredPhone();
      if (!phone) {
        if (active) setStatus('login');
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const found = await getBarberByPhone(supabase, phone);

      if (!active) return;
      if (!found) {
        clearStoredPhone();
        setStatus('login');
        return;
      }

      setBarber(found);
      setStatus('ok');
    }

    authenticate();
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(() => {
    clearStoredPhone();
    router.push('/');
  }, [router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-accent" size={28} />
        <p className="text-zinc-500 text-sm">Carregando painel…</p>
      </div>
    );
  }

  if (status === 'login') {
    return (
      <LoginScreen
        onSuccess={(found) => {
          setBarber(found);
          setStatus('ok');
        }}
      />
    );
  }

  const ctxValue = {
    barber,
    isChefe: isChefe(barber),
    can: (key) => hasPermission(barber, key),
    signOut,
  };

  // Barbeiro com VIEW_ALL_APPOINTMENTS (chefe, ou barbeiro secundário com a
  // permissão liberada) escuta notificações de TODA a agenda; os demais só
  // escutam os próprios atendimentos (o filtro é aplicado no próprio canal
  // do Supabase Realtime, dentro de NotificationProvider).
  const scopeAllNotifications = hasPermission(barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  return (
    <BarberContext.Provider value={ctxValue}>
      <NotificationProvider barberId={barber.id} scopeAll={scopeAllNotifications}>
        <div className="min-h-screen bg-black flex flex-col">
          <Header pathname={pathname} onOpenProfile={() => setProfileOpen(true)} />
          <ToastStack />
          <main className="flex-1 pb-24">{children}</main>
          <BottomNav />
        </div>

        <ProfileSheet
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          barber={barber}
          isChefe={isChefe(barber)}
          onProfileUpdated={(updated) => setBarber(updated)}
        />
      </NotificationProvider>
    </BarberContext.Provider>
  );
}
