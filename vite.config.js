import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Notenotes/',
  build: {
    // Sheet music/abcjs is code-split on demand. Keep a budget that still
    // catches a return to the former 1.18 MB startup bundle without warning
    // on the intentionally deferred abcjs chunk.
    chunkSizeWarningLimit: 700,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Notenotes',
        short_name: 'Notenotes',
        description: 'A rapid-capture musical sketchpad. Jot down melodies, basslines, rhythms, and vocals instantly.',
        theme_color: '#1a1a1a',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'any',
        start_url: '/Notenotes/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/DiagnosticsPanel-*'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    open: true
  }
});
