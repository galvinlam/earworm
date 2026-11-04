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

function pack(song) {
  return {
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

/** Encode a song into the fragment payload (without the leading "#s="). */
export async function encodeSong(song) {
  const json = JSON.stringify(pack(song));
  const bytes = new TextEncoder().encode(json);
  const compressed = await deflate(bytes).catch(() => null);
  return compressed && compressed.length < bytes.length
    ? `z${bytesToBase64Url(compressed)}`
    : `p${bytesToBase64Url(bytes)}`;
}

/** Full shareable URL for the current page. */
export async function buildShareUrl(song) {
  const payload = await encodeSong(song);
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#s=${payload}`;
}

/** Decode a payload back into a song, or null if it is unusable. */
export async function decodeSong(payload) {
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
    return song.sections.length ? song : null;
  } catch {
    return null;
  }
}

/** Read a shared song out of the current URL fragment, if present. */
export async function readSongFromUrl() {
  const hash = window.location.hash || '';
  const match = /[#&]s=([^&]+)/.exec(hash);
  if (!match) return null;
  return decodeSong(match[1]);
}

/** Remove the share payload from the address bar without reloading. */
export function clearShareFromUrl() {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
