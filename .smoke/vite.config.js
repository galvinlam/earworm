import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const here = resolve(import.meta.dirname);

export default defineConfig({
  root: resolve(here, '..'),
  plugins: [react()],
  resolve: {
    alias: {
      // jsdom has no Web Audio, so the engine talks to a recording stub.
      tone: resolve(here, 'toneStub.js'),
    },
  },
  build: {
    ssr: true,
    outDir: resolve(here, 'out'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        entry: resolve(here, 'entry.jsx'),
        network: resolve(here, 'network.jsx'),
        audio: resolve(here, 'audio.jsx'),
      },
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
});
