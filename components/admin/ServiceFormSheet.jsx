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
import { listTeam } from '@/lib/actions/team';
import { compressImage } from '@/lib/image-compress';
import { Upload, X, Scissors, Loader2, Sparkles, UserCheck, Users, Clock, RotateCcw } from 'lucide-react';
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

  // Atribuição de Barbeiro (Todos ou Barbeiro Específico)
  const [barberId, setBarberId] = useState(service?.barber_id || service?.assigned_barber_id || 'all');
  const [teamMembers, setTeamMembers] = useState([]);

  // Durações personalizadas por profissional: { [barberId]: string }
  const [customDurations, setCustomDurations] = useState({});

  // Estados de Imagem Ilustrativa
  const [currentImageUrl, setCurrentImageUrl] = useState(service?.image_url || null);
  const [previewUrl, setPreviewUrl] = useState(service?.image_url || null);
  const [pendingBlob, setPendingBlob] = useState(null);
  const [isPhotoRemoved, setIsPhotoRemoved] = useState(false);
  const [compressing, setCompressing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Carrega barbeiros ativos da equipe ao abrir a folha
  useEffect(() => {
    if (open) {
      listTeam()
        .then((members) => {
          setTeamMembers((members || []).filter((m) => m.active !== false));
        })
        .catch(() => {});
    }
  }, [open]);

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
        setBarberId(service.barber_id || service.assigned_barber_id || 'all');
        setCurrentImageUrl(service.image_url || null);
        setPreviewUrl(service.image_url || null);

        // Preenche durações personalizadas existentes na tabela barber_services
        const initialCustom = {};
        if (Array.isArray(service.barber_configs)) {
          for (const cfg of service.barber_configs) {
            if (cfg.custom_duration !== null && cfg.custom_duration !== undefined) {
              initialCustom[cfg.barber_id] = String(cfg.custom_duration);
            } else {
              initialCustom[cfg.barber_id] = '';
            }
          }
        }
        setCustomDurations(initialCustom);
      } else {
        setName('');
        setCategory('cabelo');
        setPrice('');
        setDuration('');
        setBarberId('all');
        setCurrentImageUrl(null);
        setPreviewUrl(null);
        setCustomDurations({});
      }
      setPendingBlob(null);
      setIsPhotoRemoved(false);
      setError('');
    } else {
      setPreviewUrl((prev) => {
        if (prev && typeof prev === 'string' && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      setPendingBlob(null);
      setIsPhotoRemoved(false);
      setError('');
    }
  }, [open, service]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(file instanceof Blob) || (file.type && !file.type.startsWith('image/'))) {
      setError('Por favor selecione um arquivo de imagem válido (JPG, PNG ou WebP).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setError('');
    setCompressing(true);
    try {
      const compressedResult = await compressImage(file, { maxSide: 1024, quality: 0.85 });
      const finalBlob = compressedResult?.blob || compressedResult;

      if (!finalBlob || !(finalBlob instanceof Blob)) {
        throw new Error('Falha ao processar a imagem selecionada.');
      }

      setPreviewUrl((prev) => {
        if (prev && typeof prev === 'string' && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(finalBlob);
      });

      setPendingBlob(finalBlob);
      setIsPhotoRemoved(false);
    } catch (err) {
      console.error('Falha ao processar imagem:', err);
      setError('Não foi possível processar a imagem. Tente outra foto.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setCompressing(false);
    }
  }

  function handleRemovePhoto() {
    setPreviewUrl((prev) => {
      if (prev && typeof prev === 'string' && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setPendingBlob(null);
    setIsPhotoRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleBarberDurationChange(bId, val) {
    setCustomDurations((prev) => ({
      ...prev,
      [bId]: val,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim() || !price || !duration) {
      setError('Preencha nome, preço e duração padrão.');
      return;
    }

    setSaving(true);
    try {
      // Monta o mapa de durações personalizadas por profissional para gravar em barber_services
      const barberDurationsPayload = {};
      for (const member of teamMembers) {
        const raw = String(customDurations[member.id] ?? '').trim();
        const parsed = raw === '' ? null : Math.max(5, Math.round(Number(raw)));
        barberDurationsPayload[member.id] = {
          custom_duration: Number.isFinite(parsed) ? parsed : null,
          is_active: barberId === 'all' ? true : String(barberId) === String(member.id),
        };
      }

      const payload = {
        name: name.trim(),
        category,
        price: Number(price),
        default_duration_minutes: Number(duration),
        barber_id: barberId === 'all' ? null : barberId,
        barber_durations: barberDurationsPayload,
      };

      let targetServiceId = service?.id;

      if (isEditing) {
        await updateService(targetServiceId, payload);
      } else {
        const created = await createService(payload);
        targetServiceId = created?.id;
      }

      if (pendingBlob && targetServiceId) {
        const formData = new FormData();
        const ext = pendingBlob.type === 'image/jpeg' ? 'jpg' : 'webp';
        formData.append('file', pendingBlob, `${targetServiceId}.${ext}`);
        await uploadServicePhoto(targetServiceId, formData);
      } else if (isPhotoRemoved && targetServiceId) {
        await removeServicePhoto(targetServiceId);
      }

      toast.success(isEditing ? 'Serviço e durações atualizados!' : 'Serviço cadastrado com sucesso!');
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

          <div className="flex items-center gap-3.5">
            <div className="relative h-24 w-24 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700/80 shrink-0 flex items-center justify-center">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Prévia do serviço"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover object-center rounded-xl"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-zinc-600 gap-1 text-center p-1">
                  <Scissors size={22} />
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
          <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
            <Users size={13} className="text-accent" />
            Quem realiza este serviço?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setBarberId('all')}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                barberId === 'all'
                  ? 'bg-accent/20 border-accent text-white ring-1 ring-accent'
                  : 'bg-surface border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <Users size={13} className={barberId === 'all' ? 'text-accent' : 'text-zinc-500'} />
              <span>Toda a equipe</span>
            </button>
            {teamMembers.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setBarberId(member.id)}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                  barberId === member.id
                    ? 'bg-accent/20 border-accent text-white ring-1 ring-accent'
                    : 'bg-surface border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                }`}
              >
                <UserCheck size={13} className={barberId === member.id ? 'text-accent' : 'text-zinc-500'} />
                <span>{member.name}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">
            {barberId === 'all'
              ? 'Disponível na agenda de todos os barbeiros.'
              : `Exclusivo para os agendamentos de ${teamMembers.find((m) => m.id === barberId)?.name || 'este profissional'}.`}
          </p>
        </div>

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
          <FormField label="Preço padrão (R$)">
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
          <FormField label="Duração padrão (min)">
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

        {/* Tempo personalizado por profissional (barber_services.custom_duration) */}
        {teamMembers.length > 0 && (
          <div className="bg-[#050505] border border-zinc-800/90 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Clock size={13} className="text-accent" />
                Tempo específico por profissional (opcional)
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Defina o tempo em minutos para cada barbeiro. Se deixar em branco, o profissional
              herdará o tempo padrão ({duration || 30} min).
            </p>

            <div className="space-y-2 pt-1">
              {teamMembers
                .filter((m) => barberId === 'all' || String(m.id) === String(barberId))
                .map((member) => {
                  const rawVal = customDurations[member.id] ?? '';
                  const hasCustom = String(rawVal).trim() !== '';
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-[#0b0b0b] border border-zinc-800/80 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-white block truncate">
                          {member.name}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {hasCustom
                            ? `Personalizado: ${rawVal} min`
                            : `Herda padrão: ${duration || 30} min`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="5"
                            max="240"
                            step="5"
                            value={rawVal}
                            onChange={(e) =>
                              handleBarberDurationChange(member.id, e.target.value)
                            }
                            placeholder={`${duration || 30}`}
                            className="w-20 h-8 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-accent px-2 pr-7 text-xs font-bold text-white text-right focus:outline-none"
                          />
                          <span className="absolute right-2 text-[10px] text-zinc-500 pointer-events-none">
                            min
                          </span>
                        </div>
                        {hasCustom && (
                          <button
                            type="button"
                            onClick={() => handleBarberDurationChange(member.id, '')}
                            title="Herdar tempo padrão"
                            className="h-8 w-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white active:scale-95"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

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
