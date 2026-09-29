"use client";

import LoginScreen from "@/components/admin/LoginScreen";

export default function LoginPage() {
  // window.location (e não router.push) para o servidor já receber o cookie novo
  return <LoginScreen onSuccess={() => window.location.assign("/admin/agenda")} />;
}
