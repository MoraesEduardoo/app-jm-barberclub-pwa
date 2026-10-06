import Link from "next/link";
import { KeyRound, MessageCircle } from "lucide-react";

export const metadata = { title: "Recuperar acesso — JM Barberclub", robots: { index: false, follow: false } };

const ERRORS = {
  link: "Esse link expirou ou já foi usado. Peça um novo ao chefe.",
  rede: "Não foi possível validar o link agora. Tente abrir de novo.",
};

export default function RecuperarSenhaPage({ searchParams }) {
  const erro = typeof searchParams?.erro === "string" ? ERRORS[searchParams.erro] : null;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
        <KeyRound className="text-accent-light" size={26} />
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-white font-semibold text-lg">Esqueceu a senha?</h1>
        <p className="text-zinc-500 text-sm mt-1">
          O acesso é por telefone, então não há e-mail de recuperação.
        </p>
      </div>

      {erro && (
        <p role="alert" className="text-accent-light text-xs text-center max-w-xs">
          {erro}
        </p>
      )}

      <div className="w-full max-w-xs rounded-xl border border-zinc-800 bg-surface p-4 text-sm text-zinc-300 space-y-2">
        <p className="flex items-start gap-2">
          <MessageCircle size={16} className="mt-0.5 shrink-0 text-accent-light" />
          Peça ao chefe para gerar um link de recuperação em <strong className="text-white">Equipe</strong> e enviar
          para o seu WhatsApp.
        </p>
        <p className="text-zinc-500 text-xs">O link vale uma única vez e expira em pouco tempo.</p>
      </div>

      <Link href="/login" className="text-sm text-zinc-500 hover:text-white transition-colors">
        Voltar para o login
      </Link>
    </div>
  );
}
