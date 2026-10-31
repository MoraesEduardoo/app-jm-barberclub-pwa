'use client';

import { useState, useEffect } from 'react';
import { Scissors, Check, Save, Loader2, Clock, RotateCcw } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { getBarberServicesConfig, updateBarberSpecialties } from '@/lib/actions/team';
import { toast } from '@/lib/toast';

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace('.', ',')}`;
}

/**
 * TeamMemberSpecialtiesSheet:
 * Gestão de serviços e tempos personalizados por profissional (acessível pelo chefe/admin).
 * Permite habilitar/desabilitar serviços e definir o tempo específico de atendimento
 * (custom_duration em minutos) e preço opcional (custom_price) para cada barbeiro
 * diretamente na tabela `public.barber_services`.
 * Se o campo de duração personalizada ficar vazio, herda automaticamente o tempo padrão da tabela `services`.
 */
export default function TeamMemberSpecialtiesSheet({ open, onClose, member }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  useEffect(() => {
    if (!open || !member?.id) return;

    let active = true;
    setLoading(true);
    setHasChanges(false);
    setSuccessNotice(false);

    getBarberServicesConfig(member.id)
      .then((configs) => {
        if (active) {
          const normalized = (configs || []).map((cfg) => ({
            ...cfg,
            customDurationInput:
              cfg.custom_duration !== null && cfg.custom_duration !== undefined
                ? String(cfg.custom_duration)
                : '',
            customPriceInput:
              cfg.custom_price !== null && cfg.custom_price !== undefined
                ? String(cfg.custom_price)
                : '',
          }));
          setItems(normalized);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar serviços do profissional:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, member?.id]);

  function handleToggleActive(serviceId) {
    setItems((prev) =>
      prev.map((item) =>
        item.service_id === serviceId
          ? { ...item, is_active: !item.is_active }
          : item
      )
    );
    setHasChanges(true);
    setSuccessNotice(false);
  }

  function handleDurationChange(serviceId, value) {
    setItems((prev) =>
      prev.map((item) =>
        item.service_id === serviceId
          ? { ...item, customDurationInput: value }
          : item
      )
    );
    setHasChanges(true);
    setSuccessNotice(false);
  }

  function handleClearCustomDuration(serviceId) {
    setItems((prev) =>
      prev.map((item) =>
        item.service_id === serviceId
          ? { ...item, customDurationInput: '' }
          : item
      )
    );
    setHasChanges(true);
    setSuccessNotice(false);
  }

  function handleSelectAll() {
    setItems((prev) => prev.map((item) => ({ ...item, is_active: true })));
    setHasChanges(true);
    setSuccessNotice(false);
  }

  function handleDeselectAll() {
    setItems((prev) => prev.map((item) => ({ ...item, is_active: false })));
    setHasChanges(true);
    setSuccessNotice(false);
  }

  async function handleSave() {
    if (!member?.id) return;
    setSaving(true);
    setSuccessNotice(false);

    try {
      const payload = items.map((item) => {
        const rawDur = String(item.customDurationInput ?? '').trim();
        const parsedDur = rawDur === '' ? null : Math.max(5, Math.round(Number(rawDur)));

        const rawPrice = String(item.customPriceInput ?? '').trim();
        const parsedPrice =
          rawPrice === '' ? null : Number(Number(rawPrice.replace(',', '.')).toFixed(2));

        return {
          service_id: item.service_id,
          is_active: Boolean(item.is_active),
          custom_duration: Number.isFinite(parsedDur) ? parsedDur : null,
          custom_price: Number.isFinite(parsedPrice) ? parsedPrice : null,
        };
      });

      await updateBarberSpecialties(member.id, payload);
      setHasChanges(false);
      setSuccessNotice(true);
      toast.success(`Tempos e serviços de ${member.name} atualizados!`);
      setTimeout(() => setSuccessNotice(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar configurações de serviços:', err);
      toast.error('Não foi possível salvar os tempos e serviços do colaborador.');
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;

  const activeCount = items.filter((i) => i.is_active).length;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Serviços & Tempos — ${member.name}`}
    >
      <div className="space-y-3.5 pb-2">
        <p className="text-zinc-400 text-xs leading-relaxed">
          Defina quais serviços <strong className="text-white">{member.name}</strong> realiza e o
          seu <strong className="text-white">tempo específico de atendimento (em minutos)</strong>.
          Se o campo de duração ficar vazio, o sistema herda automaticamente o tempo padrão da
          tabela <code className="text-zinc-300">services</code>.
        </p>

        {/* Ações rápidas */}
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-zinc-400 font-medium">
            {activeCount} de {items.length} serviços ativos
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-accent-light hover:underline font-medium touch-manipulation"
            >
              Habilitar todos
            </button>
            <span className="text-zinc-600">•</span>
            <button
              type="button"
              onClick={handleDeselectAll}
              className="text-zinc-500 hover:text-zinc-300 font-medium touch-manipulation"
            >
              Desmarcar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={24} className="animate-spin text-accent" />
            <span className="text-xs">Carregando catálogo e durações…</span>
          </div>
        ) : (
          <>
            <div className="space-y-2.5 max-h-[54dvh] overflow-y-auto pr-0.5">
              {items.map((service) => {
                const isSelected = Boolean(service.is_active);
                const hasCustomDur = String(service.customDurationInput || '').trim() !== '';
                const effectiveMin = hasCustomDur
                  ? Number(service.customDurationInput) || service.default_duration_minutes
                  : service.default_duration_minutes;

                return (
                  <div
                    key={service.service_id}
                    className={`w-full rounded-xl border p-3 transition-all ${
                      isSelected
                        ? 'bg-[#080808] border-zinc-800 text-white'
                        : 'bg-[#040404] border-zinc-900 text-zinc-500 opacity-75'
                    }`}
                  >
                    {/* Linha superior: Checkbox de ativo + nome do serviço + preço/padrão */}
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(service.service_id)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left touch-manipulation"
                      >
                        <div
                          className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-accent text-white'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {isSelected ? <Check size={16} /> : <Scissors size={14} />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate text-white">
                            {service.name}
                          </p>
                          <p className="text-zinc-500 text-xs">
                            {formatBRL(service.effective_price)} • Padrão:{' '}
                            {service.default_duration_minutes} min
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleActive(service.service_id)}
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ${
                          isSelected
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {isSelected ? 'Ativo' : 'Inativo'}
                      </button>
                    </div>

                    {/* Linha inferior: Configuração de tempo específico por profissional */}
                    {isSelected && (
                      <div className="mt-2.5 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Clock
                            size={13}
                            className={hasCustomDur ? 'text-accent-light shrink-0' : 'text-zinc-500 shrink-0'}
                          />
                          <span className="text-xs text-zinc-300 truncate">
                            Tempo com {member.name}:
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                              hasCustomDur
                                ? 'bg-accent/15 text-accent-light border border-accent/30'
                                : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                            }`}
                          >
                            {effectiveMin} min {hasCustomDur ? '(personalizado)' : '(padrão)'}
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
                              value={service.customDurationInput}
                              onChange={(e) =>
                                handleDurationChange(service.service_id, e.target.value)
                              }
                              placeholder={`${service.default_duration_minutes}`}
                              aria-label={`Tempo personalizado em minutos para ${service.name}`}
                              className="w-20 h-8 rounded-lg bg-[#0d0d0d] border border-zinc-700 focus:border-accent px-2 pr-7 text-xs font-bold text-white text-right focus:outline-none touch-manipulation"
                            />
                            <span className="absolute right-2 text-[10px] text-zinc-500 pointer-events-none">
                              min
                            </span>
                          </div>

                          {hasCustomDur && (
                            <button
                              type="button"
                              onClick={() => handleClearCustomDuration(service.service_id)}
                              title="Restaurar tempo padrão"
                              className="h-8 w-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white active:scale-95"
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {successNotice && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl px-3.5 py-2.5 text-xs">
                <Check size={14} className="shrink-0" />
                <span>Tempos e serviços salvos diretamente em barber_services!</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (!hasChanges && !successNotice)}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-accent text-white font-semibold text-xs active:scale-[0.98] active:bg-accent-dark transition-all touch-manipulation disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                <span>
                  {saving
                    ? 'Salvando em barber_services…'
                    : hasChanges
                    ? 'Salvar serviços e tempos personalizados'
                    : 'Configurações sincronizadas'}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
