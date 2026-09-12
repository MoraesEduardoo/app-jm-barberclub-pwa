'use client';

import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton, GhostButton } from './FormField';
import { createService, updateService, deleteService } from '@/lib/actions/services';

export default function ServiceFormSheet({ open, onClose, service }) {
  const isEditing = Boolean(service);
  const [name, setName] = useState(service?.name || '');
  const [price, setPrice] = useState(service?.price ?? '');
  const [duration, setDuration] = useState(service?.default_duration_minutes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
        name,
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
    if (!confirm(`Remover o serviço "${service.name}"?`)) return;
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
      <form onSubmit={handleSubmit}>
        <FormField label="Nome do serviço">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Corte + Barba"
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Preço (R$)">
            <TextInput
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="45,00"
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
            />
          </FormField>
        </div>

        {error && <p className="text-accent-light text-xs mb-3">{error}</p>}

        <div className="flex flex-col gap-2 mt-2">
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
