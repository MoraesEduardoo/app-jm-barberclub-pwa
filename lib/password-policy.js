// Política única de senha (cliente + servidor). Sem dependências.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // limite do bcrypt usado pelo Supabase Auth

/** Devolve a mensagem de erro (string) ou null se a senha é válida. */
export function validateNewPassword(password, confirm) {
  if (typeof password !== "string" || typeof confirm !== "string") {
    return "Preencha os dois campos.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha precisa ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  if (password !== confirm) {
    return "As senhas não são iguais.";
  }
  return null;
}
