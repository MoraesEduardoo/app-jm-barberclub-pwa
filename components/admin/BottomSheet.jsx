'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';

export default function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />
      <div className="relative w-full max-w-md bg-surface border-t border-zinc-800 rounded-t-2xl safe-bottom animate-fade-in">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-800">
          <h2 className="text-white font-semibold text-base">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-400 active:bg-zinc-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 max-h-[75vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
