const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  extendDefaultRuntimeCaching: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        // Fotos da galeria: cada upload tem caminho único (uuid) e nunca é sobrescrito,
        // então CacheFirst é seguro e deixa o catálogo abrir offline/instantâneo no PWA.
        urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/haircut-gallery\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'haircut-gallery-images',
          expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Upload da galeria: a foto já chega comprimida (~300 KB), mas o padrão de 1 MB é apertado.
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
}

module.exports = withPWA(nextConfig)