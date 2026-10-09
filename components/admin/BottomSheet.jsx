'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BottomSheet 100% otimizado para iOS Safari / iPhone e Next.js:
 * 1. Usa createPortal para renderizar o modal DIRETAMENTE no <body>.
 *    Isso evita que elementos ancestrais com backdrop-filter (como o Header)
 *    ou overflow/transforms prendam o modal ou façam o topo da página sumir.
 * 2. Bloqueio seguro de rolagem no body sem aplicar position: fixed que quebrava o scroll.
 * 3. Utiliza unidades dinâmicas 88dvh adaptáveis ao teclado virtual do iOS.
 * 4. Incorpora drag-handle tátil superior e padding seguro para a barra Home Indicator do iPhone.
 */
export default function BottomSheet({ open, onClose, title, children }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    // Bloqueia rolagem do fundo mantendo a posição e o cabeçalho visíveis
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  const content = (
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

  return createPortal(content, document.body);
}
