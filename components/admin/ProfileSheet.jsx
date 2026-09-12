'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, TrendingUp, AlertCircle, ChevronRight, ShieldCheck } from 'lucide-react';
import BottomSheet from './BottomSheet';
import EditProfileSheet from './EditProfileSheet';
import { getFinanceSummary } from '@/lib/actions/finance';

function formatBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Aberto ao clicar no avatar no cabeçalho. Mostra os dados do barbeiro
 * logado e um resumo financeiro rápido (do dia) — o "Controle financeiro
 * no Perfil" pedido — com um atalho pra tela completa de Financeiro.
 */
export default function ProfileSheet({ open, onClose, barber, isChefe, onProfileUpdated }) {
  const router = useRouter();
  const [summary, setSummary] = useState(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (open) {
      const today = todayISO();
      getFinanceSummary({ from: today, to: today, scopeBarberId: barber.id })
        .then(setSummary)
        .catch(() => {});
    }
  }, [open, barber.id]);

  return (
    <>
      <BottomSheet open={open && !editOpen} onClose={onClose} title="Meu perfil">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-14 w-14 rounded-full bg-elevated border border-zinc-700 overflow-hidden flex items-center justify-center text-lg font-semibold text-white shrink-0">
            {barber.avatar_url ? (
              <img src={barber.avatar_url} alt={barber.name} className="h-full w-full object-cover" />
            ) : (
              barber.name?.charAt(0)?.toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold text-base truncate">{barber.name}</p>
            <p className="text-zinc-500 text-xs">{barber.phone}</p>
            {isChefe && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent-light mt-1">
                <ShieldCheck size={10} /> Chefe
              </span>
            )}
          </div>
          <button
            onClick={() => setEditOpen(true)}
            aria-label="Editar perfil"
            className="h-9 w-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 active:bg-zinc-900 shrink-0"
          >
            <Pencil size={15} />
          </button>
        </div>

        <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
          Controle financeiro — hoje
        </h3>

        {!summary ? (
          <div className="h-20 rounded-xl bg-surface animate-pulse mb-4" />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 mb-2">
            <div className="bg-surface border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                <TrendingUp size={12} /> Faturado
              </div>
              <p className="text-white font-bold text-base">{formatBRL(summary.totalFaturado)}</p>
            </div>
            <div className="bg-surface border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-accent-light text-xs font-medium mb-1">
                <AlertCircle size={12} /> A receber
              </div>
              <p className="text-white font-bold text-base">{formatBRL(summary.totalPendente)}</p>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            onClose();
            // O chefe tem uma tela exclusiva de financeiro completo (com
            // despesas e saldo líquido); os demais barbeiros são levados
            // pro caixa/faturamento padrão, dentro do próprio escopo deles.
            router.push(isChefe ? '/admin/financeiro/completo' : '/admin/financeiro');
          }}
          className="w-full flex items-center justify-between bg-elevated border border-zinc-800 rounded-xl px-4 py-3 mt-2"
        >
          <span className="text-white text-sm font-medium">Ver financeiro completo</span>
          <ChevronRight size={16} className="text-zinc-500" />
        </button>
      </BottomSheet>

      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        barber={barber}
        onSaved={(updated) => {
          setEditOpen(false);
          onProfileUpdated(updated);
        }}
      />
    </>
  );
}
