import "./globals.css";
import PWAUpdateListener from "@/components/admin/PWAUpdateListener";

export const metadata = {
  title: "JM Barberclub — Painel do Barbeiro",
  description:
    "Painel administrativo e gestão de alta conversão da Barbearia JM Barberclub",
  applicationName: "JM Barberclub",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/logo-192.png",
    apple: "/icons/logo-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "JM Barberclub",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f0f0f",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className="bg-black">
      <body className="bg-black text-zinc-100 antialiased min-h-screen selection:bg-red-600/30 selection:text-white">
        <PWAUpdateListener />
        {children}
      </body>
    </html>
  );
}