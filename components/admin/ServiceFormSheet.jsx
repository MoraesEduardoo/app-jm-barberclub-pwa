'use client';

import { useState, useEffect } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton, GhostButton } from './FormField';
import { createService, updateService, deleteService } from '@/lib/actions/services';

const CATEGORIES = [
  { value: 'cabelo', label: 'Cabelo' },
  { value: 'barba', label: 'Barba' },
  { value: 'combo', label: 'Combo' },
  { value: 'tratamento', label: 'Tratamento' },
  { value: 'outros', label: 'Outros' },
];

export default function ServiceFormSheet({ open, onClose, service }) {
  const isEditing = Boolean(service && service.id);

  const [name, setName] = useState(service?.name || '');
  const [category, setCategory] = useState(service?.category || 'cabelo');
  const [price, setPrice] = useState(
    service?.price !== undefined && service?.price !== null ? String(service.price) : ''
  );
  const [duration, setDuration] = useState(
    service?.default_duration_minutes !== undefined && service?.default_duration_minutes !== null
      ? String(service.default_duration_minutes)
      : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      if (service) {
        setName(service.name || '');
        setCategory(service.category || 'cabelo');
        setPrice(
          service.price !== undefined && service.price !== null
            ? String(service.price)
            : ''
        );
        setDuration(
          service.default_duration_minutes !== undefined &&
            service.default_duration_minutes !== null
            ? String(service.default_duration_minutes)
            : ''
        );
      } else {
        setName('');
        setCategory('cabelo');
        setPrice('');
        setDuration('');
      }
      setError('');
    }
  }, [open, service]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim() || !price || !duration) {
      setError('Preencha nome, preço e duração.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        price: Number(price),
        default_duration_minutes: Number(duration),
      };
      if (isEditing) {
        await updateService(service.id, payload);
      } else {
        await createService(payload);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao salvar o serviço.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!service || !confirm(`Remover o serviço "${service.name}"?`)) return;
    setSaving(true);
    try {
      await deleteService(service.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao remover o serviço.');
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isEditing ? 'Editar serviço' : 'Novo serviço'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Nome do serviço">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Degradê"
            autoFocus
            required
          />
        </FormField>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Categoria</label>
          <div className="grid grid-cols-5 gap-1.5 bg-surface border border-zinc-800 rounded-xl p-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`py-1.5 text-xs font-medium rounded-lg text-center transition-all ${
                  category === cat.value
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Preço (R$)">
            <TextInput
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="25,00"
              required
            />
          </FormField>
          <FormField label="Duração (min)">
            <TextInput
              type="number"
              inputMode="numeric"
              min="5"
              step="5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="30"
              required
            />
          </FormField>
        </div>

        {error && <p className="text-accent-light text-xs">{error}</p>}

        <div className="flex flex-col gap-2 pt-2">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Salvando…' : isEditing ? 'Salvar alterações' : 'Adicionar serviço'}
          </PrimaryButton>
          {isEditing && (
            <GhostButton type="button" onClick={handleDelete} disabled={saving}>
              Remover serviço
            </GhostButton>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}
