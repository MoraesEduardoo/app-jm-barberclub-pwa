import { createClient } from "@supabase/supabase-js";

export default async function SetupPage() {
  // Liga-se ao Supabase usando as chaves seguras da Vercel
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const domain =
    process.env.NEXT_PUBLIC_BARBER_AUTH_DOMAIN || "barbers.jmbarberclub.app";

  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Pega a lista de barbeiros da sua base de dados
  const { data: barbers } = await admin
    .from("barbers")
    .select("id, name, phone, active");

  // Função que será executada nos servidores da Vercel ao clicar em Salvar
  async function criarSenhaManual(formData) {
    "use server";
    const adminServer = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );

    const id = formData.get("id");
    const phone = formData.get("phone").replace(/\D/g, "");
    const password = formData.get("password");

    // Cria o login real no Supabase Auth com a senha que escolheu
    await adminServer.auth.admin.createUser({
      email: `${phone}@${process.env.NEXT_PUBLIC_BARBER_AUTH_DOMAIN || "barbers.jmbarberclub.app"}`,
      password: password,
      email_confirm: true,
      app_metadata: { barber_id: id },
    });
  }

  return (
    <div
      style={{
        padding: "40px",
        backgroundColor: "#111",
        color: "white",
        minHeight: "100vh",
        fontFamily: "sans-serif",
      }}
    >
      <h2>Painel Provisório - Criar Senhas</h2>
      <p style={{ color: "#888" }}>
        Escreva a senha para cada barbeiro e clique em "Salvar Senha". O botão
        não dará aviso, mas a senha será guardada instantaneamente.
      </p>

      {barbers?.map((b) => (
        <form
          action={criarSenhaManual}
          key={b.id}
          style={{
            border: "1px solid #333",
            padding: "20px",
            margin: "15px 0",
            borderRadius: "8px",
          }}
        >
          <strong style={{ fontSize: "18px" }}>{b.name}</strong> - {b.phone}
          <br />
          <br />
          <input type="hidden" name="id" value={b.id} />
          <input type="hidden" name="phone" value={b.phone} />
          <input
            type="text"
            name="password"
            placeholder="Digite a senha (mínimo 6 caracteres)"
            required
            minLength={6}
            style={{
              padding: "12px",
              width: "100%",
              maxWidth: "300px",
              color: "black",
              borderRadius: "6px",
              border: "none",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "12px 20px",
              marginLeft: "10px",
              marginTop: "10px",
              backgroundColor: "#e53e3e",
              color: "white",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Salvar Senha
          </button>
        </form>
      ))}
    </div>
  );
}
