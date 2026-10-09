'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Scissors, Clock, Users2, Images } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';

/**
 * Abas principais da barra inferior (mobile-first):
 * 'Financeiro' foi retirado da barra de navegação principal e agora fica acessível
 * diretamente dentro do menu de Perfil (ProfileSheet) para simplificar a navegação.
 */
const BASE_TABS = [
  { href: '/admin/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/admin/servicos', label: 'Serviços', icon: Scissors },
  { href: '/admin/expediente', label: 'Expediente', icon: Clock },
  { href: '/admin/galeria', label: 'Galeria', icon: Images },
];

const CHEFE_TAB = { href: '/admin/equipe', label: 'Equipe', icon: Users2 };

export default function BottomNav() {
  const pathname = usePathname();
  const { isChefe } = useBarber();

  const tabs = isChefe ? [...BASE_TABS, CHEFE_TAB] : BASE_TABS;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800 bg-black/95 backdrop-blur-md safe-bottom select-none"
      role="navigation"
      aria-label="Navegação principal do painel"
    >
      <ul className="flex items-stretch justify-around">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
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
