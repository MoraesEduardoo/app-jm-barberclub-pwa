'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * BottomSheet 100% otimizado para iOS Safari / iPhone:
 * 1. Implementa o padrão rigoroso de Body Scroll Lock do WebKit (position: fixed + top offset).
 *    No iOS, apenas overflow: hidden no body NÃO funciona e causa vazamento de scroll e rubber-band.
 * 2. Utiliza unidades dinâmicas 85dvh para se adaptar com perfeição ao teclado virtual do iOS.
 * 3. Incorpora drag-handle tátil superior e padding seguro para a barra Home Indicator do iPhone.
 */
export default function BottomSheet({ open, onClose, title, children }) {
  const scrollOffsetRef = useRef(0);

  useEffect(() => {
    if (!open) return;

    // Guarda a posição atual de rolagem da tela
    const scrollY = window.scrollY || window.pageYOffset || 0;
    scrollOffsetRef.current = scrollY;

    // Trava de rolagem verdadeira para o Safari do iOS
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const originalOverflow = document.body.style.overflow;

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    return () => {
      // Restaura o layout e a rolagem original sem saltos na tela
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.overflow = originalOverflow;
      window.scrollTo(0, scrollOffsetRef.current);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center select-none">
      {/* Backdrop com desfoque e toque para fechar */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fade-in touch-manipulation cursor-pointer"
      />

      {/* Conteúdo do Sheet com safe-area do Home Indicator do iPhone */}
      <div className="relative w-full max-w-md bg-surface border-t border-zinc-800 rounded-t-2xl safe-bottom-sheet animate-fade-in z-10 shadow-2xl flex flex-col max-h-[88dvh]">
        {/* Indicador de puxar (iOS Drag Handle) */}
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="h-1 w-10 rounded-full bg-zinc-700/80" />
        </div>

        {/* Cabeçalho do modal */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-zinc-800 shrink-0">
          <h2 className="text-white font-semibold text-base tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-400 active:scale-95 active:bg-zinc-800 transition-transform touch-manipulation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Corpo scrollável independente com suporte a aceleração por hardware no iOS */}
        <div className="px-5 py-4 overflow-y-auto overscroll-contain scroll-touch flex-1 select-text">
          {children}
        </div>
      </div>
    </div>
  );
}
