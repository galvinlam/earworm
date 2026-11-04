import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base` matters for GitHub Pages project sites, where the app is served from
// https://<user>.github.io/<repo>/ instead of the domain root.
// Set VITE_BASE=/your-repo-name/ when building for GH Pages. Vercel/Netlify
// need nothing. vite-plugin-pwa picks this up for the manifest scope too.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  plugins: [
    react(),

    /**
     * Installable on a phone, and useful without a connection.
     *
     * What works offline: opening the app, every saved draft, editing,
     * playback and export. What does not: generating, which needs the model
     * API. That split is worth knowing — the app says so rather than failing
     * mysteriously.
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png', 'og-image.png'],

      manifest: {
        name: 'Earworm — AI Song Architect',
        short_name: 'Earworm',
        description:
          'Turn one line of an idea into a song draft: lyrics, chords, melody and a band to play it.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0b0d14',
        theme_color: '#0b0d14',
        categories: ['music', 'productivity', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            // Android crops adaptive icons to a circle or squircle; this one
            // keeps the mark inside the safe zone.
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Tone.js is a large lazy chunk; precaching it means playback works
        // on a plane, which is exactly when you want to tinker with a song.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        // Never serve a cached model response: generations must be live.
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Instrument and drum samples. Immutable once fetched, so a plain
            // cache-first keeps offline playback working after the first play.
            urlPattern: /^https:\/\/tonejs\.github\.io\/audio\/.*\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'earworm-samples',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Guitar, bass and electric piano samples from the soundfont
            // (gleitz.github.io by default, or wherever VITE_SAMPLE_BASE_URL
            // points). Workbox only matches a cross-origin URL from its start,
            // hence the scheme at the front.
            urlPattern: /^https?:\/\/.+\/[a-z0-9_]+-mp3\/[A-G]b?\d\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'earworm-soundfont',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'earworm-font-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'earworm-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: {
        // Off by default: a service worker caching during development is a
        // reliable way to spend an hour wondering why an edit did nothing.
        enabled: false,
      },
    }),
  ],
});
