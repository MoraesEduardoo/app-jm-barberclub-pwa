"use client";

import { Bell, Smartphone, Apple, Share, PlusSquare, CheckCircle2 } from "lucide-react";
import BottomSheet from "./BottomSheet";

export default function HelpConfigModal({ open, onClose }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Ajuda p/ Configurar">
      <div className="space-y-3 pb-2">
        {/* Card de Isolamento de Notificações Push por Perfil (barber_id) */}
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-3 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
            <Bell size={17} className="text-accent-light" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-xs">
              Notificações Isoladas por Perfil
            </p>
            <p className="text-zinc-400 text-xs mt-0.5 leading-relaxed">
              Os alertas Push são vinculados ao seu <strong className="text-zinc-200">barber_id</strong>. Cada profissional recebe exclusivamente os avisos da sua própria agenda e clientes.
            </p>
          </div>
        </div>

        {/* Seção 1: Android / Chrome */}
        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
            <Smartphone size={16} />
            <h3>Android (Chrome)</h3>
          </div>
          <ol className="space-y-2 text-xs text-zinc-300">
            <li className="flex items-start gap-2">
              <span className="h-5 w-5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                1
              </span>
              <span>
                Toque em <strong className="text-white">⋮</strong> no Chrome e selecione{" "}
                <strong className="text-white">Instalar aplicativo</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="h-5 w-5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                2
              </span>
              <span>
                Abra o app instalado e toque no <strong className="text-white">sino</strong> no topo para ativar os alertas do seu perfil.
              </span>
            </li>
          </ol>
        </section>

        {/* Seção 2: iPhone / iOS (Safari) */}
        <section className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-blue-400 font-semibold text-xs">
            <Apple size={16} />
            <h3>iPhone / iOS (Safari)</h3>
          </div>
          <ol className="space-y-2 text-xs text-zinc-300">
            <li className="flex items-start gap-2">
              <span className="h-5 w-5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                1
              </span>
              <span>
                No <strong className="text-white">Safari</strong>, toque em{" "}
                <strong className="text-white inline-flex items-center gap-1">
                  Compartilhar <Share size={11} className="inline" />
                </strong>{" "}
                e em{" "}
                <strong className="text-white inline-flex items-center gap-1">
                  Tela de Início <PlusSquare size={11} className="inline" />
                </strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="h-5 w-5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-bold text-[10px] flex items-center justify-center shrink-0">
                2
              </span>
              <span>
                Abra pela Tela de Início e ative o <strong className="text-white">sino</strong> para receber os alertas da sua agenda.
              </span>
            </li>
          </ol>
        </section>

        <button
          type="button"
          onClick={onClose}
          className="w-full h-11 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-[0.99]"
        >
          <CheckCircle2 size={15} />
          Entendi
        </button>
      </div>
    </BottomSheet>
  );
}
