'use client';

import { useState, useEffect } from 'react';
import { Scissors, Check, Save, Loader2, CheckSquare, Square } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { listServices } from '@/lib/actions/services';
import { getBarberSpecialties, updateBarberSpecialties } from '@/lib/actions/team';

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace('.', ',')}`;
}

/**
 * TeamMemberSpecialtiesSheet:
 * Gerenciamento de Especialidades / Serviços habilitados por colaborador.
 * Permite selecionar quais serviços da barbearia o profissional está autorizado a prestar,
 * integrando diretamente com filtros de atendimento e chatbots de agendamento.
 */
export default function TeamMemberSpecialtiesSheet({ open, onClose, member }) {
  const [allServices, setAllServices] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
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

    Promise.all([listServices(), getBarberSpecialties(member.id)])
      .then(([services, specialties]) => {
        if (active) {
          setAllServices(services || []);
          setSelectedIds(specialties || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar especialidades:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, member?.id]);

  function handleToggle(serviceId) {
    setSelectedIds((prev) => {
      const exists = prev.includes(serviceId);
      const next = exists
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId];
      return next;
    });
    setHasChanges(true);
    setSuccessNotice(false);
  }

  function handleSelectAll() {
    setSelectedIds(allServices.map((s) => s.id));
    setHasChanges(true);
    setSuccessNotice(false);
  }

  function handleDeselectAll() {
    setSelectedIds([]);
    setHasChanges(true);
    setSuccessNotice(false);
  }

  async function handleSave() {
    if (!member?.id) return;
    setSaving(true);
    setSuccessNotice(false);

    try {
      await updateBarberSpecialties(member.id, selectedIds);
      setHasChanges(false);
      setSuccessNotice(true);
      setTimeout(() => setSuccessNotice(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar especialidades:', err);
      alert('Não foi possível salvar as especialidades do colaborador.');
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Especialidades de ${member.name}`}
    >
      <div className="space-y-3.5 pb-2">
        <p className="text-zinc-400 text-xs leading-relaxed">
          Defina quais procedimentos e serviços{' '}
          <strong className="text-white">{member.name}</strong> está habilitado
          a realizar. Isso filtra a oferta de horários e os atendimentos pelo chatbot.
        </p>

        {/* Ações rápidas */}
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-zinc-400 font-medium">
            {selectedIds.length} de {allServices.length} serviços ativos
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
            <span className="text-xs">Carregando catálogo de serviços…</span>
          </div>
        ) : (
          <>
            <div className="space-y-2 max-h-[50dvh] overflow-y-auto pr-0.5">
              {allServices.map((service) => {
                const isSelected = selectedIds.includes(service.id);
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleToggle(service.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all touch-manipulation active:scale-[0.99] ${
                      isSelected
                        ? 'bg-accent/10 border-accent/40 text-white'
                        : 'bg-surface border-zinc-800 text-zinc-400 active:bg-elevated'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-accent text-white'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {isSelected ? (
                          <Check size={16} />
                        ) : (
                          <Scissors size={14} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate text-white">
                          {service.name}
                        </p>
                        <p className="text-zinc-500 text-xs">
                          {formatBRL(service.price)} •{' '}
                          {service.default_duration_minutes} min
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 ml-2">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          isSelected
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {isSelected ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {successNotice && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl px-3.5 py-2.5 text-xs">
                <Check size={14} className="shrink-0" />
                <span>Especialidades salvas com sucesso!</span>
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
                    ? 'Salvando especialidades…'
                    : hasChanges
                    ? 'Salvar serviços habilitados'
                    : 'Serviços sincronizados'}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
