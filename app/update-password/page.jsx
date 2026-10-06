import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireBarber } from "@/lib/auth-server";
import UpdatePasswordForm from "@/components/admin/UpdatePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova senha — JM Barberclub", robots: { index: false, follow: false } };

// Validação de sessão NO SERVIDOR antes de renderizar o formulário.
export default async function UpdatePasswordPage() {
  const ctx = await requireBarber();

  if (ctx.error) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
          <ShieldAlert className="text-accent-light" size={26} />
        </div>
        <h1 className="text-white font-semibold text-lg">Link inválido ou expirado</h1>
        <p className="text-zinc-500 text-sm max-w-xs">
          O link de recuperação já foi usado ou venceu. Peça um novo ao chefe.
        </p>
        <Link href="/recuperar-senha" className="text-sm text-accent-light hover:opacity-80">
          Como recuperar o acesso
        </Link>
      </div>
    );
  }

  return <UpdatePasswordForm />;
}
