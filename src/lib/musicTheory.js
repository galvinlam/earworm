/**
 * musicTheory.js
 * ---------------------------------------------------------------------------
 * Zero-dependency music helpers: key handling, chord-symbol parsing, and
 * scale-degree -> pitch resolution.
 *
 * Everything here is pure, so it is easy to reason about and test. The audio
 * engine and the MIDI exporter both consume the same functions, which keeps
 * what you hear and what you export in sync.
 */

// ---------------------------------------------------------------------------
// Pitch classes
// ---------------------------------------------------------------------------

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Letter -> natural pitch class. */
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Convert a note name ("Bb", "F#", "C4") to a pitch class 0-11.
 * Returns null when the name cannot be understood.
 */
export function noteToPitchClass(name) {
  if (typeof name !== 'string') return null;
  const m = /^([A-Ga-g])([#b♯♭x]*)/.exec(name.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') pc += 1;
    else if (ch === 'b' || ch === '♭') pc -= 1;
    else if (ch === 'x') pc += 2;
  }
  return ((pc % 12) + 12) % 12;
}

/** Pitch class -> name, spelled with sharps or flats. */
export function pitchClassToNote(pc, preferFlats = false) {
  const i = ((pc % 12) + 12) % 12;
  return preferFlats ? FLAT_NAMES[i] : SHARP_NAMES[i];
}

/** "C4" -> MIDI number 60. Returns null if unparseable. */
export function noteToMidi(name) {
  if (typeof name !== 'string') return null;
  const m = /^([A-Ga-g][#b♯♭x]*)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const pc = noteToPitchClass(m[1]);
  if (pc === null) return null;
  return (parseInt(m[2], 10) + 1) * 12 + pc;
}

/** MIDI number -> "C4". */
export function midiToNote(midi, preferFlats = false) {
  const octave = Math.floor(midi / 12) - 1;
  return `${pitchClassToNote(midi % 12, preferFlats)}${octave}`;
}

// ---------------------------------------------------------------------------
// Keys and scales
// ---------------------------------------------------------------------------

/** Keys whose signature is written with flats (used to pick enharmonic spelling). */
const FLAT_KEYS = new Set([
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'D minor', 'G minor', 'C minor', 'F minor', 'Bb minor', 'Eb minor', 'Ab minor',
]);

export const SCALE_FORMULAS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

/** Every key offered in the UI dropdown. */
export const KEY_OPTIONS = [
  'C major', 'G major', 'D major', 'A major', 'E major', 'B major',
  'F# major', 'F major', 'Bb major', 'Eb major', 'Ab major', 'Db major',
  'A minor', 'E minor', 'B minor', 'F# minor', 'C# minor', 'G# minor',
  'D minor', 'G minor', 'C minor', 'F minor', 'Bb minor', 'Eb minor',
];

/**
 * Split "Bb minor" into { tonic: 'Bb', mode: 'minor' }.
 * Falls back to C major rather than throwing — the LLM occasionally returns
 * something odd and silence is better than a crash.
 */
export function parseKey(key) {
  const fallback = { tonic: 'C', mode: 'major', raw: 'C major' };
  if (typeof key !== 'string' || !key.trim()) return fallback;
  const m = /^([A-Ga-g][#b♯♭]?)\s*(.*)$/.exec(key.trim());
  if (!m) return fallback;
  const tonic = m[1][0].toUpperCase() + m[1].slice(1).replace('♯', '#').replace('♭', 'b');
  const rest = (m[2] || '').toLowerCase();
  let mode = 'major';
  if (rest.startsWith('min') || rest === 'm' || rest.includes('minor') || rest.includes('aeolian')) mode = 'minor';
  else if (rest.includes('dorian')) mode = 'dorian';
  else if (rest.includes('mixo')) mode = 'mixolydian';
  else if (rest.includes('harmonic')) mode = 'harmonicMinor';
  return { tonic, mode, raw: key.trim() };
}

/** Should this key be spelled with flats? */
export function keyPrefersFlats(key) {
  const { tonic, mode } = parseKey(key);
  if (tonic.includes('b')) return true;
  if (tonic.includes('#')) return false;
  return FLAT_KEYS.has(tonic) || FLAT_KEYS.has(`${tonic} ${mode}`);
}

/**
 * The seven pitch classes of a key, in order from the tonic.
 * @returns {number[]} pitch classes
 */
export function scalePitchClasses(key) {
  const { tonic, mode } = parseKey(key);
  const root = noteToPitchClass(tonic) ?? 0;
  const formula = SCALE_FORMULAS[mode] || SCALE_FORMULAS.major;
  return formula.map((semi) => (root + semi) % 12);
}

// ---------------------------------------------------------------------------
// Chord symbols
// ---------------------------------------------------------------------------

/**
 * Suffix -> semitone intervals above the root.
 * Ordered longest-first at match time so "maj7" wins over "m".
 */
const CHORD_QUALITIES = {
  '': [0, 4, 7],
  'maj': [0, 4, 7],
  'M': [0, 4, 7],
  '5': [0, 7],
  'm': [0, 3, 7],
  'min': [0, 3, 7],
  '-': [0, 3, 7],
  'dim': [0, 3, 6],
  'o': [0, 3, 6],
  'dim7': [0, 3, 6, 9],
  'o7': [0, 3, 6, 9],
  'm7b5': [0, 3, 6, 10],
  'min7b5': [0, 3, 6, 10],
  'ø': [0, 3, 6, 10],
  'ø7': [0, 3, 6, 10],
  'aug': [0, 4, 8],
  '+': [0, 4, 8],
  '6': [0, 4, 7, 9],
  'm6': [0, 3, 7, 9],
  'min6': [0, 3, 7, 9],
  '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10],
  'dom7': [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'M7': [0, 4, 7, 11],
  'Δ': [0, 4, 7, 11],
  'Δ7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
  'min7': [0, 3, 7, 10],
  '-7': [0, 3, 7, 10],
  'mmaj7': [0, 3, 7, 11],
  'mM7': [0, 3, 7, 11],
  '9': [0, 4, 7, 10, 14],
  'maj9': [0, 4, 7, 11, 14],
  'M9': [0, 4, 7, 11, 14],
  'm9': [0, 3, 7, 10, 14],
  'min9': [0, 3, 7, 10, 14],
  'add9': [0, 4, 7, 14],
  'add2': [0, 2, 4, 7],
  'madd9': [0, 3, 7, 14],
  '11': [0, 7, 10, 14, 17],
  'm11': [0, 3, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  'maj13': [0, 4, 7, 11, 14, 21],
  'sus': [0, 5, 7],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '7sus': [0, 5, 7, 10],
  '9sus4': [0, 5, 7, 10, 14],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
  '7#5': [0, 4, 8, 10],
  '7b5': [0, 4, 6, 10],
  '7#11': [0, 4, 7, 10, 18],
};

// Longest suffix first so greedy matching is correct.
const QUALITY_KEYS = Object.keys(CHORD_QUALITIES).sort((a, b) => b.length - a.length);

/**
 * Parse a chord symbol such as "F#m7b5", "Cmaj7/G", "Bb sus4".
 *
 * @returns {{ symbol: string, rootPc: number, bassPc: number|null,
 *             intervals: number[], quality: string, valid: boolean }}
 */
export function parseChord(symbol) {
  const raw = String(symbol ?? '').trim();
  const invalid = {
    symbol: raw,
    rootPc: 0,
    bassPc: null,
    intervals: [0, 4, 7],
    quality: '',
    valid: false,
  };
  if (!raw) return invalid;

  // Normalise unicode accidentals and strip inner whitespace ("C maj7" -> "Cmaj7").
  const cleaned = raw.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');

  const [chordPart, bassPart] = cleaned.split('/');
  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(chordPart);
  if (!rootMatch) return invalid;

  const rootPc = noteToPitchClass(rootMatch[1]);
  if (rootPc === null) return invalid;

  const suffix = rootMatch[2];
  // Exact match first, then case-insensitive, then greedy prefix.
  let quality = QUALITY_KEYS.find((k) => k === suffix);
  if (quality === undefined) {
    quality = QUALITY_KEYS.find((k) => k.toLowerCase() === suffix.toLowerCase());
  }
  if (quality === undefined) {
    quality = QUALITY_KEYS.find((k) => k.length > 0 && suffix.toLowerCase().startsWith(k.toLowerCase()));
  }

  const known = quality !== undefined;
  const intervals = CHORD_QUALITIES[known ? quality : ''] || [0, 4, 7];
  const bassPc = bassPart ? noteToPitchClass(bassPart) : null;

  return {
    symbol: raw,
    rootPc,
    bassPc: bassPc === null ? null : bassPc,
    intervals,
    quality: known ? quality : '',
    // A bare root with an unrecognised tail still plays as a triad, but we flag
    // it so the UI can show a subtle warning dot.
    valid: known || suffix === '',
  };
}

// ---------------------------------------------------------------------------
// Melody contours
// ---------------------------------------------------------------------------

const REST_TOKENS = new Set(['r', 'rest', '-', '_', '.', '']);

/**
 * Resolve one melody-contour token into a note name.
 *
 * Accepts, in order of preference:
 *   - scale degrees:        "1", "5", "b3", "#4", "7"
 *   - octave markers:       "1^" / "1'" (up an octave), "5v" / "5," (down)
 *   - extended degrees:     "8" .. "14" (second octave of the scale)
 *   - absolute note names:  "C4", "Eb5", "F#"
 *   - rests:                "r", "-", null
 *
 * @returns {string|null} note name, or null for a rest / unparseable token
 */
export function contourTokenToNote(token, key, baseOctave = 4) {
  if (token === null || token === undefined) return null;

  const flats = keyPrefersFlats(key);
  const scale = scalePitchClasses(key);
  const tonicPc = scale[0];

  // Numbers come through JSON as actual numbers quite often.
  let t = String(token).trim();
  if (REST_TOKENS.has(t.toLowerCase())) return null;

  // Absolute note with an octave digit, e.g. "Eb5".
  //
  // "b7" is deliberately NOT treated as "note B, octave 7" — in a melody
  // contour a lowercase leading "b" means a flattened scale degree far more
  // often than it means a note in the 7th octave. Any other letter, an
  // uppercase letter, or an explicit accidental resolves as an absolute note.
  const abs = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/.exec(t);
  if (abs) {
    const ambiguousFlat = abs[1] === 'b' && abs[2] === '';
    if (!ambiguousFlat) {
      const midi = noteToMidi(t);
      if (midi !== null) return midiToNote(midi, flats);
    }
  }

  // Octave shift suffix / prefix.
  let octaveShift = 0;
  t = t.replace(/[\^']+/g, (m) => { octaveShift += m.length; return ''; });
  t = t.replace(/[v,]+/g, (m) => { octaveShift -= m.length; return ''; });
  t = t.trim();

  // Scale degree, optionally altered.
  const deg = /^([#b♯♭]?)(\d{1,2})$/.exec(t);
  if (deg) {
    let alter = 0;
    if (deg[1] === '#' || deg[1] === '♯') alter = 1;
    if (deg[1] === 'b' || deg[1] === '♭') alter = -1;

    const n = parseInt(deg[2], 10);
    if (n < 1 || n > 21) return null;
    const index = (n - 1) % 7;
    const extraOctave = Math.floor((n - 1) / 7);

    const pc = scale[index];
    // Keep the melody ascending within the octave rather than wrapping to the
    // bottom: degrees below the tonic's pitch class belong to the next octave.
    const relative = (pc - tonicPc + 12) % 12;
    const midi =
      (baseOctave + 1) * 12 + tonicPc + relative + alter + 12 * (extraOctave + octaveShift);
    return midiToNote(midi, flats);
  }

  // Bare note letter with no octave, e.g. "F#" — place it near the base octave.
  const pcOnly = noteToPitchClass(t);
  if (pcOnly !== null && /^[A-Ga-g][#b♯♭]?$/.test(t)) {
    return midiToNote((baseOctave + 1) * 12 + pcOnly + 12 * octaveShift, flats);
  }

  return null;
}

/**
 * Convert a whole melodyContour array into note names (nulls are rests).
 */
export function contourToNotes(contour, key, baseOctave = 4) {
  if (!Array.isArray(contour)) return [];
  return contour.map((tok) => contourTokenToNote(tok, key, baseOctave));
}

/** Clamp a tempo to something Tone.js and humans can both live with. */
export function clampTempo(bpm) {
  const n = Number(bpm);
  if (!Number.isFinite(n)) return 100;
  return Math.min(240, Math.max(40, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Voice leading
// ---------------------------------------------------------------------------

/**
 * Choose a voicing for a chord that moves as little as possible from the
 * previous chord's voicing.
 *
 * Why this matters more than the synth patch: voicing every chord from its own
 * root means G -> Em -> C -> D lurches up and down the keyboard, which is the
 * main reason naive playback sounds mechanical. Real players keep common tones
 * where they are and move the other voices by a step or two. This picks, from
 * every inversion of the chord in a sensible register, whichever one is closest
 * to what was just sounding.
 *
 * @param {string} symbol chord symbol
 * @param {number[]|null} previousMidi the previous chord's MIDI notes
 * @param {object} [opts]
 * @param {number} [opts.center=58] preferred centre of the voicing, in MIDI
 * @param {number} [opts.low=48] lowest allowed note
 * @param {number} [opts.high=72] highest allowed note
 * @returns {number[]} MIDI notes, ascending
 */
export function voiceLeadChord(symbol, previousMidi = null, opts = {}) {
  const { center = 58, low = 48, high = 72 } = opts;
  const { rootPc, intervals } = parseChord(symbol);

  // Distinct pitch classes, root first.
  const pcs = [];
  for (const i of intervals) {
    const pc = (rootPc + i) % 12;
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  if (!pcs.length) return [];

  // Every rotation (inversion), stacked ascending, at every viable start note.
  const candidates = [];
  for (let rot = 0; rot < pcs.length; rot += 1) {
    const order = [...pcs.slice(rot), ...pcs.slice(rot === 0 ? pcs.length : 0, rot)];
    for (let start = low; start <= high; start += 1) {
      if (((start % 12) + 12) % 12 !== order[0]) continue;
      const notes = [start];
      let ok = true;
      for (let k = 1; k < order.length; k += 1) {
        let n = notes[notes.length - 1] + 1;
        while (((n % 12) + 12) % 12 !== order[k]) n += 1;
        if (n > high) { ok = false; break; }
        notes.push(n);
      }
      if (ok) candidates.push(notes);
    }
  }
  if (!candidates.length) {
    // Shouldn't happen, but never return nothing — fall back to a root voicing.
    return intervals.map((i) => 60 + rootPc + i);
  }

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const score = (notes) => {
    // Total distance each voice has to travel from the nearest previous voice.
    let movement = 0;
    if (previousMidi?.length) {
      for (const n of notes) {
        movement += Math.min(...previousMidi.map((p) => Math.abs(p - n)));
      }
      movement /= notes.length;
    }
    const registerPenalty = Math.abs(mean(notes) - center) * 0.45;
    // Discourage voicings spread so wide they stop sounding like one chord.
    const span = notes[notes.length - 1] - notes[0];
    const spanPenalty = Math.max(0, span - 16) * 0.8;
    return movement + registerPenalty + spanPenalty;
  };

  let best = candidates[0];
  let bestScore = score(best);
  for (const c of candidates.slice(1)) {
    const s = score(c);
    if (s < bestScore) { best = c; bestScore = s; }
  }
  return best;
}

/**
 * Bass note for a chord: the slash bass if given, otherwise the root, placed in
 * a low register and kept near the previous bass note so the line walks rather
 * than leaps an octave between chords.
 *
 * "Nearest to the previous note" alone makes the bass drift steadily upward
 * over a long progression, since each individual step looks cheap. The centre
 * bias pulls it back toward a home register, so it wanders without climbing.
 */
export function bassNoteFor(symbol, previousBassMidi = null, opts = {}) {
  const { low = 34, high = 50, center = 41 } = opts; // A#1..D3, centred on F2
  const { rootPc, bassPc } = parseChord(symbol);
  const pc = bassPc === null ? rootPc : bassPc;

  const options = [];
  for (let n = low; n <= high; n += 1) {
    if (((n % 12) + 12) % 12 === pc) options.push(n);
  }
  if (!options.length) return 36 + (pc % 12);

  const target = previousBassMidi ?? center;
  const cost = (n) => Math.abs(n - target) + Math.abs(n - center) * 0.5;
  return options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}
