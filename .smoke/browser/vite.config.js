import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// A real browser bundle — no Tone stub — so the offline renderer is exercised
// against the actual Web Audio implementation.
export default defineConfig({
  root: here,
  base: './',
  build: {
    outDir: resolve(here, '../out-browser'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { input: resolve(here, 'index.html') },
  },
});
