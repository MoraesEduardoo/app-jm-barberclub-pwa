'use client';

import { Home, Package, Zap, Wrench, Users2, Megaphone, MoreHorizontal } from 'lucide-react';

const CATEGORY_META = {
  aluguel: { label: 'Aluguel', icon: Home },
  produtos: { label: 'Produtos & Estoque', icon: Package },
  contas: { label: 'Contas', icon: Zap },
  manutencao: { label: 'Manutenção', icon: Wrench },
  salarios: { label: 'Salários', icon: Users2 },
  marketing: { label: 'Marketing', icon: Megaphone },
  outros: { label: 'Outros', icon: MoreHorizontal },
};

export default function ExpenseRow({ expense, onClick }) {
  const meta = CATEGORY_META[expense.category] || CATEGORY_META.outros;
  const Icon = meta.icon;
  const dt = expense.occurred_at ? new Date(expense.occurred_at) : null;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 bg-surface border border-zinc-800 rounded-xl px-4 py-3 text-left active:bg-zinc-900 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full bg-elevated flex items-center justify-center shrink-0">
          <Icon size={15} className="text-zinc-400" />
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-medium truncate">
            {expense.description || meta.label}
          </p>
          <p className="text-zinc-500 text-xs">
            {meta.label}
            {dt ? ` · ${dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}
          </p>
        </div>
      </div>
      <p className="text-red-400 font-semibold text-sm shrink-0">
        - R$ {Number(expense.amount || 0).toFixed(2).replace('.', ',')}
      </p>
    </button>
  );
}
