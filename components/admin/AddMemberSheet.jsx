'use client';

import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton } from './FormField';
import { addTeamMember } from '@/lib/actions/team';

export default function AddMemberSheet({ open, onClose }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || phone.replace(/\D/g, '').length < 10) {
      setError('Informe um nome e um telefone válido (com DDD).');
      return;
    }
    setSaving(true);
    try {
      await addTeamMember({ name, phone });
      setName('');
      setPhone('');
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao adicionar barbeiro.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Adicionar barbeiro">
      <form onSubmit={handleSubmit}>
        <FormField label="Nome">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do barbeiro"
            autoFocus
          />
        </FormField>
        <FormField label="Telefone (WhatsApp)">
          <TextInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(83) 9 9999-9999"
            inputMode="tel"
          />
        </FormField>
        <p className="text-zinc-500 text-xs mb-4">
          Esse número será usado pelo barbeiro para entrar no painel, com permissões
          básicas — você pode ajustá-las depois.
        </p>
        {error && <p className="text-accent-light text-xs mb-3">{error}</p>}
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? 'Adicionando…' : 'Adicionar à equipe'}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
