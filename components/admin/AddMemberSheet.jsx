'use client';

import { useState } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton } from './FormField';
import { addTeamMember } from '@/lib/actions/team';

export default function AddMemberSheet({ open, onClose }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [commission, setCommission] = useState('50');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || phone.replace(/\D/g, '').length < 10) {
      setError('Informe um nome e um telefone válido (com DDD).');
      return;
    }
    if (password.length < 6) {
      setError('A senha precisa ter no mínimo 6 caracteres.');
      return;
    }

    setSaving(true);
    try {
      const commNumber = Math.min(100, Math.max(0, Math.round(Number(commission) || 25)));
      const res = await addTeamMember({
        name,
        phone,
        password,
        commissionPercent: commNumber,
      });

      if (res && res.success === false) {
        setError(res.error || 'Erro ao adicionar barbeiro.');
        return;
      }

      setName('');
      setPhone('');
      setPassword('');
      setCommission('50');
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao adicionar barbeiro.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Adicionar barbeiro">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Nome do profissional">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: William Silva"
            autoFocus
            required
          />
        </FormField>
        <FormField label="Telefone (WhatsApp)">
          <TextInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(83) 9 9999-9999"
            inputMode="tel"
            required
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Senha de acesso">
            <TextInput
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mín. 6 dígitos"
              autoComplete="off"
              required
            />
          </FormField>
          <FormField label="Comissão inicial (%)">
            <TextInput
              type="number"
              min="0"
              max="100"
              step="1"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder="50"
              required
            />
          </FormField>
        </div>
        <p className="text-zinc-500 text-xs">
          O barbeiro entra no painel com este telefone e esta senha. A comissão pode ser
          ajustada individualmente para serviços e produtos a qualquer momento.
        </p>
        {error && <p className="text-accent-light text-xs">{error}</p>}
        <div className="pt-2">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Adicionando…' : 'Adicionar à equipe'}
          </PrimaryButton>
        </div>
      </form>
    </BottomSheet>
  );
}
