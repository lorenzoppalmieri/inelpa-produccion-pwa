import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'Inelpa - Registro de Producción',
        short_name: 'Inelpa Producción',
        description: 'Registro de eventos de producción para sector Bobinado AT',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'landscape',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Shell completa en precache; datos de Supabase se manejan en runtime + Dexie.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Llamadas a Supabase: network-first con fallback a cache, para no romper si hay wifi intermitente.
            urlPattern: ({ url }) => url.origin.includes('supabase.co'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 1 día
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Fuentes de Google / assets externos
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' ||
              url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 año
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // para probar el SW en `npm run dev`
        type: 'module',
      },
    }),
  ],
  server: {
    host: true, // accesible desde otros equipos de la red (útil para probar en los PC panel)
    port: 5173,
  },
})
