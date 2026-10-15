'use client';

import { useState, useEffect, useRef } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton, GhostButton } from './FormField';
import {
  createService,
  updateService,
  deleteService,
  uploadServicePhoto,
  removeServicePhoto,
} from '@/lib/actions/services';
import { compressImage } from '@/lib/image-compress';
import { Upload, X, Scissors, Loader2, Sparkles } from 'lucide-react';
import { toast } from '@/lib/toast';

const CATEGORIES = [
  { value: 'cabelo', label: 'Cabelo' },
  { value: 'barba', label: 'Barba' },
  { value: 'combo', label: 'Combo' },
  { value: 'tratamento', label: 'Tratamento' },
  { value: 'outros', label: 'Outros' },
];

export default function ServiceFormSheet({ open, onClose, service }) {
  const isEditing = Boolean(service && service.id);
  const fileInputRef = useRef(null);

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

  // Estados de Imagem Ilustrativa
  const [currentImageUrl, setCurrentImageUrl] = useState(service?.image_url || null);
  const [previewUrl, setPreviewUrl] = useState(service?.image_url || null);
  const [pendingBlob, setPendingBlob] = useState(null);
  const [isPhotoRemoved, setIsPhotoRemoved] = useState(false);
  const [compressing, setCompressing] = useState(false);

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
        setCurrentImageUrl(service.image_url || null);
        setPreviewUrl(service.image_url || null);
      } else {
        setName('');
        setCategory('cabelo');
        setPrice('');
        setDuration('');
        setCurrentImageUrl(null);
        setPreviewUrl(null);
      }
      setPendingBlob(null);
      setIsPhotoRemoved(false);
      setError('');
    }
  }, [open, service]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setCompressing(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.85 });
      setPendingBlob(compressed);
      setPreviewUrl(URL.createObjectURL(compressed));
      setIsPhotoRemoved(false);
    } catch (err) {
      console.error('Falha ao processar imagem:', err);
      setError('Não foi possível processar a imagem. Tente outra foto.');
    } finally {
      setCompressing(false);
    }
  }

  function handleRemovePhoto() {
    setPreviewUrl(null);
    setPendingBlob(null);
    setIsPhotoRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

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

      let targetServiceId = service?.id;

      if (isEditing) {
        await updateService(targetServiceId, payload);
      } else {
        // Criação de novo serviço
        const created = await createService(payload);
        targetServiceId = created?.id;
      }

      // Se houver nova foto para upload
      if (pendingBlob && targetServiceId) {
        const formData = new FormData();
        formData.append('file', pendingBlob, `${targetServiceId}.webp`);
        await uploadServicePhoto(targetServiceId, formData);
      } else if (isPhotoRemoved && targetServiceId) {
        await removeServicePhoto(targetServiceId);
      }

      toast.success(isEditing ? 'Serviço e foto atualizados!' : 'Serviço cadastrado com sucesso!');
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
      toast.success('Serviço removido.');
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
        {/* Seção da Foto Ilustrativa Oficial */}
        <div className="bg-surface/60 border border-zinc-800/80 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent" />
              Foto Ilustrativa (Exibida no Chatbot)
            </span>
            {previewUrl && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="text-[11px] text-accent-light hover:underline flex items-center gap-1"
              >
                <X size={12} /> Remover foto
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Thumbnail da foto atual / preview */}
            <div className="relative h-20 w-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700/80 shrink-0 flex items-center justify-center">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Prévia do serviço"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-zinc-600 gap-1 text-center p-1">
                  <Scissors size={20} />
                  <span className="text-[10px] text-zinc-500">Sem foto</span>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                id="service-photo-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={compressing || saving}
                className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 border border-zinc-700/80 hover:border-accent text-xs font-semibold text-white active:scale-95 transition-all touch-manipulation disabled:opacity-50"
              >
                {compressing ? (
                  <Loader2 size={14} className="animate-spin text-accent" />
                ) : (
                  <Upload size={14} className="text-accent" />
                )}
                {compressing ? 'Processando…' : previewUrl ? 'Trocar foto' : 'Enviar foto oficial'}
              </button>
              <p className="text-[10px] text-zinc-500 leading-tight">
                Essa imagem aparecerá no card do serviço quando o cliente agendar pelo Chatbot.
              </p>
            </div>
          </div>
        </div>

        <FormField label="Nome do serviço">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Degradê"
            autoFocus={!isEditing}
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
          <PrimaryButton type="submit" disabled={saving || compressing}>
            {saving ? 'Salvando…' : isEditing ? 'Salvar alterações' : 'Adicionar serviço'}
          </PrimaryButton>
          {isEditing && (
            <GhostButton type="button" onClick={handleDelete} disabled={saving || compressing}>
              Remover serviço
            </GhostButton>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}
