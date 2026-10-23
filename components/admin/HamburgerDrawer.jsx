'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  X,
  Link2,
  Copy,
  Check,
  ExternalLink,
  Users,
  CalendarX2,
  RefreshCw,
  TrendingUp,
  HelpCircle,
  AlertTriangle,
  LogOut,
  ShieldCheck,
  Scissors,
  ChevronRight,
  Sparkles,
  Receipt,
} from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { CHATBOT_URL } from '@/lib/site-url';
import { toast } from '@/lib/toast';
import HelpConfigModal from './HelpConfigModal';

export default function HamburgerDrawer({ open, onClose, onOpenRecorrencias }) {
  const pathname = usePathname();
  const { barber, isChefe, isManager, signOut } = useBarber();
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  if (!open) return null;

  async function handleCopyChatbotLink() {
    try {
      await navigator.clipboard.writeText(CHATBOT_URL);
      setCopied(true);
      toast('Link do chatbot copiado!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('Não foi possível copiar o link.');
    }
  }

  function handleReportError() {
    const text = encodeURIComponent(
      `Olá! Estou usando o painel administrativo do JM Barberclub (${barber?.name || 'Barbeiro'}) e preciso de suporte com um detalhe do sistema:`
    );
    window.open(`https://wa.me/5583996646306?text=${text}`, '_blank');
  }

  const roleLabel = isChefe ? 'Chefe / Admin' : isManager ? 'Gerente' : 'Barbeiro';
  const roleBadgeColor = isChefe
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
    : isManager
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
    : 'border-zinc-700 bg-zinc-800 text-zinc-300';

  return (
    <>
      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop escuro */}
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Painel lateral deslizante */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu principal"
          className="relative w-full max-w-[320px] bg-zinc-950 border-r border-zinc-800 h-full flex flex-col z-10 shadow-2xl safe-top safe-bottom overflow-hidden"
        >
          {/* Topo da barra lateral */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent font-bold text-sm">
                JM
              </span>
              <div>
                <h2 className="text-white font-bold text-sm tracking-wide">JM BARBERCLUB</h2>
                <p className="text-zinc-500 text-[10px]">Painel da Barbearia</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar menu"
              className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Perfil do Barbeiro Logado */}
          <div className="p-4 bg-zinc-900/50 border-b border-zinc-800/60">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-elevated border border-zinc-700 overflow-hidden flex items-center justify-center text-sm font-semibold text-white shrink-0">
                {barber?.avatar_url ? (
                  <img src={barber.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  barber?.name?.charAt(0)?.toUpperCase() ?? '?'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white font-semibold text-sm truncate">{barber?.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${roleBadgeColor}`}
                  >
                    <ShieldCheck size={11} />
                    {roleLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Conteúdo com rolagem do menu */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Bloco: Meu Link (Chatbot Oficial) */}
            <div className="bg-elevated/70 border border-zinc-800/90 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Link2 size={15} className="text-accent" />
                  <span>Meu Link (Chatbot)</span>
                </div>
                <span className="text-[10px] bg-accent/15 text-accent-light px-2 py-0.5 rounded-full font-medium">
                  Oficial
                </span>
              </div>

              <div className="bg-black/80 rounded-xl px-2.5 py-1.5 border border-zinc-800 text-[11px] font-mono text-zinc-400 truncate">
                {CHATBOT_URL}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={handleCopyChatbotLink}
                  className="flex items-center justify-center gap-1.5 bg-accent text-black font-semibold text-xs py-2 px-3 rounded-xl hover:bg-accent-hover active:scale-95 transition-all touch-manipulation"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                </button>

                <a
                  href={CHATBOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs py-2 px-3 rounded-xl border border-zinc-700 active:scale-95 transition-all touch-manipulation"
                >
                  <ExternalLink size={13} />
                  <span>Abrir</span>
                </a>
              </div>
            </div>

            {/* Navegação Principal */}
            <div className="space-y-1">
              <p className="px-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Gestão & Ferramentas
              </p>

              {/* Clientes */}
              <Link
                href="/admin/clientes"
                onClick={onClose}
                className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                  pathname === '/admin/clientes'
                    ? 'bg-accent/15 text-white font-medium border border-accent/30'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-800/80 flex items-center justify-center text-accent">
                    <Users size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold block leading-tight">Clientes</span>
                    <span className="text-[10px] text-zinc-500">Histórico, frequência e WhatsApp</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-600" />
              </Link>

              {/* Cancelados */}
              <Link
                href="/admin/cancelados"
                onClick={onClose}
                className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                  pathname === '/admin/cancelados'
                    ? 'bg-accent/15 text-white font-medium border border-accent/30'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-800/80 flex items-center justify-center text-rose-400">
                    <CalendarX2 size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold block leading-tight">Cancelados</span>
                    <span className="text-[10px] text-zinc-500">Horários desmarcados e motivos</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-600" />
              </Link>

              {/* Minhas Recorrências */}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onOpenRecorrencias) onOpenRecorrencias();
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white transition-all text-left touch-manipulation"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-800/80 flex items-center justify-center text-emerald-400">
                    <RefreshCw size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold block leading-tight">
                      Minhas Recorrências
                    </span>
                    <span className="text-[10px] text-zinc-500">Ciclo de retorno e recall</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-600" />
              </button>

              {/* Equipe (Liderança: Chefe e Gerente) */}
              {isLeadership && (
                <Link
                  href="/admin/equipe"
                  onClick={onClose}
                  className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                    pathname === '/admin/equipe'
                      ? 'bg-accent/15 text-white font-medium border border-accent/30'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-zinc-800/80 flex items-center justify-center text-accent">
                      <Users size={16} />
                    </div>
                    <div>
                      <span className="text-xs font-semibold block leading-tight">Equipe & Colaboradores</span>
                      <span className="text-[10px] text-zinc-500">Expedientes, especialidades e acessos</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-zinc-600" />
                </Link>
              )}

              {/* Faturamento */}
              <Link
                href="/admin/financeiro"
                onClick={onClose}
                className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                  pathname === '/admin/financeiro'
                    ? 'bg-amber-500/15 text-white font-medium border border-amber-500/30'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <TrendingUp size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold block leading-tight">
                        {isChefe ? 'Faturamento & Caixa' : 'Meu Caixa & Comissões'}
                      </span>
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-bold uppercase">
                        Caixa
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-500">
                      {isChefe ? 'Entradas, comissões e fechamento' : 'Meus cortes realizados e comissão'}
                    </span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-600" />
              </Link>

              {/* Despesas - Restrito estritamente ao Chefe (Gerente não tem acesso) */}
              {isChefe && (
                <Link
                  href="/admin/financeiro/completo"
                  onClick={onClose}
                  className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                    pathname === '/admin/financeiro/completo'
                      ? 'bg-rose-500/15 text-white font-medium border border-rose-500/30'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                      <Receipt size={16} />
                    </div>
                    <div>
                      <span className="text-xs font-semibold block leading-tight">Despesas</span>
                      <span className="text-[10px] text-zinc-500">
                        Custos fixos, compras e saldo líquido
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-zinc-600" />
                </Link>
              )}
            </div>

            {/* Suporte & Ajuda */}
            <div className="space-y-1 pt-2 border-t border-zinc-800/60">
              <p className="px-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Suporte & Sistema
              </p>

              {/* Ajuda p/ Configurar */}
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white transition-all text-left touch-manipulation"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-800/80 flex items-center justify-center text-sky-400">
                    <HelpCircle size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold block leading-tight">
                      Ajuda p/ Configurar
                    </span>
                    <span className="text-[10px] text-zinc-500">Guia rápido do Chatbot e PWA</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-600" />
              </button>

              {/* Reportar Erro */}
              <button
                type="button"
                onClick={handleReportError}
                className="w-full flex items-center justify-between p-2.5 rounded-xl text-zinc-300 hover:bg-zinc-900 hover:text-white transition-all text-left touch-manipulation"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-800/80 flex items-center justify-center text-orange-400">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold block leading-tight">Reportar Erro</span>
                    <span className="text-[10px] text-zinc-500">Suporte direto via WhatsApp</span>
                  </div>
                </div>
                <ExternalLink size={14} className="text-zinc-600" />
              </button>
            </div>
          </div>

          {/* Rodapé do Menu */}
          <div className="p-3 border-t border-zinc-800/80 bg-zinc-950 space-y-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                signOut();
              }}
              className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl text-rose-400 bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 text-xs font-semibold transition-all touch-manipulation"
            >
              <LogOut size={15} />
              <span>Sair do painel</span>
            </button>

            <p className="text-[10px] text-zinc-600 text-center font-mono">
              JM Barberclub • PWA v2.4
            </p>
          </div>
        </aside>
      </div>

      <HelpConfigModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
