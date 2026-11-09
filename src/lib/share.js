/**
 * share.js
 * ---------------------------------------------------------------------------
 * Read-only share links. The whole song is packed into the URL fragment, so
 * nothing is ever uploaded anywhere — the link itself is the payload.
 *
 * Wire format:  #s=<prefix><base64url>
 *   prefix 'z' — deflate-raw compressed JSON (modern browsers)
 *   prefix 'p' — plain JSON (fallback)
 *
 * Field names are shortened before encoding, which roughly halves the link.
 *
 * A link can also carry the sound it was made with — instrument, bass, kit,
 * groove and parts — so the person opening it hears the same arrangement
 * rather than whatever their own settings happen to be. Older links have no
 * sound and open exactly as before.
 */

import { makeId } from './songSchema.js';

// ---------------------------------------------------------------------------
// base64url <-> bytes
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunk = 0x8000; // avoid blowing the argument limit on big arrays
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// Compact representation
// ---------------------------------------------------------------------------

/** Sound fields, and their short names on the wire. */
const SOUND_KEYS = {
  instrument: 'i',
  bassInstrument: 'bi',
  drumKit: 'd',
  groove: 'gr',
  bassStyle: 'bs',
  compStyle: 'cs',
};

function packSound(sound) {
  if (!sound) return undefined;
  const out = {};
  for (const [key, short] of Object.entries(SOUND_KEYS)) {
    if (typeof sound[key] === 'string' && sound[key]) out[short] = sound[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Names only, unchecked against the instrument tables: this module stays free
 * of the audio engine, so whoever applies the sound decides what is valid.
 */
function unpackSound(data) {
  if (!data || typeof data !== 'object') return null;
  const out = {};
  for (const [key, short] of Object.entries(SOUND_KEYS)) {
    if (typeof data[short] === 'string' && data[short].length <= 40) out[key] = data[short];
  }
  return Object.keys(out).length ? out : null;
}

function pack(song, sound) {
  return {
    a: packSound(sound),
    t: song.title,
    k: song.key,
    b: song.tempo,
    g: song.genre,
    m: song.mood,
    s: (song.sections || []).map((sec) => ({
      y: sec.type,
      l: sec.label,
      x: sec.lyrics,
      c: sec.chords,
      v: sec.melodyContour,
      n: sec.performanceNote || undefined,
    })),
  };
}

function unpack(data) {
  return {
    id: makeId('song'),
    title: data.t || 'Untitled',
    key: data.k || 'C major',
    tempo: Number(data.b) || 100,
    genre: data.g || '',
    mood: data.m || '',
    structure: '',
    idea: '',
    sections: (Array.isArray(data.s) ? data.s : []).map((sec) => ({
      id: makeId(),
      type: sec.y || 'Verse',
      label: sec.l || sec.y || 'Section',
      lyrics: sec.x || '',
      chords: Array.isArray(sec.c) ? sec.c : [],
      melodyContour: Array.isArray(sec.v) ? sec.v : [],
      performanceNote: sec.n || '',
      locked: false,
      unknownChords: [],
    })),
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a song into the fragment payload (without the leading "#s=").
 * @param {object} [sound]  instrument, bassInstrument, drumKit, groove, bassStyle, compStyle
 */
export async function encodeSong(song, sound) {
  const json = JSON.stringify(pack(song, sound));
  const bytes = new TextEncoder().encode(json);
  const compressed = await deflate(bytes).catch(() => null);
  return compressed && compressed.length < bytes.length
    ? `z${bytesToBase64Url(compressed)}`
    : `p${bytesToBase64Url(bytes)}`;
}

/** Full shareable URL for the current page. */
export async function buildShareUrl(song, sound) {
  const payload = await encodeSong(song, sound);
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#s=${payload}`;
}

/** Decode a payload back into a song, or null if it is unusable. */
export async function decodeSong(payload) {
  return (await decodeShare(payload))?.song ?? null;
}

/**
 * Decode a payload into the song and the sound it was shared with.
 * @returns {Promise<{song: object, sound: object|null}|null>}
 */
export async function decodeShare(payload) {
  if (!payload || payload.length < 2) return null;
  try {
    const prefix = payload[0];
    const bytes = base64UrlToBytes(payload.slice(1));
    let jsonBytes = bytes;
    if (prefix === 'z') {
      jsonBytes = await inflate(bytes);
      if (!jsonBytes) return null;
    } else if (prefix !== 'p') {
      return null;
    }
    const data = JSON.parse(new TextDecoder().decode(jsonBytes));
    const song = unpack(data);
    return song.sections.length ? { song, sound: unpackSound(data.a) } : null;
  } catch {
    return null;
  }
}

/** Read a shared song out of the current URL fragment, if present. */
export async function readSongFromUrl() {
  return (await readShareFromUrl())?.song ?? null;
}

/** The shared song and its sound, out of the current URL fragment. */
export async function readShareFromUrl() {
  const hash = window.location.hash || '';
  const match = /[#&]s=([^&]+)/.exec(hash);
  if (!match) return null;
  return decodeShare(match[1]);
}

/** Remove the share payload from the address bar without reloading. */
export function clearShareFromUrl() {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
