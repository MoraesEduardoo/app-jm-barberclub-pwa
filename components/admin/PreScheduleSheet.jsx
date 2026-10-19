'use client';

import { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  User,
  Phone,
  CheckCircle2,
  CalendarClock,
  XCircle,
  MessageSquare,
  Sparkles,
  ArrowRight,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { toast } from '@/lib/toast';
import { getWhatsAppClickToChatUrl } from '@/lib/whatsapp';

export default function PreScheduleSheet({
  open,
  onClose,
  appointment,
  team = [],
  onConfirm,
  onReschedule,
  onCancel,
}) {
  const [viewMode, setViewMode] = useState('overview'); // 'overview' | 'reschedule' | 'cancel'
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newBarberId, setNewBarberId] = useState('');
  const [cancelReason, setCancelReason] = useState('Cliente avisou previamente por fora');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (appointment) {
      setViewMode('overview');
      setNewDate(appointment.appointment_date || '');
      const timeClean = appointment.appointment_time
        ? String(appointment.appointment_time).slice(0, 5)
        : '09:00';
      setNewTime(timeClean);
      setNewBarberId(appointment.barber_id || appointment.barbers?.id || '');
      setCancelReason('Cliente avisou previamente por fora');
    }
  }, [appointment, open]);

  if (!appointment) return null;

  const clientName = appointment.client_name || 'Cliente';
  const serviceName = appointment.services?.name || appointment.service || 'Serviço';
  const price = appointment.services?.price || appointment.price || 0;
  const barberName = appointment.barbers?.name || 'Equipe';
  const appointmentTime = appointment.appointment_time
    ? String(appointment.appointment_time).slice(0, 5)
    : '--:--';

  const isConfirmed =
    appointment.status === 'confirmado' || appointment.status === 'confirmed';

  // Ação 1: Confirmar Horário
  async function handleConfirm() {
    if (loading) return;
    setLoading(true);
    try {
      await onConfirm(appointment.id);
      toast.success(`Pré-agendamento de ${clientName} confirmado na agenda!`);
      onClose();
    } catch {
      toast.error('Erro ao confirmar pré-agendamento.');
    } finally {
      setLoading(false);
    }
  }

  // Ação 2: Remarcar Horário
  async function handleRescheduleSubmit(e) {
    e.preventDefault();
    if (!newDate || !newTime) {
      toast.warning('Informe a nova data e horário.');
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      await onReschedule({
        id: appointment.id,
        newDate,
        newTime,
        newBarberId: newBarberId || undefined,
      });
      toast.success(
        `Horário remarcado com sucesso para ${newDate.split('-').reverse().join('/')} às ${newTime}!`
      );
      onClose();
    } catch {
      toast.error('Erro ao remarcar horário.');
    } finally {
      setLoading(false);
    }
  }

  // Ação 3: Cancelar Agendamento e Liberar Vaga
  async function handleCancelSubmit() {
    if (loading) return;
    setLoading(true);
    try {
      await onCancel(appointment.id, cancelReason);
      toast.success('Pré-agendamento cancelado. Vaga liberada na agenda!');
      onClose();
    } catch {
      toast.error('Erro ao cancelar agendamento.');
    } finally {
      setLoading(false);
    }
  }

  // Ação 4: Contato WhatsApp
  function handleOpenWhatsApp() {
    if (!appointment.client_phone) {
      toast.warning('Telefone do cliente não cadastrado.');
      return;
    }
    const formattedDate = appointment.appointment_date
      ? appointment.appointment_date.split('-').reverse().join('/')
      : 'sua data';
    const text = `Olá, ${clientName}! Aqui é da Barbearia JM Barberclub. Estamos entrando em contato referente ao seu pré-agendamento de ${serviceName} para o dia ${formattedDate} às ${appointmentTime}. Está confirmado para você?`;
    const url = getWhatsAppClickToChatUrl(appointment.client_phone, text);
    if (!url) {
      toast.warning('Telefone inválido para WhatsApp.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Gestão de Pré-Agendamento"
    >
      <div className="p-4 space-y-4 overflow-y-auto">
        {/* Banner de Identificação de Recorrência */}
        <div className="bg-gradient-to-r from-purple-950/40 via-purple-900/20 to-zinc-900 border border-purple-500/30 rounded-2xl p-3.5 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0 mt-0.5">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-white">Pré-agendado via Chatbot</span>
              <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold px-2 py-0.2 rounded-full">
                🔄 Recorrência
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
              O cliente reservou esta data antecipadamente. Confirme o horário com antecedência ou remarque conforme necessidade.
            </p>
          </div>
        </div>

        {/* Informações do Atendimento */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User size={15} className="text-zinc-400" />
              <span className="text-sm font-bold text-white truncate">{clientName}</span>
            </div>
            {appointment.client_phone && (
              <span className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                <Phone size={11} className="text-zinc-500" />
                {appointment.client_phone}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-zinc-800/60">
            <div>
              <span className="text-zinc-500 text-[10px] block">Serviço</span>
              <span className="font-semibold text-zinc-200 truncate block">{serviceName}</span>
              {price > 0 && (
                <span className="text-accent text-[11px] font-bold">R$ {Number(price).toFixed(2)}</span>
              )}
            </div>

            <div>
              <span className="text-zinc-500 text-[10px] block">Data e Horário</span>
              <span className="font-semibold text-zinc-200 block">
                {appointment.appointment_date ? appointment.appointment_date.split('-').reverse().join('/') : '--'} às {appointmentTime}
              </span>
              <span className="text-zinc-400 text-[11px] truncate block">Com {barberName}</span>
            </div>
          </div>

          {appointment.notes && (
            <div className="pt-1.5 border-t border-zinc-800/60 text-[11px] text-zinc-400">
              <strong className="text-zinc-300">Notas:</strong> {appointment.notes}
            </div>
          )}
        </div>

        {/* Visualização 1: Visão Geral / Menu de Ações */}
        {viewMode === 'overview' && (
          <div className="space-y-2 pt-1">
            {/* Botão Confirmar Horário */}
            {!isConfirmed && (
              <button
                type="button"
                disabled={loading}
                onClick={handleConfirm}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-bold text-xs shadow-md shadow-emerald-950/40 transition-all touch-manipulation disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                <span>Confirmar Horário Definitivo</span>
              </button>
            )}

            {/* Botão Remarcar Horário */}
            <button
              type="button"
              disabled={loading}
              onClick={() => setViewMode('reschedule')}
              className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-zinc-900 border border-purple-500/30 hover:border-purple-400/60 text-white font-semibold text-xs active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50"
            >
              <CalendarClock size={16} className="text-purple-400" />
              <span>Remarcar Data ou Horário</span>
            </button>

            {/* Botão Falar no WhatsApp */}
            {appointment.client_phone && (
              <button
                type="button"
                onClick={handleOpenWhatsApp}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-zinc-900 border border-emerald-500/30 hover:border-emerald-500/60 text-emerald-300 font-semibold text-xs active:scale-[0.99] transition-all touch-manipulation"
              >
                <MessageSquare size={16} className="text-emerald-400" />
                <span>Conversar no WhatsApp</span>
              </button>
            )}

            {/* Botão Cancelar Pré-Agendamento */}
            <button
              type="button"
              disabled={loading}
              onClick={() => setViewMode('cancel')}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-900/40 text-red-300 font-medium text-xs active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50"
            >
              <XCircle size={15} className="text-red-400" />
              <span>Cancelar Pré-Agendamento</span>
            </button>
          </div>
        )}

        {/* Visualização 2: Formulário de Remarcação */}
        {viewMode === 'reschedule' && (
          <form onSubmit={handleRescheduleSubmit} className="space-y-3 pt-1">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <CalendarClock size={14} className="text-purple-400" />
                Escolher Nova Data & Horário
              </h3>
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="text-[11px] text-zinc-400 hover:text-white"
              >
                Voltar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                  Nova Data
                </label>
                <input
                  type="date"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                  Novo Horário
                </label>
                <input
                  type="time"
                  required
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {team.length > 0 && (
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 block mb-1">
                  Barbeiro Responsável
                </label>
                <select
                  value={newBarberId}
                  onChange={(e) => setNewBarberId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs focus:outline-none focus:border-purple-500"
                >
                  {team.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="flex-1 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-950/50 disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                <span>Salvar Remarcação</span>
              </button>
            </div>
          </form>
        )}

        {/* Visualização 3: Confirmação de Cancelamento com Motivo */}
        {viewMode === 'cancel' && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                <AlertCircle size={14} />
                Motivo do Cancelamento
              </h3>
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="text-[11px] text-zinc-400 hover:text-white"
              >
                Voltar
              </button>
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Ao cancelar, a vaga é liberada instantaneamente no banco de dados do Supabase para que outro cliente possa marcar.
            </p>

            <div className="space-y-1.5">
              {[
                'Cliente avisou previamente por fora',
                'Cliente pediu para desmarcar',
                'Impossibilidade de comparecimento',
                'Barbeiro indisponível',
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setCancelReason(reason)}
                  className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all ${
                    cancelReason === reason
                      ? 'bg-red-950/40 border-red-500/60 text-red-200 font-semibold'
                      : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="flex-1 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-semibold"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleCancelSubmit}
                className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-md shadow-red-950/50 disabled:opacity-50"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
                <span>Confirmar Cancelamento</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
