"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { endSession } from "@/lib/session";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";
import { getCurrentBarber } from "@/lib/actions/session";
import { BarberProvider, useBarber } from "@/lib/barber-context";
import { NotificationProvider } from "@/lib/notifications";
import { cacheKeys, getCache, setCache, invalidateCache } from "@/lib/admin-cache";
import Header from "@/components/admin/Header";
import BottomNav from "@/components/admin/BottomNav";
import ProfileSheet from "@/components/admin/ProfileSheet";
import ToastStack from "@/components/admin/ToastStack";
import HamburgerDrawer from "@/components/admin/HamburgerDrawer";
import ClientCyclesSheet from "@/components/admin/ClientCyclesSheet";
import CommissionSettlementSheet from "@/components/admin/CommissionSettlementSheet";
import AgendaPage from "./agenda/page";

function resolveTabFromPathname(pathname) {
  if (!pathname || pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/agenda")) {
    return "agenda";
  }
  if (pathname.startsWith("/admin/servicos")) return "servicos";
  if (pathname.startsWith("/admin/expediente")) return "expediente";
  if (pathname.startsWith("/admin/equipe")) return "equipe";
  if (pathname.startsWith("/admin/financeiro")) return "financeiro";
  if (pathname.startsWith("/admin/clientes")) return "clientes";
  if (pathname.startsWith("/admin/cancelados")) return "cancelados";
  if (pathname.startsWith("/admin/galeria")) return "galeria";
  return "agenda";
}

// Vive DENTRO do BarberProvider para poder usar useBarber().
function AdminShell({ children, onProfileUpdated }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recorrenciasOpen, setRecorrenciasOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const {
    barber,
    isChefe,
    isLeadership,
    selectedBarberId,
    selectBarber,
    setActiveTab,
  } = useBarber();

  const isDefaultRoot = !pathname || pathname === "/" || pathname === "/admin";
  const effectivePathname = isDefaultRoot ? "/admin/agenda" : pathname;

  // Garante que a aba ativa inicial seja obrigatoriamente 'agenda' assim que o painel monta
  useEffect(() => {
    const resolvedTab = resolveTabFromPathname(pathname);
    setActiveTab(resolvedTab);
    if (isDefaultRoot) {
      router.replace("/admin/agenda");
    }
  }, [pathname, isDefaultRoot, router, setActiveTab]);

  // Notificações isoladas estritamente pelo barbeiro logado (v2.8.2): cada profissional recebe apenas alertas da sua agenda
  return (
    <NotificationProvider barberId={barber.id}>
      <div className="min-h-screen bg-black flex flex-col">
        <Header
          pathname={effectivePathname}
          onOpenProfile={() => setProfileOpen(true)}
          onOpenMenu={() => setDrawerOpen(true)}
        />
        <ToastStack />
        <main className="flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+100px)]">
          {isDefaultRoot ? <AgendaPage /> : children}
        </main>
        <BottomNav />
      </div>

      <HamburgerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOpenRecorrencias={() => setRecorrenciasOpen(true)}
        onOpenSettlement={() => setSettlementOpen(true)}
      />

      <ClientCyclesSheet
        open={recorrenciasOpen}
        onClose={() => setRecorrenciasOpen(false)}
        scopeBarberId={isLeadership ? selectedBarberId : barber.id}
      />

      {isChefe && (
        <CommissionSettlementSheet
          open={settlementOpen}
          onClose={() => setSettlementOpen(false)}
        />
      )}

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
  const cachedBarber = getCache(cacheKeys.sessionBarber()) || null;
  const [status, setStatus] = useState(() => (cachedBarber ? "ok" : "loading")); // loading | ok
  const [barber, setBarber] = useState(() => cachedBarber);

  useEffect(() => {
    let active = true;

    async function authenticate() {
      const res = await getCurrentBarber();
      if (!active) return;
      if (res?.error || !res?.barber) {
        invalidateCache();
        await endSession();
        return;
      }
      setCache(cacheKeys.sessionBarber(), res.barber);
      setBarber(res.barber);
      setStatus("ok");
    }

    authenticate();
    return () => {
      active = false;
    };
  }, []);

  const handleSignOut = async () => {
    invalidateCache();
    await endSession();
  };

  if (status === "loading" || !barber) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-accent" size={28} />
        <p className="text-zinc-500 text-sm">Carregando painel…</p>
      </div>
    );
  }

  return (
    <BarberProvider barber={barber} signOut={handleSignOut}>
      <AdminShell
        onProfileUpdated={(updated) => {
          setCache(cacheKeys.sessionBarber(), updated);
          setBarber(updated);
        }}
      >
        {children}
      </AdminShell>
    </BarberProvider>
  );
}
