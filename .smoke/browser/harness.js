/** Exposes the renderer to Playwright so the audio path can be tested for real. */
import { renderSongToWav } from '../../src/lib/render.js';
import { INSTRUMENTS, BASS_INSTRUMENTS } from '../../src/lib/audioEngine.js';
import { grooveForGenre } from '../../src/lib/groove.js';

window.__renderSongToWav = renderSongToWav;
window.__instruments = { INSTRUMENTS, BASS_INSTRUMENTS };
window.__tone = () => import('tone');
window.__grooveForGenre = grooveForGenre;
window.__ready = true;
