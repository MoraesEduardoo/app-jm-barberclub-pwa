"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { endSession } from "@/lib/session";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";
import { getCurrentBarber } from "@/lib/actions/session";
import { BarberProvider, useBarber } from "@/lib/barber-context";
import { NotificationProvider } from "@/lib/notifications";
import Header from "@/components/admin/Header";
import BottomNav from "@/components/admin/BottomNav";
import ProfileSheet from "@/components/admin/ProfileSheet";
import ToastStack from "@/components/admin/ToastStack";

// Vive DENTRO do BarberProvider para poder usar useBarber().
function AdminShell({ children, onProfileUpdated }) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const { barber, isChefe, selectedBarberId, selectBarber } = useBarber();

  // Notificações seguem SEMPRE quem está logado, não quem está a ser visualizado.
  const scopeAllNotifications = hasPermission(barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  return (
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
        isChefe={isChefe}
        onProfileUpdated={onProfileUpdated}
        selectedBarberId={selectedBarberId}
        onSelectBarber={selectBarber}
      />
    </NotificationProvider>
  );
}

export default function AdminLayout({ children }) {
  const [status, setStatus] = useState("loading"); // loading | ok
  const [barber, setBarber] = useState(null);

  useEffect(() => {
    let active = true;

    async function authenticate() {
      const res = await getCurrentBarber();
      if (!active) return;
      if (res?.error || !res?.barber) {
        await endSession();
        return;
      }
      setBarber(res.barber);
      setStatus("ok");
    }

    authenticate();
    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-accent" size={28} />
        <p className="text-zinc-500 text-sm">Carregando painel…</p>
      </div>
    );
  }

  return (
    <BarberProvider barber={barber} signOut={endSession}>
      <AdminShell onProfileUpdated={(updated) => setBarber(updated)}>{children}</AdminShell>
    </BarberProvider>
  );
}
