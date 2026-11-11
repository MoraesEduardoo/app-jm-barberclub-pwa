'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, Scissors, Clock, Users2, Plus } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { warmupAdminTabsData } from '@/lib/admin-cache';
import { PERMISSION_KEYS } from '@/lib/auth';

/**
 * Abas laterais da pílula flutuante inferior (v2.8.1):
 * Esquerda: Agenda, Serviços
 * Centro: Botão Circular Flutuante Elevado (+ Novo Atendimento / Encaixe)
 * Direita: Expediente, Equipa
 */
const LEFT_TABS = [
  { key: 'agenda', href: '/admin/agenda', label: 'Agenda', icon: CalendarDays },
  { key: 'servicos', href: '/admin/servicos', label: 'Serviços', icon: Scissors },
];

const RIGHT_TABS = [
  { key: 'expediente', href: '/admin/expediente', label: 'Expediente', icon: Clock },
  { key: 'equipe', href: '/admin/equipe', label: 'Equipa', icon: Users2 },
];

const ALL_TABS = [...LEFT_TABS, ...RIGHT_TABS];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    barber,
    isLeadership,
    scopeBarberId,
    can,
    activeTab,
    setActiveTab,
  } = useBarber();

  // Faz prefetch proativo das rotas do App Router assim que a barra inferior é montada
  useEffect(() => {
    ALL_TABS.forEach(({ href }) => {
      try {
        router.prefetch(href);
      } catch {
        // ignora caso prefetch não esteja disponível
      }
    });
    ['/admin/financeiro', '/admin/clientes', '/admin/cancelados'].forEach((route) => {
      try {
        router.prefetch(route);
      } catch {
        // ignora
      }
    });
  }, [router]);

  const handleWarmupInteraction = () => {
    if (!barber?.id) return;
    warmupAdminTabsData({
      barberId: barber.id,
      scopeBarberId,
      canViewAll: isLeadership || can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS),
      canManageServices: can(PERMISSION_KEYS.MANAGE_SERVICES),
    });
  };

  const isTabActive = (key, href) => {
    const isRootDefault = !pathname || pathname === '/' || pathname === '/admin';
    return (
      pathname === href ||
      pathname?.startsWith(`${href}/`) ||
      (key === 'agenda' &&
        (isRootDefault || activeTab === 'agenda') &&
        !pathname?.startsWith('/admin/servicos') &&
        !pathname?.startsWith('/admin/expediente') &&
        !pathname?.startsWith('/admin/equipe') &&
        !pathname?.startsWith('/admin/financeiro') &&
        !pathname?.startsWith('/admin/clientes') &&
        !pathname?.startsWith('/admin/cancelados') &&
        !pathname?.startsWith('/admin/galeria'))
    );
  };

  const handleCenterAction = () => {
    handleWarmupInteraction();
    const onAgenda =
      !pathname ||
      pathname === '/' ||
      pathname === '/admin' ||
      pathname.startsWith('/admin/agenda');

    if (onAgenda && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('jm:open-walkin'));
      return;
    }

    setActiveTab('agenda');
    if (typeof window !== 'undefined') {
      window.__jmOpenWalkInOnMount = true;
    }
    router.push('/admin/agenda');
  };

  const renderTabItem = ({ key, href, label, icon: Icon }) => {
    const active = isTabActive(key, href);

    return (
      <li key={href} className="flex-1 min-w-0">
        <Link
          href={href}
          prefetch={true}
          onClick={() => setActiveTab(key)}
          onPointerEnter={handleWarmupInteraction}
          onTouchStart={handleWarmupInteraction}
          className="relative flex flex-col items-center justify-center gap-1 py-2 min-h-[52px] rounded-2xl active:scale-95 transition-all duration-200 touch-manipulation group"
        >
          {/* Indicador visual ativo subtil em vermelho/branco */}
          {active && (
            <span
              className="absolute top-1 h-1 w-5 rounded-full bg-gradient-to-r from-red-500 via-red-400 to-white/90 shadow-[0_0_10px_rgba(239,68,68,0.75)] transition-all duration-200"
              aria-hidden="true"
            />
          )}
          <Icon
            size={19}
            strokeWidth={active ? 2.4 : 1.8}
            className={`transition-all duration-200 ${
              active
                ? 'text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.35)]'
                : 'text-zinc-500 group-hover:text-zinc-300'
            }`}
          />
          <span
            className={`text-[10.5px] leading-none tracking-tight transition-colors duration-200 truncate max-w-full px-1 ${
              active
                ? 'text-white font-semibold'
                : 'text-zinc-500 group-hover:text-zinc-300'
            }`}
          >
            {label}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none px-3.5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2 select-none">
      <nav
        className="pointer-events-auto mx-auto max-w-md rounded-full bg-zinc-950/90 backdrop-blur-md border border-zinc-900 shadow-2xl px-2 py-1"
        role="navigation"
        aria-label="Navegação principal do painel"
      >
        <ul className="flex items-center justify-between gap-0.5">
          {LEFT_TABS.map(renderTabItem)}

          {/* Botão Central em Destaque (Circular Flutuante Elevado) */}
          <li className="shrink-0 px-1.5 flex items-center justify-center">
            <button
              type="button"
              onClick={handleCenterAction}
              aria-label="Novo atendimento ou encaixe"
              title="Novo atendimento / Encaixe"
              className="-mt-6 h-13 w-13 sm:h-14 sm:w-14 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 text-white shadow-lg shadow-red-600/40 ring-4 ring-black/95 flex items-center justify-center active:scale-95 transition-all duration-200 touch-manipulation"
            >
              <Plus size={25} strokeWidth={2.6} />
            </button>
          </li>

          {RIGHT_TABS.map(renderTabItem)}
        </ul>
      </nav>
    </div>
  );
}

