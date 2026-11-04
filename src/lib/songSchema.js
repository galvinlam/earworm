/**
 * songSchema.js
 * ---------------------------------------------------------------------------
 * Turns whatever the model actually returned into a Song object the rest of
 * the app can trust.
 *
 * Models drift from a schema in predictable ways, so we repair rather than
 * reject: code fences, a prose preamble, lyrics as an array of lines, chords
 * as one comma-separated string, a contour of numbers instead of strings.
 * Only genuinely unusable output throws.
 */

import { LLMError } from './llmClient.js';
import { clampTempo, parseChord } from './musicTheory.js';

const SECTION_TYPES = [
  'Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus',
  'Bridge', 'Hook', 'Refrain', 'Instrumental', 'Solo', 'Outro',
];

let idCounter = 0;
/** Stable-enough unique id for React keys and section targeting. */
export function makeId(prefix = 'sec') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Pull the first complete JSON object out of a string, tolerating code fences
 * and surrounding prose. Brace-counting is quote- and escape-aware so braces
 * inside lyrics don't break it.
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;

  let s = text.trim();

  // Strip a markdown fence if the whole response is wrapped in one.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1].trim();

  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }

  // Unterminated object (a truncated stream). Return what we have so the
  // repair pass below can try to close it.
  return s.slice(start);
}

/**
 * Last-ditch repair for malformed JSON.
 *
 * Handles the three things models actually get wrong:
 *  1. Raw newlines/tabs inside a string literal — very common with lyrics,
 *     since the model is writing multi-line text into a JSON field.
 *  2. Trailing commas and smart quotes used as delimiters.
 *  3. Truncation, when a stream is cut off mid-object.
 */
function repairJson(raw) {
  const pre = raw.replace(/[“”]/g, '"').trim();

  // Single pass: escape control characters inside strings, track nesting.
  let out = '';
  let inString = false;
  let escaped = false;
  const stack = [];

  for (const ch of pre) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === '\\') { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      // Escape anything JSON forbids raw inside a string.
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch >= ' ') out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
    out += ch;
  }

  if (inString) out += '"';
  while (stack.length) {
    out += stack.pop() === '{' ? '}' : ']';
  }

  // Safe now: every in-string comma is inside an escaped-separator literal.
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** Parse model text into a plain object, repairing where possible. */
export function parseModelJson(text) {
  const candidate = extractJsonObject(text);
  if (!candidate) {
    throw new LLMError('parse', 'The model did not return JSON.', {
      advice: 'Turn on "Force JSON mode" in Settings, or try a model that follows schemas more closely.',
    });
  }
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(repairJson(candidate));
    } catch (err) {
      throw new LLMError('parse', 'The model returned malformed JSON.', {
        advice: 'Retry — this usually succeeds on a second attempt. Lowering temperature in Settings helps too.',
        cause: err,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

function asString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.filter((v) => v != null).map(String).join('\n');
  return fallback;
}

/** Lyrics may arrive as a string, an array of lines, or an array of objects. */
function normaliseLyrics(value) {
  if (Array.isArray(value)) {
    return value
      .map((line) => (typeof line === 'string' ? line : asString(line?.text ?? line?.line ?? '')))
      .join('\n');
  }
  return asString(value)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Chords may arrive as an array, a "C | G | Am | F" string, or nested bars. */
function normaliseChords(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value.flatMap((c) => {
      if (typeof c === 'string') return c.split(/[|,]/);
      if (c && typeof c === 'object') return [asString(c.chord ?? c.name ?? c.symbol)];
      return [asString(c)];
    });
  } else if (typeof value === 'string') {
    list = value.split(/[|,\s]+/);
  }
  return list.map((c) => String(c).trim()).filter(Boolean).slice(0, 64);
}

/** Contour entries become strings; junk is dropped, rests preserved as 'r'. */
function normaliseContour(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(/[,\s]+/);
  else if (typeof value === 'number') list = [value];

  return list
    .map((v) => {
      if (v === null || v === undefined) return 'r';
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'r';
      const s = String(v).trim();
      return s || 'r';
    })
    .filter((s) => s.length <= 6)
    .slice(0, 64);
}

/** Infer a section type from its label when the model omitted or invented one. */
function normaliseType(type, label) {
  const haystack = `${type || ''} ${label || ''}`.toLowerCase();
  const found = SECTION_TYPES.find((t) => haystack.includes(t.toLowerCase()));
  if (found) return found;
  if (/\bpre[- ]?chorus\b/.test(haystack)) return 'Pre-Chorus';
  if (/\b[ab]\s*section\b/.test(haystack)) return haystack.includes('b') ? 'Bridge' : 'Verse';
  if (/\bpart\b/.test(haystack)) return 'Verse';
  return asString(type, 'Verse') || 'Verse';
}

/**
 * Normalise one section object.
 * @param {object} raw
 * @param {number} index position in the song, used for default labels
 */
export function normaliseSection(raw, index = 0, existingId) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const label = asString(source.label ?? source.name ?? source.section, '') || `Section ${index + 1}`;
  const type = normaliseType(source.type, label);
  const chords = normaliseChords(source.chords ?? source.chordProgression ?? source.progression);

  return {
    id: existingId || makeId(),
    type,
    label,
    lyrics: normaliseLyrics(source.lyrics ?? source.text ?? source.content),
    chords,
    melodyContour: normaliseContour(source.melodyContour ?? source.melody ?? source.contour),
    performanceNote: asString(source.performanceNote ?? source.note ?? source.notes, '').slice(0, 400),
    locked: Boolean(source.locked),
    // Flag chords the parser could not fully understand so the UI can mark them.
    unknownChords: chords.filter((c) => !parseChord(c).valid),
  };
}

/**
 * Normalise a whole song response into the canonical Song shape.
 *
 * @param {object} raw parsed JSON from the model
 * @param {object} form the request form, used for sensible fallbacks
 * @returns {object} Song
 */
export function normaliseSong(raw, form = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // Some models wrap everything in a top-level "song" key.
  const root = source.song && typeof source.song === 'object' ? source.song : source;

  const rawSections = Array.isArray(root.sections)
    ? root.sections
    : Array.isArray(root.structure)
      ? root.structure
      : [];

  const sections = rawSections.map((s, i) => normaliseSection(s, i));

  if (!sections.length) {
    throw new LLMError('parse', 'The model returned a song with no sections.', {
      advice: 'Retry, or pick a more capable model in Settings.',
    });
  }

  return {
    id: makeId('song'),
    title: asString(root.title, '').trim() || 'Untitled',
    key: asString(root.key, '').trim() || form.key || 'C major',
    tempo: clampTempo(root.tempo ?? form.tempo ?? 100),
    genre: asString(root.genre, '').trim() || form.genre || '',
    mood: asString(root.mood, '').trim() || form.mood || '',
    structure: form.structure || '',
    idea: form.idea || '',
    sections,
    createdAt: Date.now(),
  };
}

/** Count bars across the whole song — shown in the header. */
export function totalBars(song) {
  return song?.sections?.reduce((sum, s) => sum + (s.chords?.length || 0), 0) ?? 0;
}

/** Rough word count of all lyrics. */
export function totalWords(song) {
  return (
    song?.sections?.reduce(
      (sum, s) => sum + (s.lyrics ? s.lyrics.trim().split(/\s+/).filter(Boolean).length : 0),
      0,
    ) ?? 0
  );
}
