/**
 * guitar.js
 * ---------------------------------------------------------------------------
 * Derives a playable guitar voicing for a chord symbol.
 *
 * Two sources, in order:
 *   1. A table of standard open-position shapes (these look and sound right,
 *      and they are what a player would actually reach for).
 *   2. Movable barre shapes rooted on the low E or A string, transposed to the
 *      chord's root. We pick whichever lands at the lower fret.
 *
 * Returns null when the quality has no shape in the table, which the UI treats
 * as "no diagram available" rather than inventing something unplayable.
 */

import { parseChord } from './musicTheory.js';

/** Frets per string, low E first. -1 means muted, 0 means open. */
const OPEN_SHAPES = {
  C: [-1, 3, 2, 0, 1, 0],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  C7: [-1, 3, 2, 3, 1, 0],
  Cadd9: [-1, 3, 2, 0, 3, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  D7: [-1, -1, 0, 2, 1, 2],
  Dm7: [-1, -1, 0, 2, 1, 1],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Dsus4: [-1, -1, 0, 2, 3, 3],
  Dsus2: [-1, -1, 0, 2, 3, 0],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  E7: [0, 2, 0, 1, 0, 0],
  Em7: [0, 2, 0, 0, 0, 0],
  Emaj7: [0, 2, 1, 1, 0, 0],
  Esus4: [0, 2, 2, 2, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  G7: [3, 2, 0, 0, 0, 1],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  Gsus4: [3, 3, 0, 0, 1, 3],
  A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  Am7: [-1, 0, 2, 0, 1, 0],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  Asus4: [-1, 0, 2, 2, 3, 0],
  Asus2: [-1, 0, 2, 2, 0, 0],
  B7: [-1, 2, 1, 2, 0, 2],
  Bm: [-1, 2, 4, 4, 3, 2],
};

/** Movable shapes, expressed as offsets from the barre fret. */
const E_SHAPES = {
  '': [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  7: [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  6: [0, 2, 2, 1, 2, 0],
  m6: [0, 2, 2, 0, 2, 0],
  add9: [0, 2, 2, 1, 0, 2],
  aug: [0, 3, 2, 1, 1, 0],
  m7b5: [0, 1, 0, 2, 0, -1],
  9: [0, -1, 0, 1, 0, 2],
};

const A_SHAPES = {
  '': [-1, 0, 2, 2, 2, 0],
  m: [-1, 0, 2, 2, 1, 0],
  7: [-1, 0, 2, 0, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
  sus4: [-1, 0, 2, 2, 3, 0],
  sus2: [-1, 0, 2, 2, 0, 0],
  6: [-1, 0, 2, 2, 2, 2],
  m6: [-1, 0, 2, 2, 1, 2],
  add9: [-1, 0, 2, 4, 2, 0],
  dim: [-1, 0, 1, 2, 1, -1],
  dim7: [-1, 0, 1, 2, 1, 2],
  m7b5: [-1, 0, 1, 2, 1, 0],
  aug: [-1, 0, 3, 2, 2, 1],
  9: [-1, 0, 2, 1, 2, 2],
};

/** Map parsed chord qualities onto the shape keys above. */
const QUALITY_ALIAS = {
  '': '', maj: '', M: '',
  m: 'm', min: 'm', '-': 'm',
  7: '7', dom7: '7',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7',
  sus: 'sus4', sus4: 'sus4', sus2: 'sus2',
  6: '6', m6: 'm6', min6: 'm6',
  add9: 'add9', add2: 'add9',
  9: '9', maj9: 'maj7', m9: 'm7',
  dim: 'dim', o: 'dim', dim7: 'dim7', o7: 'dim7',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', min7b5: 'm7b5',
  aug: 'aug', '+': 'aug',
  '7sus4': 'sus4', '7sus': 'sus4',
  5: '', 11: '9', 13: '9',
};

const E_STRING_PC = 4; // open low E
const A_STRING_PC = 9; // open A

/**
 * @returns {{frets:number[], baseFret:number, barre:number|null, name:string}|null}
 */
export function guitarVoicing(symbol) {
  const parsed = parseChord(symbol);
  if (!parsed.symbol) return null;

  // Ignore slash bass for the diagram — the shape is what matters here.
  const plain = parsed.symbol.replace(/\s+/g, '').split('/')[0];
  if (OPEN_SHAPES[plain]) {
    return { frets: OPEN_SHAPES[plain], baseFret: 1, barre: null, name: plain };
  }

  const shapeKey = QUALITY_ALIAS[parsed.quality];
  if (shapeKey === undefined) return null;

  const candidates = [];
  const eShape = E_SHAPES[shapeKey];
  if (eShape) {
    const fret = ((parsed.rootPc - E_STRING_PC) % 12 + 12) % 12;
    candidates.push({ fret, shape: eShape, barreFrom: 0 });
  }
  const aShape = A_SHAPES[shapeKey];
  if (aShape) {
    const fret = ((parsed.rootPc - A_STRING_PC) % 12 + 12) % 12;
    candidates.push({ fret, shape: aShape, barreFrom: 1 });
  }
  if (!candidates.length) return null;

  // Prefer the lower position; a fret-0 barre shape is just the open chord.
  candidates.sort((a, b) => a.fret - b.fret);
  const best = candidates[0];

  const frets = best.shape.map((offset) => (offset < 0 ? -1 : offset + best.fret));
  const sounded = frets.filter((f) => f > 0);
  const minFret = sounded.length ? Math.min(...sounded) : 1;

  return {
    frets,
    // Diagrams show 5 frets; shift the window up when the shape sits high.
    baseFret: minFret > 3 ? minFret : 1,
    barre: best.fret > 0 ? best.fret : null,
    name: parsed.symbol,
  };
}

// ---------------------------------------------------------------------------
// Fretboard -> pitch
// ---------------------------------------------------------------------------

/** Open-string MIDI notes in standard tuning, low E to high E. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

/**
 * A chord symbol as the MIDI notes a guitar would actually sound.
 *
 * This is why a guitar instrument sounds like a guitar rather than a piano
 * playing a guitar patch: the voicing comes from a real fingering, so you get
 * open strings ringing, doubled octaves, and the wide low-to-high spread a
 * six-string gives you — none of which a close-position keyboard voicing has.
 *
 * @returns {number[]|null} ascending MIDI notes, or null if no shape is known
 */
export function guitarVoicingMidi(symbol) {
  const voicing = guitarVoicing(symbol);
  if (!voicing) return null;
  const notes = voicing.frets
    .map((fret, string) => (fret < 0 ? null : STANDARD_TUNING[string] + fret))
    .filter((n) => n !== null);
  return notes.length ? notes : null;
}

/**
 * The lowest two or three strings only — a power chord.
 *
 * Root, fifth, and the root an octave up. Quality is deliberately ignored:
 * that is the whole point of a power chord, and it is why distorted guitar
 * uses them (thirds turn to mud through heavy gain).
 */
export function powerChordMidi(symbol, { low = 40, high = 59 } = {}) {
  const { rootPc } = parseChord(symbol);
  let root = low + (((rootPc - low) % 12) + 12) % 12;
  while (root + 12 > high && root - 12 >= low) root -= 12;
  return [root, root + 7, root + 12];
}
