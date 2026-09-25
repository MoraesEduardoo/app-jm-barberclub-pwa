'use client';

import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton, GhostButton } from './FormField';
import { createExpense, updateExpense, deleteExpense } from '@/lib/actions/finance';
import { EXPENSE_CATEGORIES } from '@/lib/constants/finance';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpenseFormSheet({ open, onClose, expense, chefeId }) {
  const isEditing = Boolean(expense);

  const [amount, setAmount] = useState(expense?.amount ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [category, setCategory] = useState(expense?.category ?? 'outros');
  const [occurredAt, setOccurredAt] = useState(
    expense?.occurred_at ? expense.occurred_at.slice(0, 10) : todayISO()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!amount || Number(amount) <= 0) {
      setError('Informe um valor válido para a despesa.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        amount: Number(amount),
        description,
        category,
        occurred_at: occurredAt,
      };
      if (isEditing) {
        await updateExpense(expense.id, payload);
      } else {
        await createExpense({ ...payload, barber_id: chefeId });
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao salvar a despesa.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Remover essa despesa do financeiro?')) return;
    setSaving(true);
    try {
      await deleteExpense(expense.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao remover a despesa.');
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={isEditing ? 'Editar despesa' : 'Nova despesa'}>
      <form onSubmit={handleSubmit}>
        <FormField label="Descrição">
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: Compra de produtos de barba"
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Valor (R$)">
            <TextInput
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150,00"
            />
          </FormField>
          <FormField label="Data do gasto">
            <TextInput
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Categoria">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-11 rounded-lg bg-elevated border border-zinc-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
          >
            {(Array.isArray(EXPENSE_CATEGORIES) ? EXPENSE_CATEGORIES : []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </FormField>

        {error && <p className="text-accent-light text-xs mb-3">{error}</p>}

        <div className="flex flex-col gap-2 mt-2">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Salvando…' : isEditing ? 'Salvar alterações' : 'Lançar despesa'}
          </PrimaryButton>
          {isEditing && (
            <GhostButton type="button" onClick={handleDelete} disabled={saving}>
              Remover despesa
            </GhostButton>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}
