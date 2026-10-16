'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Percent,
  Calendar,
  Wallet,
  Clock,
  Scissors,
  Check,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  Receipt,
  FileText,
  Copy,
  ArrowRight,
  ShieldCheck,
  Banknote,
  QrCode,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import {
  getCommissionSettlementPreview,
  executeCommissionSettlement,
  listCommissionPayouts,
} from '@/lib/actions/commission-settlements';
import {
  buildSettlementReceiptWhatsAppMessage,
  getWhatsAppClickToChatUrl,
} from '@/lib/whatsapp';
import { toast } from '@/lib/toast';

const PERIOD_OPTIONS = [
  { key: 'semana_passada', label: 'Semana Passada (Recomendado)' },
  { key: 'semana_atual', label: 'Esta Semana (Até Hoje)' },
  { key: 'mes_passado', label: 'Mês Passado Completo' },
  { key: 'mes_atual', label: 'Este Mês (Até Hoje)' },
];

function formatBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

export default function CommissionSettlementSheet({ open, onClose, defaultBarberId = null }) {
  const [activeTab, setActiveTab] = useState('fechamento'); // 'fechamento' | 'historico'
  const [periodKey, setPeriodKey] = useState('semana_passada');
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedBarber, setExpandedBarber] = useState(null);

  // Estados de confirmação do acerto
  const [confirmModal, setConfirmModal] = useState(null); // barber data to settle
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [notes, setNotes] = useState('');
  const [settling, setSettling] = useState(false);

  // Estado do recibo gerado com sucesso
  const [successReceipt, setSuccessReceipt] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCommissionSettlementPreview({ periodKey });
      setData(res);
      if (defaultBarberId) {
        setExpandedBarber(defaultBarberId);
      }
    } catch (err) {
      console.error('Erro ao carregar prévia de acertos:', err);
      toast.error(err.message || 'Erro ao carregar cálculos.');
    } finally {
      setLoading(false);
    }
  }, [periodKey, defaultBarberId]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const list = await listCommissionPayouts();
      setHistory(list);
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      if (activeTab === 'fechamento') {
        loadPreview();
      } else {
        loadHistory();
      }
    }
  }, [open, activeTab, loadPreview, loadHistory]);

  async function handleConfirmSettlement() {
    if (!confirmModal) return;
    setSettling(true);
    try {
      const res = await executeCommissionSettlement({
        barberId: confirmModal.barberId,
        periodStart: data.period.from,
        periodEnd: data.period.to,
        periodLabel: data.period.label,
        totalRevenue: confirmModal.totalRevenue,
        commissionAmount: confirmModal.balancePending > 0 ? confirmModal.balancePending : confirmModal.totalCommissionDue,
        commissionPercent: confirmModal.commissionPercent,
        appointmentsCount: confirmModal.appointmentsCount,
        appointmentIds: (confirmModal.cuts || []).map((c) => c.id),
        paymentMethod,
        notes,
      });

      if (res.success && res.payout) {
        toast.success(`Acerto de ${confirmModal.barberName} realizado com sucesso!`);
        setConfirmModal(null);
        setNotes('');
        setSuccessReceipt(res.payout);
        loadPreview();
      }
    } catch (err) {
      toast.error(err.message || 'Falha ao registrar acerto.');
    } finally {
      setSettling(false);
    }
  }

  function handleSendWhatsAppReceipt(payout) {
    if (!payout) return;
    const msg = buildSettlementReceiptWhatsAppMessage(payout);
    const url = getWhatsAppClickToChatUrl(payout.barber_phone, msg);
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.error('Telefone do colaborador não cadastrado.');
    }
  }

  function handleCopyReceiptText(payout) {
    if (!payout) return;
    const msg = buildSettlementReceiptWhatsAppMessage(payout);
    navigator.clipboard.writeText(msg);
    setCopied(true);
    toast.success('Comprovante copiado para a área de transferência!');
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Fechamento & Acerto de Comissões">
      <div className="space-y-4 pb-4">
        {/* Navegação entre Fechamento e Histórico de Acertos */}
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('fechamento')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all touch-manipulation ${
              activeTab === 'fechamento'
                ? 'bg-accent text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Wallet size={14} />
            <span>Novo Acerto</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('historico')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all touch-manipulation ${
              activeTab === 'historico'
                ? 'bg-accent text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Receipt size={14} />
            <span>Histórico de Acertos</span>
          </button>
        </div>

        {activeTab === 'fechamento' && (
          <>
            {/* Seletor de Período do Fechamento */}
            <div className="bg-surface border border-zinc-800 rounded-xl p-3 space-y-2">
              <label className="block text-zinc-400 text-xs font-medium flex items-center gap-1.5">
                <Calendar size={13} className="text-accent-light" />
                Selecione o Período de Fechamento:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setPeriodKey(opt.key)}
                    className={`p-2 rounded-lg border text-left transition-all touch-manipulation ${
                      periodKey === opt.key
                        ? 'bg-accent/15 border-accent text-white ring-1 ring-accent/40 font-semibold text-xs'
                        : 'bg-elevated/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 text-xs'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {data?.period && (
                <p className="text-[11px] text-zinc-500 pt-1">
                  Intervalo oficial: <strong className="text-zinc-300">{data.period.label}</strong> ({data.period.from} a {data.period.to})
                </p>
              )}
            </div>

            {/* Resumo Consolidado do Período */}
            {data?.totals && (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-surface border border-zinc-800 rounded-xl p-2.5 text-center">
                  <span className="text-[10px] text-zinc-500 block">Total Faturado</span>
                  <span className="text-white text-xs font-bold mt-0.5 block">
                    {formatBRL(data.totals.revenue)}
                  </span>
                  <span className="text-[9px] text-zinc-500">{data.totals.cutsCount} cortes</span>
                </div>
                <div className="bg-surface border border-zinc-800 rounded-xl p-2.5 text-center">
                  <span className="text-[10px] text-accent-light block">Comissões (50%)</span>
                  <span className="text-accent-light text-xs font-bold mt-0.5 block">
                    {formatBRL(data.totals.commissionDue)}
                  </span>
                  <span className="text-[9px] text-zinc-500">bruto total</span>
                </div>
                <div className="bg-surface border border-zinc-800 rounded-xl p-2.5 text-center">
                  <span className="text-[10px] text-emerald-400 block">Pendente a Pagar</span>
                  <span className="text-emerald-400 text-xs font-bold mt-0.5 block">
                    {formatBRL(data.totals.balancePending)}
                  </span>
                  <span className="text-[9px] text-zinc-500">líquido</span>
                </div>
              </div>
            )}

            {/* Listagem de Colaboradores e seus Acertos */}
            {loading ? (
              <div className="space-y-2.5">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-28 rounded-xl bg-surface animate-pulse" />
                ))}
              </div>
            ) : data?.previewByBarber?.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-xs">
                Nenhum colaborador encontrado para este fechamento.
              </div>
            ) : (
              <div className="space-y-3">
                {data?.previewByBarber.map((b) => {
                  const isExpanded = expandedBarber === b.barberId;
                  const isChief = b.barberRole === 'admin';

                  return (
                    <div
                      key={b.barberId}
                      className="bg-surface border border-zinc-800 rounded-xl overflow-hidden shadow-sm"
                    >
                      {/* Topo do Card do Barbeiro */}
                      <div className="p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center font-bold text-accent-light text-xs">
                              {b.barberName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-white text-sm font-semibold">{b.barberName}</h4>
                                {isChief && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-accent/20 text-accent-light rounded font-medium">
                                    Chefe
                                  </span>
                                )}
                              </div>
                              <p className="text-zinc-500 text-[11px]">
                                {b.appointmentsCount} corte{b.appointmentsCount !== 1 ? 's' : ''} concluído(s) • Taxa de {b.commissionPercent}%
                              </p>
                            </div>
                          </div>

                          {/* Status de Acerto */}
                          {b.isFullySettled ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 rounded-full px-2.5 py-1">
                              <CheckCircle2 size={12} /> Já Acertado
                            </span>
                          ) : b.balancePending > 0 ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-900/60 rounded-full px-2.5 py-1">
                              <AlertCircle size={12} /> Pendente
                            </span>
                          ) : (
                            <span className="text-[11px] text-zinc-500 bg-zinc-900 rounded-full px-2.5 py-1">
                              Sem cortes
                            </span>
                          )}
                        </div>

                        {/* Indicadores Financeiros do Colaborador */}
                        <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2.5">
                          <div>
                            <span className="text-[9.5px] text-zinc-500 block">Faturado</span>
                            <span className="text-zinc-200 text-xs font-semibold">
                              {formatBRL(b.totalRevenue)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9.5px] text-zinc-500 block">Comissão ({b.commissionPercent}%)</span>
                            <span className="text-accent-light text-xs font-semibold">
                              {formatBRL(b.totalCommissionDue)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9.5px] text-emerald-400 font-semibold block">A Receber</span>
                            <span className="text-white text-xs font-bold">
                              {formatBRL(b.balancePending)}
                            </span>
                          </div>
                        </div>

                        {/* Botões de Ação */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setExpandedBarber(isExpanded ? null : b.barberId)}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg py-2 text-xs text-zinc-300 font-medium active:scale-95 transition-all"
                          >
                            <Scissors size={13} className="text-zinc-400" />
                            <span>{isExpanded ? 'Ocultar Cortes' : `Ver ${b.appointmentsCount} Cortes`}</span>
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>

                          <button
                            type="button"
                            disabled={b.balancePending <= 0}
                            onClick={() => setConfirmModal(b)}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded-lg py-2 text-xs font-semibold active:scale-95 transition-all shadow-sm"
                          >
                            <Check size={14} />
                            <span>Efetuar Acerto</span>
                          </button>
                        </div>
                      </div>

                      {/* Lista Expansível de Cortes Realizados */}
                      {isExpanded && (
                        <div className="border-t border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
                          <h5 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                            <span>Extrato de Atendimentos ({b.cuts.length})</span>
                            <span className="text-zinc-500 font-normal">Regra: 50% por serviço</span>
                          </h5>

                          {b.cuts.length === 0 ? (
                            <p className="text-zinc-500 text-xs py-2 text-center">
                              Nenhum atendimento registrado no período selecionado.
                            </p>
                          ) : (
                            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                              {b.cuts.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-center justify-between bg-zinc-900 border border-zinc-800/80 rounded-lg px-2.5 py-1.5 text-xs"
                                >
                                  <div className="min-w-0 pr-2">
                                    <p className="text-white font-medium truncate leading-tight">
                                      {c.clientName}
                                    </p>
                                    <p className="text-[10.5px] text-zinc-500 mt-0.5 truncate">
                                      {c.serviceName} • {c.date.slice(5)} às {c.time}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="text-white font-semibold block">
                                      {formatBRL(c.price)}
                                    </span>
                                    <span className="text-emerald-400 text-[10px] font-medium block">
                                      +{formatBRL(c.commission)} (50%)
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Aba de Histórico de Acertos Anteriores */}
        {activeTab === 'historico' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400 font-medium">
                Recibos e Fechamentos Consolidados
              </span>
              <button
                type="button"
                onClick={loadHistory}
                className="text-[11px] text-accent-light hover:underline"
              >
                Atualizar
              </button>
            </div>

            {historyLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-surface animate-pulse" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-xs space-y-1">
                <Receipt size={24} className="mx-auto text-zinc-600 mb-2" />
                <p>Nenhum acerto registrado anteriormente.</p>
                <p className="text-[11px] text-zinc-600">
                  Os fechamentos realizados ficam gravados aqui com auditoria completa.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                {history.map((p) => {
                  const bName = p.barber?.name || 'Colaborador';
                  const dPaid = new Date(p.paid_at || p.created_at).toLocaleDateString('pt-BR');

                  return (
                    <div
                      key={p.id}
                      className="bg-surface border border-zinc-800 rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white">{bName}</span>
                            <span className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                              {p.receipt_code}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            {p.period_label || `${p.period_start} a ${p.period_end}`} • Pago em {dPaid}
                          </p>
                        </div>

                        <div className="text-right">
                          <span className="text-emerald-400 font-bold text-sm block">
                            {formatBRL(p.commission_amount)}
                          </span>
                          <span className="text-[10px] text-zinc-500 uppercase">
                            {p.payment_method || 'PIX'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-zinc-800/80">
                        <span className="text-[10.5px] text-zinc-500">
                          {p.appointments_count || 0} corte(s) • Faturado: {formatBRL(p.total_revenue)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyReceiptText(p)}
                            className="p-1.5 text-zinc-400 hover:text-white transition-colors"
                            title="Copiar Comprovante"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendWhatsAppReceipt(p)}
                            className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-full px-2.5 py-1 text-[10.5px] font-semibold active:scale-95 transition-all"
                          >
                            <Send size={11} /> WhatsApp
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de Confirmação do Acerto */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="bg-surface border border-zinc-800 rounded-2xl w-full max-w-md p-4 space-y-3.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Check size={16} />
                </div>
                <div>
                  <h3 className="text-white text-sm font-bold">Confirmar Acerto de Comissão</h3>
                  <p className="text-zinc-500 text-xs">{confirmModal.barberName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="text-zinc-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Resumo dos Valores */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Período:</span>
                <span className="text-white font-medium">{data?.period?.label}</span>
              </div>
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Cortes Concluídos:</span>
                <span className="text-white font-medium">{confirmModal.appointmentsCount}</span>
              </div>
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Faturamento Bruto:</span>
                <span className="text-white font-medium">{formatBRL(confirmModal.totalRevenue)}</span>
              </div>
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Taxa de Comissão:</span>
                <span className="text-white font-medium">{confirmModal.commissionPercent}%</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-2 border-t border-zinc-800 text-emerald-400">
                <span>Total Líquido a Pagar:</span>
                <span>{formatBRL(confirmModal.balancePending)}</span>
              </div>
            </div>

            {/* Forma de Pagamento */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-300">
                Forma de Pagamento Utilizada:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'pix', label: 'PIX', icon: QrCode },
                  { id: 'dinheiro', label: 'Dinheiro', icon: Banknote },
                  { id: 'transferencia', label: 'Transferência', icon: Wallet },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                      paymentMethod === m.id
                        ? 'bg-accent/20 border-accent text-white font-semibold'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    <m.icon size={15} />
                    <span className="text-[11px]">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Observação Opcional */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-400">
                Observações / Chave PIX (Opcional):
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Pago via PIX celular, desconto adiantamento..."
                className="w-full h-9 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Botões de Ação */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-xs text-zinc-400 font-semibold hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={settling}
                onClick={handleConfirmSettlement}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-all"
              >
                {settling ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Registrando…
                  </>
                ) : (
                  <>
                    <Check size={14} /> Confirmar & Pagar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Recibo Digital com Compartilhamento WhatsApp */}
      {successReceipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="bg-surface border border-zinc-800 rounded-2xl w-full max-w-md p-4 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h3 className="text-white text-sm font-bold">Acerto Concluído com Sucesso!</h3>
                  <p className="text-emerald-400 text-xs">Recibo oficial gerado e registrado no caixa</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSuccessReceipt(null)}
                className="text-zinc-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Card Visual do Recibo */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 space-y-2.5 font-mono text-xs">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                <span className="text-zinc-400 font-sans font-bold">JM BARBERCLUB</span>
                <span className="text-accent-light text-[11px] font-bold">
                  {successReceipt.receipt_code}
                </span>
              </div>

              <div className="space-y-1 text-zinc-300">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Colaborador:</span>
                  <span className="text-white font-bold">{successReceipt.barber_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Período:</span>
                  <span>{successReceipt.period_label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Cortes Feitos:</span>
                  <span>{successReceipt.appointments_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Faturamento Bruto:</span>
                  <span>{formatBRL(successReceipt.total_revenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Taxa de Comissão:</span>
                  <span>{successReceipt.commission_percent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Forma Pagto:</span>
                  <span className="uppercase">{successReceipt.payment_method}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-zinc-800 text-emerald-400 font-bold text-sm">
                  <span>VALOR PAGO:</span>
                  <span>{formatBRL(successReceipt.commission_amount)}</span>
                </div>
              </div>
            </div>

            {/* Botões de Ação Imediata */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleSendWhatsAppReceipt(successReceipt)}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md"
              >
                <Send size={14} />
                <span>Enviar Comprovante no WhatsApp do Barbeiro</span>
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyReceiptText(successReceipt)}
                  className="flex-1 py-2 rounded-xl border border-zinc-700 text-xs text-zinc-300 font-medium hover:text-white flex items-center justify-center gap-1.5"
                >
                  <Copy size={13} />
                  <span>{copied ? 'Copiado!' : 'Copiar Texto'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSuccessReceipt(null)}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 text-xs text-white font-medium hover:bg-zinc-700"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
