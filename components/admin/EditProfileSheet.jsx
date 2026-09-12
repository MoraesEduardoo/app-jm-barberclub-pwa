'use client';

import { useState } from 'react';
import { Camera } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton } from './FormField';
import { updateOwnProfile, uploadBarberAvatar } from '@/lib/actions/team';

export default function EditProfileSheet({ open, onClose, barber, onSaved }) {
  const [name, setName] = useState(barber.name);
  const [avatarPreview, setAvatarPreview] = useState(barber.avatar_url || '');
  const [pendingFile, setPendingFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handlePickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let avatarUrl = barber.avatar_url || null;

      if (pendingFile) {
        const formData = new FormData();
        formData.append('file', pendingFile);
        avatarUrl = await uploadBarberAvatar(barber.id, formData);
      }

      if (name.trim() !== barber.name) {
        await updateOwnProfile(barber.id, { name });
      }

      onSaved({ ...barber, name: name.trim() || barber.name, avatar_url: avatarUrl });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Editar perfil">
      <form onSubmit={handleSubmit}>
        <div className="flex justify-center mb-5">
          <label className="relative cursor-pointer">
            <div className="h-20 w-20 rounded-full bg-elevated border border-zinc-700 overflow-hidden flex items-center justify-center text-2xl font-semibold text-white">
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                name?.charAt(0)?.toUpperCase()
              )}
            </div>
            <span className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-accent border-2 border-surface flex items-center justify-center">
              <Camera size={13} className="text-white" />
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handlePickFile}
              className="hidden"
            />
          </label>
        </div>

        <FormField label="Nome">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
        </FormField>

        {error && <p className="text-accent-light text-xs mb-3">{error}</p>}

        <PrimaryButton type="submit" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar alterações'}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
