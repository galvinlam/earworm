/**
 * useSettingsStore.js
 * ---------------------------------------------------------------------------
 * API connection settings and audio preferences.
 *
 * Persisted to localStorage. The API key never leaves the browser except in
 * the Authorization header of requests the user's own session makes.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Models offered in the picker before we have asked the endpoint. */
/**
 * Shown in the picker before we have asked the endpoint for its own list.
 *
 * Free line-ups churn — slugs get retired without notice — so treat this as a
 * starting guess, not a source of truth. Press Test in Settings and the app
 * replaces it with what your key can actually reach. If a saved slug dies
 * mid-session, the app finds a live free one and switches by itself.
 */
export const SUGGESTED_MODELS = [
  // OpenRouter free tier (verified live November 2026)
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'openrouter/free',
  // Paid, and better at lyrics than anything free
  'gpt-4o-mini',
  'gpt-4o',
  // NVIDIA NIM direct (needs `npm run proxy`)
  'nvidia/nemotron-3-ultra-550b-a55b',
  // Groq / Cerebras
  'llama-3.3-70b-versatile',
  // Gemini free tier
  'gemini-2.0-flash',
  // Local via Ollama
  'llama3.2',
];

/**
 * Endpoint presets.
 *
 * `browser` is the thing that actually decides whether a provider works here.
 * Earworm calls the API straight from the page, so the provider has to send
 * CORS headers; plenty of inference APIs do not, and no amount of correct key
 * or model id gets around it.
 *
 *   'ok'      — known to work from a browser
 *   'flag'    — works once you enable cross-origin access on your own server
 *   'proxy'   — the provider blocks browsers; run tools/cors-proxy.mjs
 *   'unknown' — not verified; press Test in Settings and find out in a second
 *
 * These notes were accurate when written and providers change them without
 * warning, so Test is always the arbiter rather than this table.
 */
export const PRESET_ENDPOINTS = [
  {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    browser: 'ok',
    free: true,
    note: 'Many models behind one key, including free ones (ids ending in :free). Commonly used from browsers.',
  },
  {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1',
    browser: 'ok',
    note: 'Paid. gpt-4o-mini is cheap and writes well.',
  },
  {
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1',
    browser: 'unknown',
    free: true,
    note: 'Generous free tier and very fast. Press Test to check it reaches your browser.',
  },
  {
    label: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    browser: 'unknown',
    free: true,
    note: 'Google AI Studio keys, OpenAI-compatible path. Free tier available.',
  },
  {
    label: 'Cerebras',
    url: 'https://api.cerebras.ai/v1',
    browser: 'unknown',
    free: true,
    note: 'Free tier, very fast inference.',
  },
  {
    label: 'NVIDIA NIM',
    url: 'https://integrate.api.nvidia.com/v1',
    browser: 'proxy',
    free: true,
    note: 'Nemotron and others, free. NVIDIA does not send CORS headers, so a browser cannot call it directly — run the bundled proxy and point here at http://localhost:8787/v1.',
  },
  {
    label: 'Ollama (local)',
    url: 'http://localhost:11434/v1',
    browser: 'flag',
    free: true,
    note: 'Runs models on your own machine. Start it with OLLAMA_ORIGINS=* so the page is allowed to call it.',
  },
  {
    label: 'LM Studio (local)',
    url: 'http://localhost:1234/v1',
    browser: 'flag',
    free: true,
    note: 'Local server with a CORS toggle in its settings — turn it on.',
  },
  {
    label: 'CORS proxy (local)',
    url: 'http://localhost:8787/v1',
    browser: 'ok',
    note: 'Whatever tools/cors-proxy.mjs is pointed at. Use this for NVIDIA NIM and anything else that blocks browsers.',
  },
];

const env = import.meta.env ?? {};

const defaults = {
  apiKey: env.VITE_OPENAI_API_KEY || '',
  // Defaults aimed at free use: OpenRouter is the one free route that works
  // from a browser with no proxy, and its free model ids are discoverable.
  baseUrl: env.VITE_DEFAULT_BASE_URL || 'https://openrouter.ai/api/v1',
  model: env.VITE_DEFAULT_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
  temperature: 0.9,
  jsonMode: true,
  streaming: true,
  volumeDb: -6,
  playbackMode: 'both', // 'chords' | 'melody' | 'both'
  instrument: 'pad',    // see INSTRUMENTS in lib/audioEngine.js
  drumKit: 'machine',   // see DRUM_KITS in lib/audioEngine.js ('off' for none)
  bassInstrument: 'electric', // see BASS_INSTRUMENTS in lib/audioEngine.js
  bassStyle: 'auto',    // 'auto' follows the groove; see BASS_STYLES
  compStyle: 'auto',    // 'auto' follows the groove; see COMP_STYLES
  groove: 'auto',       // 'auto' picks from genre + tempo; see lib/groove.js
  metronome: false,
  drumLevelDb: -4,
  discoveredModels: [],
  // Some providers cap completions low enough to truncate a whole song.
  maxTokens: 4000,
  // Narrow the model picker to ids a free tier will actually serve.
  freeOnly: true,
};

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      ...defaults,

      set: (patch) => set(patch),

      /** True once the user can actually make a request. */
      isConfigured: () => {
        const { apiKey, baseUrl, model } = get();
        const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl || '');
        return Boolean(baseUrl && model && (apiKey || local));
      },

      setDiscoveredModels: (models) => set({ discoveredModels: models }),

      resetSettings: () => set({ ...defaults }),
    }),
    {
      name: 'earworm-settings-v1',
      version: 1,
      // Discovered models are re-fetched on demand; no need to persist them.
      partialize: ({ discoveredModels, ...rest }) => rest,
    },
  ),
);
