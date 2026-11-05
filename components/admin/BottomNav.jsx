'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, Scissors, Clock, Users2 } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { warmupAdminTabsData } from '@/lib/admin-cache';
import { PERMISSION_KEYS } from '@/lib/auth';

/**
 * Abas principais da barra inferior (mobile-first):
 * Agenda, Serviços, Expediente e Equipe (para o Chefe).
 */
const BASE_TABS = [
  { key: 'agenda', href: '/admin/agenda', label: 'Agenda', icon: CalendarDays },
  { key: 'servicos', href: '/admin/servicos', label: 'Serviços', icon: Scissors },
  { key: 'expediente', href: '/admin/expediente', label: 'Expediente', icon: Clock },
];

const CHEFE_TAB = { key: 'equipe', href: '/admin/equipe', label: 'Equipe', icon: Users2 };

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    barber,
    isChefe,
    isLeadership,
    scopeBarberId,
    can,
    activeTab,
    setActiveTab,
  } = useBarber();

  const tabs = isChefe ? [...BASE_TABS, CHEFE_TAB] : BASE_TABS;

  // Faz prefetch proativo das rotas do App Router assim que a barra inferior é montada
  useEffect(() => {
    tabs.forEach(({ href }) => {
      try {
        router.prefetch(href);
      } catch {
        // ignora caso prefetch não esteja disponível
      }
    });
    // Também faz prefetch das páginas frequentes do menu lateral
    ['/admin/financeiro', '/admin/clientes', '/admin/cancelados'].forEach((route) => {
      try {
        router.prefetch(route);
      } catch {
        // ignora
      }
    });
  }, [router, isChefe]);

  const handleWarmupInteraction = () => {
    if (!barber?.id) return;
    warmupAdminTabsData({
      barberId: barber.id,
      scopeBarberId,
      canViewAll: isLeadership || can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS),
      canManageServices: can(PERMISSION_KEYS.MANAGE_SERVICES),
    });
  };

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800 bg-black/95 backdrop-blur-md safe-bottom select-none"
      role="navigation"
      aria-label="Navegação principal do painel"
    >
      <ul className="flex items-stretch justify-around">
        {tabs.map(({ key, href, label, icon: Icon }) => {
          const isRootDefault =
            !pathname || pathname === '/' || pathname === '/admin';
          const active =
            pathname === href ||
            pathname?.startsWith(`${href}/`) ||
            (key === 'agenda' && (isRootDefault || activeTab === 'agenda') && !pathname?.startsWith('/admin/servicos') && !pathname?.startsWith('/admin/expediente') && !pathname?.startsWith('/admin/equipe') && !pathname?.startsWith('/admin/financeiro') && !pathname?.startsWith('/admin/clientes') && !pathname?.startsWith('/admin/cancelados') && !pathname?.startsWith('/admin/galeria'));

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                prefetch={true}
                onClick={() => setActiveTab(key)}
                onPointerEnter={handleWarmupInteraction}
                onTouchStart={handleWarmupInteraction}
                className="relative flex flex-col items-center justify-center gap-1 py-2 min-h-[52px] active:scale-95 active:opacity-75 transition-all touch-manipulation"
              >
                {active && <span className="tab-indicator" aria-hidden="true" />}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.4 : 1.8}
                  className={active ? 'text-accent' : 'text-zinc-500'}
                />
                <span
                  className={`text-[10.5px] leading-none tracking-tight ${
                    active ? 'text-white font-medium' : 'text-zinc-500'
                  }`}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
