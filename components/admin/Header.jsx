'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
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
};

export default function Header({ pathname, onOpenProfile }) {
  const { barber, isChefe, signOut } = useBarber();

  const title =
    Object.entries(TITLES).find(([path]) => pathname?.startsWith(path))?.[1] ?? 'Painel';

  return (
    <header className="sticky top-0 z-30 safe-top bg-black/95 backdrop-blur border-b border-zinc-800">
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
            className="h-8 w-8 rounded-full bg-elevated border border-zinc-700 overflow-hidden flex items-center justify-center text-xs font-semibold text-white active:opacity-80"
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
            className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-500 active:text-accent-light active:bg-zinc-900 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
