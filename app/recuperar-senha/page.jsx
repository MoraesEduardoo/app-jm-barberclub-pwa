import ForgotPasswordForm from "@/components/admin/ForgotPasswordForm";

export const metadata = { title: "Esqueci a senha — JM Barberclub", robots: { index: false, follow: false } };

// Erros que chegam do fluxo "link do chefe" (/auth/verify).
const LINK_ERRORS = {
  link: "Esse link expirou ou já foi usado. Peça um novo ao chefe ou use um código de recuperação.",
  rede: "Não foi possível validar o link agora. Tente abrir de novo.",
};

export default function RecuperarSenhaPage({ searchParams }) {
  const key = typeof searchParams?.erro === "string" ? searchParams.erro : "";
  return <ForgotPasswordForm initialError={LINK_ERRORS[key] || ""} />;
}
