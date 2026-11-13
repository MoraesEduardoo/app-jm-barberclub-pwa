import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata = {
  title: "JM Barberclub — Painel do Barbeiro",
  description: "Agenda, caixa, clientes e gestão do JM Barberclub.",
  manifest: "/manifest.json",
  appleWebApp: {
    statusBarStyle: "black-translucent",
    title: "JM Barberclub",
  },
  other: {
    "mobile-web-app-capable": "yes",
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
    <html lang="pt-BR" className={`${jakarta.variable} dark`}>
      <body className="bg-black text-white antialiased selection:bg-accent selection:text-white">
        {children}
      </body>
    </html>
  );
}