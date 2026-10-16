'use client';

import { X, Smartphone, Globe, MessageSquare, Bell, Calendar } from 'lucide-react';

export default function HelpConfigModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface border border-zinc-800 rounded-2xl w-full max-w-md p-5 text-left shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">💡</span>
            <div>
              <h3 className="text-white font-bold text-base">Ajuda p/ Configurar</h3>
              <p className="text-zinc-500 text-xs">Instruções rápidas de uso do sistema</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs text-zinc-300">
          <div className="flex items-start gap-3 bg-elevated/60 p-3 rounded-xl border border-zinc-800/80">
            <Globe size={18} className="text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white text-sm">Link do Chatbot de Agendamento</p>
              <p className="text-zinc-400 mt-1 leading-relaxed">
                Compartilhe o link <strong className="text-white">https://chatbot-jmbarberclub.vercel.app/</strong> na bio do Instagram ou envie diretamente para os clientes agendarem em poucos toques.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-elevated/60 p-3 rounded-xl border border-zinc-800/80">
            <Bell size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white text-sm">Notificações Push no Celular</p>
              <p className="text-zinc-400 mt-1 leading-relaxed">
                Toque no sininho no topo do painel e ative as notificações. Assim que um cliente marcar horário pelo chatbot, seu telemóvel vibrará com o aviso instantâneo.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-elevated/60 p-3 rounded-xl border border-zinc-800/80">
            <Calendar size={18} className="text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white text-sm">Expediente e Pausas</p>
              <p className="text-zinc-400 mt-1 leading-relaxed">
                Na aba <strong>Expediente</strong>, você pode ligar/desligar dias de trabalho, alterar horários de abertura e fechamento, e definir folgas pontuais.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-elevated/60 p-3 rounded-xl border border-zinc-800/80">
            <Smartphone size={18} className="text-purple-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white text-sm">Instalar como Aplicativo (PWA)</p>
              <p className="text-zinc-400 mt-1 leading-relaxed">
                No navegador do seu smartphone, clique em <em>Compartilhar</em> (iOS) ou nos <em>3 pontos</em> (Android) e escolha <strong>&quot;Adicionar à Tela de Início&quot;</strong> para abrir o painel em tela cheia como um app nativo.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-accent hover:bg-accent-hover text-black font-bold py-2.5 rounded-xl text-xs transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
