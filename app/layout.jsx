import "./globals.css";
import PWAUpdateListener from "@/components/admin/PWAUpdateListener";

export const metadata = {
  title: "JM Barberclub — Painel do Barbeiro",
  description:
    "Painel administrativo exclusivo da equipe da Barbearia do Matheus",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/logo-192.png",
    apple: "/icons/logo-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Painel Barbeiro",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className="bg-black">
      <body className="bg-black text-zinc-100 antialiased min-h-screen">
        <PWAUpdateListener />
        {children}
      </body>
    </html>
  );
}