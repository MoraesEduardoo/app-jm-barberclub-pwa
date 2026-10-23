'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, X, HelpCircle, AlertCircle } from 'lucide-react';

/**
 * ConfirmDialog:
 * Modal de confirmação nativo e elegante para substituir window.confirm() e alert() do browser.
 * Totalmente integrado ao design system dark do JM BarberClub com animação fluida e suporte a safe-area.
 */
export default function ConfirmDialog({
  open,
  title = "Confirmação",
  description = "Tem certeza que deseja realizar esta ação?",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger", // 'danger' | 'warning' | 'primary'
  icon = null,
  onConfirm,
  onCancel,
  loading = false,
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 select-none touch-manipulation">
      {/* Backdrop escuro com blur */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fade-in"
        onClick={loading ? undefined : onCancel}
      />

      {/* Caixa de Diálogo Centralizada */}
      <div className="relative w-full max-w-sm bg-[#121214] border border-zinc-800 rounded-2xl p-5 shadow-2xl animate-scale-in z-10 text-center">
        {/* Ícone de Destaque */}
        <div
          className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3.5 border ${
            variant === 'danger'
              ? 'bg-red-500/15 border-red-500/30 text-red-400'
              : variant === 'warning'
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : 'bg-accent/15 border-accent/30 text-accent-light'
          }`}
        >
          {icon || (variant === 'danger' ? <Trash2 size={20} /> : <AlertCircle size={20} />)}
        </div>

        {/* Título e Descrição */}
        <h3 className="text-white font-bold text-base tracking-tight mb-1.5">{title}</h3>
        <p className="text-zinc-400 text-xs leading-relaxed mb-5 px-1">{description}</p>

        {/* Botões de Ação */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl bg-surface border border-zinc-700/80 text-zinc-300 font-semibold text-xs active:scale-95 active:bg-zinc-800 transition-all touch-manipulation disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`flex-1 h-11 rounded-xl font-bold text-xs text-white transition-all shadow-sm active:scale-95 touch-manipulation disabled:opacity-50 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-500 active:bg-red-700'
                : variant === 'warning'
                ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700'
                : 'bg-accent hover:bg-accent-dark'
            }`}
          >
            {loading ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
