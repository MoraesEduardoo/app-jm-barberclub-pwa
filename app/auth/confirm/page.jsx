import { KeyRound } from "lucide-react";

export const metadata = {
  title: "Recuperar acesso — JM Barberclub",
  robots: { index: false, follow: false },
  referrer: "no-referrer", // o token vai na URL: não vaza em Referer
};

// Página SEM efeito colateral: abrir o link (ou o WhatsApp gerar pré-visualização)
// NÃO consome o token. Só o clique no botão (POST) valida e queima o token.
export default function ConfirmPage({ searchParams }) {
  const tokenHash = typeof searchParams?.token_hash === "string" ? searchParams.token_hash : "";
  const type = searchParams?.type === "recovery" ? "recovery" : "";
  const valid = tokenHash.length > 0 && type === "recovery";

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
        <KeyRound className="text-accent-light" size={26} />
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-white font-semibold text-lg">Recuperar acesso</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {valid
            ? "Toque no botão para definir a sua nova senha."
            : "Este link está incompleto. Peça um novo ao chefe."}
        </p>
      </div>

      {valid ? (
        <form action="/auth/verify" method="post" className="w-full max-w-xs">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <button
            type="submit"
            className="w-full h-12 rounded-lg bg-accent text-white font-semibold text-sm shadow-accent-glow active:bg-accent-dark transition-colors"
          >
            Definir nova senha
          </button>
        </form>
      ) : (
        <a href="/recuperar-senha" className="text-sm text-zinc-500 hover:text-white transition-colors">
          Como recuperar o acesso
        </a>
      )}
    </div>
  );
}
