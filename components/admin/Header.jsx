'use client';

import { LogOut, ShieldCheck, Eye, X } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import NotificationBell from './NotificationBell';

const TITLES = {
  '/admin/agenda': 'Agenda',
  '/admin/servicos': 'Serviços & Preços',
  '/admin/expediente': 'Expediente',
  // Mais específica primeiro: startsWith('/admin/financeiro') também bate
  // com '/admin/financeiro/completo', então essa entrada precisa ser
  // checada antes da genérica logo abaixo.
  '/admin/financeiro/completo': 'Financeiro Completo',
  '/admin/financeiro': 'Caixa & Faturamento',
  '/admin/equipe': 'Equipe & Permissões',
  '/admin/galeria': 'Galeria de Cortes',
};

// Telas cujos dados mudam conforme o profissional selecionado pelo Chefe.
// (Serviços, Equipe e Financeiro Completo são da barbearia inteira.)
function isScopedPath(pathname) {
  if (!pathname) return false;
  if (pathname.startsWith('/admin/financeiro/completo')) return false;
  return (
    pathname.startsWith('/admin/agenda') ||
    pathname.startsWith('/admin/expediente') ||
    pathname.startsWith('/admin/financeiro')
  );
}

export default function Header({ pathname, onOpenProfile }) {
  const { barber, isChefe, signOut, isViewingOther, viewedBarber, resetView } = useBarber();
  const showViewBanner = isChefe && isViewingOther && isScopedPath(pathname);
  const viewedIsSelf = viewedBarber?.id === barber?.id;

  const title =
    Object.entries(TITLES).find(([path]) => pathname?.startsWith(path))?.[1] ?? 'Painel';

  return (
    <header className="sticky top-0 z-30 safe-top bg-black/95 backdrop-blur-md border-b border-zinc-800 select-none">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex flex-col leading-tight">
          <span className="text-white font-semibold text-base">{title}</span>
          <span className="text-zinc-500 text-xs">
            {isChefe ? 'Acesso total' : 'Meus atendimentos'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isChefe && (
            <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent-light">
              <ShieldCheck size={12} />
              Chefe
            </span>
          )}
          <NotificationBell />
          <button
            onClick={onOpenProfile}
            aria-label="Abrir meu perfil"
            className="h-8 w-8 rounded-full bg-elevated border border-zinc-700 overflow-hidden flex items-center justify-center text-xs font-semibold text-white active:scale-95 active:opacity-80 transition-transform touch-manipulation"
          >
            {barber?.avatar_url ? (
              <img src={barber.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              barber?.name?.charAt(0)?.toUpperCase() ?? '?'
            )}
          </button>
          <button
            onClick={signOut}
            aria-label="Sair do painel"
            className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-500 active:scale-95 active:text-accent-light active:bg-zinc-900 transition-all touch-manipulation"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {showViewBanner && (
        <div className="flex items-center justify-between gap-3 px-4 py-1.5 bg-accent/10 border-t border-accent/30">
          <span className="flex items-center gap-1.5 min-w-0 text-xs text-accent-light">
            <Eye size={13} className="shrink-0" />
            <span className="truncate">
              Painel de <strong className="font-semibold">{viewedBarber?.name || 'outro profissional'}</strong>
              {viewedIsSelf ? ' (você)' : ''}
            </span>
          </span>
          <button
            onClick={resetView}
            className="shrink-0 flex items-center gap-1 rounded-full border border-accent/40 px-2.5 py-0.5 text-[11px] font-medium text-accent-light active:bg-accent/20"
          >
            <X size={11} />
            Visão geral
          </button>
        </div>
      )}
    </header>
  );
}
