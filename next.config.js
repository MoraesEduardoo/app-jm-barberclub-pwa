/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

// Configuração segura do PWA condicional para evitar erro de require
let withPWA;
try {
  withPWA = require("@ducanh2912/next-pwa").default || require("@ducanh2912/next-pwa");
} catch (e) {
  withPWA = (config) => config;
}

module.exports = withPWA({
  dest: "public",
  cacheOnFrontendNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true, // Limpa os caches de versões anteriores automaticamente
    navigateFallbackDenylist: [/^\/api/], // Impede cache estático nas rotas de API
  },
  disable: process.env.NODE_ENV === "development",
})(nextConfig);