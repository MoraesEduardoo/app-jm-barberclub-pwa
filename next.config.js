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
        // Fotos da galeria e avatares: suporta tanto object quanto render/image otimizados
        // CacheFirst é seguro e deixa a galeria/avatares abrirem instantaneamente offline no PWA.
        urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/(object|render\/image)\/public\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'supabase-storage-images',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/**',
      },
    ],
  },
  // Upload da galeria: a foto já chega comprimida (~300 KB), mas o padrão de 1 MB é apertado.
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
}

module.exports = withPWA(nextConfig)