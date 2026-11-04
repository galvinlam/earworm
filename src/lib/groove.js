/**
 * groove.js
 * ---------------------------------------------------------------------------
 * Rhythm: what the drums, bass and comping instrument play, bar by bar.
 *
 * A groove is a set of 16-step grids — one bar of sixteenth notes. Written as
 * strings so a pattern is readable and checkable at a glance:
 *
 *   step:   0   4   8   12
 *   kick:  'X.......x.......'   X = accent, x = normal, . = rest
 *   snare: '....X.......X...'
 *
 * The bass grid uses chord-tone roles instead of velocities, so one pattern
 * works over any progression:
 *
 *   R root   T third   F fifth   O root an octave up   A approach the next root
 *
 * Nothing here makes sound or touches Tone.js. arrange.js turns a song plus a
 * groove into a flat list of events; the audio engine and the MIDI exporter
 * both render that same list, which is what keeps playback and export in sync.
 */

import { parseChord } from './musicTheory.js';

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;

/**
 * @typedef {object} Groove
 * @property {string} label
 * @property {number} swing     0 = straight, ~0.3 = a jazz triplet feel
 * @property {string} kick
 * @property {string} snare
 * @property {string} hat
 * @property {string} comp      when the chord instrument re-attacks
 * @property {string} bass      chord-tone roles
 * @property {boolean} [crashOnSection]  accent the first bar of each section
 */

/** @type {Record<string, Groove>} */
export const GROOVES = {
  none: {
    label: 'None — sustained',
    hint: 'No drums. Chords hold for the whole bar and the bass plays roots. The original behaviour.',
    swing: 0,
    kick:  '................',
    snare: '................',
    hat:   '................',
    comp:  'x...............',
    bass:  'R...............',
  },

  pop: {
    label: 'Pop',
    hint: 'Kick on 1 and 3, backbeat snare, eighth-note hats.',
    swing: 0,
    kick:  'X.......x.......',
    snare: '....X.......X...',
    hat:   'x.x.x.x.x.x.x.x.',
    comp:  'x.......x.......',
    bass:  'R.......R...F...',
    crashOnSection: true,
  },

  rock: {
    label: 'Rock',
    hint: 'Driving quarter-note chords, busier kick, hard backbeat.',
    swing: 0,
    kick:  'X.......X..x....',
    snare: '....X.......X...',
    hat:   'x.x.x.x.x.x.x.x.',
    comp:  'x...x...x...x...',
    bass:  'R...R...R...R...',
    crashOnSection: true,
  },

  ballad: {
    label: 'Ballad',
    hint: 'Half-time. One kick, a snare on 3, almost no hats. Lots of space.',
    swing: 0,
    kick:  'X...............',
    snare: '........X.......',
    hat:   '....x.......x...',
    comp:  'x...............',
    bass:  'R.......F.......',
  },

  folk: {
    label: 'Folk / brushes',
    hint: 'Light and strummed. Soft offbeat hats, brushed snare, no heavy kick.',
    swing: 0,
    kick:  'X.......x.......',
    snare: '....x.......x...',
    hat:   '..x...x...x...x.',
    comp:  'x...x...x...x...',
    bass:  'R.......F.......',
  },

  hiphop: {
    label: 'Hip-hop / lo-fi',
    hint: 'Swung sixteenths, syncopated kick, laid-back backbeat.',
    swing: 0.18,
    kick:  'X.....x.....x...',
    snare: '....X.......X...',
    hat:   'x.x.x.xxx.x.x.x.',
    comp:  'x.......x.......',
    bass:  'R.....R.....R...',
  },

  fourfloor: {
    label: 'Four on the floor',
    hint: 'Kick every beat, offbeat hats, chord stabs between the beats.',
    swing: 0,
    kick:  'X...X...X...X...',
    snare: '....x.......x...',
    hat:   '..x...x...x...x.',
    comp:  '..x...x...x...x.',
    bass:  'R...R...R...R...',
    crashOnSection: true,
  },

  shuffle: {
    label: 'Jazz shuffle',
    hint: 'Swung ride, comping on 2 and 4, walking bass that approaches the next chord.',
    swing: 0.3,
    kick:  'X...............',
    snare: '............x...',
    hat:   'x.x.x.x.x.x.x.x.',
    comp:  '....x.......x...',
    bass:  'R...T...F...A...',
  },

  reggae: {
    label: 'Reggae one-drop',
    hint: 'Nothing on 1 — kick and snare land together on 3, chords skank on the offbeats.',
    swing: 0,
    kick:  '........X.......',
    snare: '........x.......',
    hat:   '..x...x...x...x.',
    comp:  '..x...x...x...x.',
    bass:  'R.....R.F.......',
  },
};

/** Genre -> the groove a player would reach for. */
const GENRE_GROOVE = {
  Pop: 'pop',
  Rock: 'rock',
  Punk: 'rock',
  Metal: 'rock',
  'Indie Folk': 'folk',
  Country: 'folk',
  'R&B': 'hiphop',
  'Hip-Hop': 'hiphop',
  'Lo-fi': 'hiphop',
  Soul: 'pop',
  Electronic: 'fourfloor',
  Jazz: 'shuffle',
  Reggae: 'reggae',
  Musical: 'ballad',
  Ambient: 'none',
};

/**
 * Pick a groove for a genre and tempo.
 *
 * Tempo overrides genre at the extremes: a 58 BPM pop song is a ballad whatever
 * the genre field says, and nothing sounds right with a backbeat at 190.
 */
export function grooveForGenre(genre, tempo = 100) {
  const named = GENRE_GROOVE[genre]
    || GENRE_GROOVE[Object.keys(GENRE_GROOVE).find((g) => g.toLowerCase() === String(genre || '').toLowerCase())];

  if (tempo <= 68 && named !== 'reggae') return 'ballad';
  return named || 'pop';
}

/** Resolve the groove id to use, honouring an explicit choice over 'auto'. */
export function resolveGroove(setting, genre, tempo) {
  if (setting && setting !== 'auto' && GROOVES[setting]) return setting;
  return grooveForGenre(genre, tempo);
}

// ---------------------------------------------------------------------------
// Grid reading
// ---------------------------------------------------------------------------

/**
 * Read a velocity grid into hits.
 * @returns {{step:number, accent:boolean}[]}
 */
export function readGrid(pattern) {
  const hits = [];
  const grid = String(pattern || '');
  for (let step = 0; step < STEPS_PER_BAR; step += 1) {
    const ch = grid[step];
    if (!ch || ch === '.' || ch === ' ') continue;
    hits.push({ step, accent: ch === 'X' });
  }
  return hits;
}

/**
 * Read a bass grid into role hits.
 * @returns {{step:number, role:string}[]}
 */
export function readBassGrid(pattern) {
  const hits = [];
  const grid = String(pattern || '');
  for (let step = 0; step < STEPS_PER_BAR; step += 1) {
    const ch = grid[step];
    if (!ch || ch === '.' || ch === ' ') continue;
    hits.push({ step, role: ch.toUpperCase() });
  }
  return hits;
}

/**
 * Convert a step index to a position in beats, applying swing.
 *
 * Swing delays the second eighth of each pair — steps 2, 6, 10, 14 — which is
 * what turns a straight grid into a shuffle. Applied here rather than in the
 * players so audio and MIDI swing identically.
 *
 * @param {number} step absolute step index (sixteenths from the start)
 * @param {number} swing 0..0.4
 * @returns {number} position in beats
 */
export function stepToBeats(step, swing = 0) {
  const offbeatEighth = ((step % STEPS_PER_BEAT) + STEPS_PER_BEAT) % STEPS_PER_BEAT === 2;
  const nudge = offbeatEighth ? swing : 0;
  return (step + nudge * 2) / STEPS_PER_BEAT;
}

// ---------------------------------------------------------------------------
// Bass roles
// ---------------------------------------------------------------------------

/** Find the interval closest to `want` semitones in a chord's interval list. */
function pickInterval(intervals, want, fallback) {
  let best = null;
  let bestDist = Infinity;
  for (const i of intervals) {
    const semis = i % 12;
    const dist = Math.abs(semis - want);
    if (dist < bestDist) { bestDist = dist; best = semis; }
  }
  return bestDist <= 2 ? best : fallback;
}

/**
 * Resolve a bass role to a MIDI note.
 *
 * Candidates are every octave of the target pitch class inside the bass
 * register; we pick the one nearest the previous note, with a pull toward a
 * home register so a long progression wanders instead of climbing.
 *
 * @param {string} symbol chord symbol
 * @param {string} role R | T | F | O | A
 * @param {number|null} previousMidi
 * @param {string|null} nextSymbol needed for the A (approach) role
 */
export function bassNoteForRole(symbol, role, previousMidi = null, nextSymbol = null, opts = {}) {
  const { low = 34, high = 50, center = 41 } = opts;
  const { rootPc, bassPc, intervals } = parseChord(symbol);
  const base = bassPc === null ? rootPc : bassPc;

  let pc;
  let octaveShift = 0;

  switch (role) {
    case 'T':
      pc = (rootPc + pickInterval(intervals, 4, 4)) % 12;
      break;
    case 'F':
      pc = (rootPc + pickInterval(intervals, 7, 7)) % 12;
      break;
    case 'O':
      pc = base;
      octaveShift = 12;
      break;
    case 'A': {
      // Approach the next chord's root from a semitone or whole tone below.
      const nextRoot = nextSymbol ? parseChord(nextSymbol).rootPc : null;
      pc = nextRoot === null ? (rootPc + 7) % 12 : (nextRoot + 11) % 12;
      break;
    }
    case 'R':
    default:
      pc = base;
      break;
  }

  const options = [];
  for (let n = low; n <= high; n += 1) {
    if (((n % 12) + 12) % 12 === pc) options.push(n + octaveShift);
  }
  if (!options.length) return 36 + (pc % 12) + octaveShift;

  const target = previousMidi ?? center;
  const cost = (n) => Math.abs(n - target) + Math.abs(n - center) * 0.5;
  return options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

// ---------------------------------------------------------------------------
// Part styles
// ---------------------------------------------------------------------------

/**
 * Bass patterns you can pick independently of the groove.
 *
 * The groove ships a bass line that suits it, which is what "Follow the groove"
 * uses. These let you cut against it — a walking bass under a rock backbeat, or
 * dead-simple roots under a busy shuffle — which is usually how a part stops
 * sounding like a preset.
 *
 * Roles: R root  T third  F fifth  O root an octave up  A approach the next root
 */
export const BASS_STYLES = {
  auto:      { label: 'Auto', grid: null, hint: 'Chosen from the genre and mood.' },
  whole:     { label: 'Whole notes',     grid: 'R...............', hint: 'One note a bar. Gets out of the way.' },
  halves:    { label: 'Half notes',      grid: 'R.......R.......', hint: 'Steady without pushing.' },
  quarters:  { label: 'Quarter notes',   grid: 'R...R...R...R...', hint: 'Driving. The rock default.' },
  rootFifth: { label: 'Root and fifth',  grid: 'R...F...R...F...', hint: 'Country and folk. Implies the chord without crowding it.' },
  octaves:   { label: 'Octaves',         grid: 'R...O...R...O...', hint: 'Disco and synth-pop lift.' },
  eighths:   { label: 'Pumping eighths', grid: 'R.R.R.R.R.R.R.R.', hint: 'Punk and new wave. Relentless on purpose.' },
  walking:   { label: 'Walking',         grid: 'R...T...F...A...', hint: 'Jazz. Steps chromatically into the next chord.' },
  syncopated:{ label: 'Syncopated',      grid: 'R.....R...R.....', hint: 'Funk and reggae. Leaves holes for the drums.' },
};

/**
 * Chord rhythms you can pick independently of the groove.
 *
 * `arpeggio` is not a rhythm but a different way of playing: instead of
 * sounding the whole chord, it walks up and down the voicing one note per
 * step. arrange.js handles it separately for that reason.
 */
export const COMP_STYLES = {
  auto:       { label: 'Auto', grid: null, hint: 'Chosen from the genre and mood.' },
  sustain:    { label: 'Sustained',       grid: 'x...............', hint: 'Hold the chord for the bar. Pads and ballads.' },
  quarters:   { label: 'Quarters',        grid: 'x...x...x...x...', hint: 'One strum a beat. Steady and plain.' },
  eighths:    { label: 'Eighths',         grid: 'x.x.x.x.x.x.x.x.', hint: 'Driving rhythm guitar.' },
  strum:      { label: 'Strum pattern',   grid: 'x...x.x...x.x.x.', hint: 'Down, down-up, up-down-up. The campfire pattern.' },
  offbeats:   { label: 'Offbeat stabs',   grid: '..x...x...x...x.', hint: 'Reggae skank and disco.' },
  syncopated: { label: 'Syncopated',      grid: 'x.....x...x.....', hint: 'Pushes ahead of the beat. Funk and soul.' },
  arpeggio:   { label: 'Arpeggio',        grid: 'x.x.x.x.x.x.x.x.', arpeggio: true, hint: 'Picks through the chord one note at a time.' },
};

/** Resolve a style choice to a grid, falling back to the groove's own. */
export function resolveBassGrid(styleId, groove) {
  const style = BASS_STYLES[styleId];
  return style?.grid ?? groove.bass;
}

export function resolveCompGrid(styleId, groove) {
  const style = COMP_STYLES[styleId];
  return style?.grid ?? groove.comp;
}

/** Is this comp style an arpeggio rather than a block chord? */
export function isArpeggio(styleId) {
  return Boolean(COMP_STYLES[styleId]?.arpeggio);
}

// ---------------------------------------------------------------------------
// Section dynamics
// ---------------------------------------------------------------------------

/**
 * How hard each section should push.
 *
 * A real band does not play a verse the way it plays a chorus, and the single
 * biggest reason loop-based playback sounds mechanical is that every section
 * gets the same bar. A verse sits at the written pattern; a chorus fills in; an
 * intro or an outro thins out.
 *
 * Anything not listed sits at the written pattern, so an unlabelled section is
 * never silently altered.
 */
const SECTION_ENERGY = {
  Intro: 0.35,
  Verse: 0.65,
  'Pre-Chorus': 0.8,
  Chorus: 1,
  'Post-Chorus': 0.95,
  Hook: 1,
  Refrain: 0.9,
  Bridge: 0.6,
  Instrumental: 0.7,
  Solo: 0.9,
  Outro: 0.4,
};

/** 'sparse' | 'normal' | 'full' for a section type. */
export function sectionDensity(type, label = '') {
  const key = Object.keys(SECTION_ENERGY).find(
    (k) => k.toLowerCase() === String(type || '').toLowerCase(),
  );
  // A "Final Chorus" should be the biggest thing in the song.
  const isFinal = /final|last/i.test(label);
  const energy = key ? SECTION_ENERGY[key] : 0.7;
  const adjusted = isFinal ? Math.min(1, energy + 0.15) : energy;

  if (adjusted <= 0.5) return 'sparse';
  if (adjusted >= 0.9) return 'full';
  return 'normal';
}

/**
 * Thin a grid for an intro or an outro.
 *
 * The step a part may keep depends on what the part is for. Halving everything
 * uniformly deletes the backbeat — a snare lives on 2 and 4, neither of which
 * survives a "keep every half note" rule — and a section with no snare at all
 * reads as broken rather than sparse.
 *
 * @param {string} grid
 * @param {'kick'|'snare'|'hat'|'comp'|'bass'} kind
 */
function thinGrid(grid, kind) {
  // The snare is the pulse: thin it to beats, never below.
  const stride = kind === 'snare' ? STEPS_PER_BEAT : STEPS_PER_BEAT * 2;
  return [...String(grid).padEnd(STEPS_PER_BAR, '.')]
    .map((ch, i) => (ch === '.' || i % stride !== 0 ? '.' : ch))
    .join('');
}

/**
 * Fill a grid in, by adding a subdivision after each existing hit.
 *
 * Used for choruses. Adding subdivisions rather than new downbeats keeps the
 * pattern's identity — it is the same part, played harder.
 *
 * @param {string} grid
 * @param {number} gap      steps after each hit to add one (2 = eighth, 1 = sixteenth)
 * @param {string} [added]  character for the added hits; '=' means "repeat
 *   whatever the hit before it was", which is how bass roles stay in key
 */
function fillGrid(grid, gap, added = 'x') {
  const source = String(grid).padEnd(STEPS_PER_BAR, '.');
  const out = [...source];
  for (let i = 0; i < STEPS_PER_BAR; i += 1) {
    // Read from the source, not the output, so added hits do not themselves
    // spawn more hits and run the whole bar solid.
    if (source[i] === '.') continue;
    const j = i + gap;
    if (j < STEPS_PER_BAR && out[j] === '.') {
      out[j] = added === '=' ? source[i] : added;
    }
  }
  return out.join('');
}

/** Does every eighth-note position already carry a hit? */
function eighthsFull(grid) {
  const g = String(grid).padEnd(STEPS_PER_BAR, '.');
  for (let i = 0; i < STEPS_PER_BAR; i += 2) if (g[i] === '.') return false;
  return true;
}

/**
 * Apply a section's density to one part.
 *
 * Each part grows differently, because each does a different job:
 *
 *   kick, snare  — the skeleton of the groove. Left alone in a chorus;
 *                  extra kicks muddy the low end, and the backbeat is the
 *                  backbeat. Thinned in an intro, but the snare keeps its
 *                  beats so the pulse survives.
 *   hat          — where a chorus lift mostly lives. Goes to eighths, or to
 *                  sixteenths if it is already on eighths.
 *   comp, bass   — one extra eighth per hit. The bass repeats its role, so
 *                  the added notes stay inside the chord.
 *
 * @param {string} grid
 * @param {'sparse'|'normal'|'full'} density
 * @param {'kick'|'snare'|'hat'|'comp'|'bass'} kind
 */
export function applyDensity(grid, density, kind) {
  if (density === 'normal' || !grid) return grid;
  if (density === 'sparse') return thinGrid(grid, kind);

  switch (kind) {
    case 'kick':
    case 'snare':
      return grid;
    case 'hat':
      return fillGrid(grid, eighthsFull(grid) ? 1 : 2);
    case 'bass':
      return fillGrid(grid, 2, '=');
    default:
      return fillGrid(grid, 2);
  }
}

/**
 * A turnaround on the last bar of a section.
 *
 * Players mark the seam between sections — a fill, a walk into the next chord.
 * Without it an eight-bar loop just stops and starts again.
 *
 * @param {string} grid
 * @param {'snare'|'bass'} kind
 */
export function applyTurnaround(grid, kind) {
  const out = [...String(grid).padEnd(STEPS_PER_BAR, '.')];
  // A part that is not playing does not get a fill: a groove with no snare
  // (the sustained "none" groove) must stay drumless at section ends too.
  if (!out.some((ch) => ch !== '.')) return grid;
  if (kind === 'snare') {
    // A short fill across the last beat.
    out[12] = out[12] === '.' ? 'x' : out[12];
    out[13] = 'x';
    out[14] = 'X';
    out[15] = 'x';
  } else {
    // Walk into the next chord's root on the last beat.
    out[12] = 'A';
    if (out[14] === '.') out[14] = 'A';
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Genre and mood -> parts
// ---------------------------------------------------------------------------

/**
 * Which parts suit a genre. These are the starting point; mood then nudges them.
 *
 * `signature` names the parts that define the genre and must survive whatever
 * the mood asks for. A weary jazz tune is still a walking bass; a wistful folk
 * song is still strummed. Without this, mood overrides flatten every genre into
 * the same handful of patterns, which is the opposite of what they are for.
 *
 * @type {Record<string, {bass: string, comp: string, signature?: string[],
 *                        instrument?: string, bassInstrument?: string}>}
 */
const GENRE_PARTS = {
  Pop:           { bass: 'quarters',  comp: 'quarters', instrument: 'piano',        bassInstrument: 'electric' },
  Rock:          { bass: 'quarters',  comp: 'eighths',  instrument: 'guitarCrunch', bassInstrument: 'picked' },
  Punk:          { bass: 'eighths',   comp: 'eighths',  signature: ['bass', 'comp'], instrument: 'guitarPower',  bassInstrument: 'picked' },
  Metal:         { bass: 'eighths',   comp: 'eighths',  instrument: 'guitarPower',  bassInstrument: 'picked' },
  'Indie Folk':  { bass: 'rootFifth', comp: 'strum',    signature: ['comp'], instrument: 'guitarAcoustic', bassInstrument: 'electric' },
  Country:       { bass: 'rootFifth', comp: 'strum',    signature: ['comp'], instrument: 'guitarAcoustic', bassInstrument: 'upright' },
  'R&B':         { bass: 'syncopated', comp: 'syncopated', instrument: 'electric',  bassInstrument: 'electric' },
  'Hip-Hop':     { bass: 'syncopated', comp: 'sustain', signature: ['bass'], instrument: 'electric',     bassInstrument: 'synth' },
  'Lo-fi':       { bass: 'halves',    comp: 'arpeggio', instrument: 'electric',     bassInstrument: 'electric' },
  Soul:          { bass: 'syncopated', comp: 'offbeats', instrument: 'electric',    bassInstrument: 'electric' },
  Electronic:    { bass: 'octaves',   comp: 'offbeats', signature: ['comp'], instrument: 'pad',          bassInstrument: 'synth' },
  Jazz:          { bass: 'walking',   comp: 'syncopated', signature: ['bass', 'comp'], instrument: 'piano',      bassInstrument: 'upright' },
  Reggae:        { bass: 'syncopated', comp: 'offbeats', signature: ['bass', 'comp'], instrument: 'guitarClean', bassInstrument: 'electric' },
  Ambient:       { bass: 'whole',     comp: 'sustain',  instrument: 'pad',          bassInstrument: 'synth' },
  Musical:       { bass: 'halves',    comp: 'arpeggio', instrument: 'piano',        bassInstrument: 'upright' },
};

const GENERIC_PARTS = { bass: 'quarters', comp: 'quarters', instrument: 'piano', bassInstrument: 'electric' };

/**
 * How a mood pushes the parts around.
 *
 * `drive` moves toward busier patterns, `calm` toward sparser ones, and some
 * moods swap the chord rhythm outright — a tender song wants an arpeggio
 * whatever its genre says.
 */
const MOOD_PARTS = {
  Euphoric:   { drive: 1, comp: 'eighths' },
  Triumphant: { drive: 1 },
  Defiant:    { drive: 1 },
  Restless:   { drive: 1, bass: 'eighths' },
  Playful:    { drive: 0 },
  Hopeful:    { drive: 0 },
  Tender:     { drive: -1, comp: 'arpeggio' },
  Wistful:    { drive: -1 },
  Melancholy: { drive: -1, comp: 'sustain' },
  Weary:      { drive: -1, bass: 'halves' },
  Numb:       { drive: -1, comp: 'sustain', bass: 'whole' },
  Menacing:   { drive: 0, bass: 'syncopated', comp: 'syncopated' },
};

/** Bass patterns ordered by how hard they push, for mood nudging. */
const BASS_BY_DRIVE = ['whole', 'halves', 'rootFifth', 'quarters', 'octaves', 'syncopated', 'eighths'];
const COMP_BY_DRIVE = ['sustain', 'quarters', 'strum', 'offbeats', 'syncopated', 'eighths'];

function nudge(ladder, current, drive) {
  const i = ladder.indexOf(current);
  if (i === -1 || !drive) return current;
  return ladder[Math.min(ladder.length - 1, Math.max(0, i + drive))];
}

/**
 * Pick the whole backing for a song from its genre, mood and tempo.
 *
 * This is what "Auto" now means: a folk song and a punk song no longer get the
 * same bass line because they happen to share a groove, and a tender pop song
 * arpeggiates where a defiant one drives.
 *
 * @returns {{grooveId:string, bassStyle:string, compStyle:string,
 *            instrument:string, bassInstrument:string}}
 */
export function partsForSong(genre, mood, tempo = 100) {
  const key = Object.keys(GENRE_PARTS).find(
    (g) => g.toLowerCase() === String(genre || '').toLowerCase(),
  );
  const base = key ? GENRE_PARTS[key] : GENERIC_PARTS;

  const moodKey = Object.keys(MOOD_PARTS).find(
    (m) => m.toLowerCase() === String(mood || '').toLowerCase(),
  );
  const feel = moodKey ? MOOD_PARTS[moodKey] : { drive: 0 };

  const signature = base.signature || [];
  const bassLocked = signature.includes('bass');
  const compLocked = signature.includes('comp');

  // A locked part ignores the mood entirely — both its override and its drive.
  let bass = bassLocked ? base.bass : (feel.bass ?? base.bass);
  let comp = compLocked ? base.comp : (feel.comp ?? base.comp);
  if (!bassLocked) bass = nudge(BASS_BY_DRIVE, bass, feel.drive ?? 0);
  if (!compLocked) comp = nudge(COMP_BY_DRIVE, comp, feel.drive ?? 0);

  // A ballad tempo overrides an enthusiastic mood: nothing drives at 58 BPM.
  if (tempo <= 68) {
    if (!bassLocked) bass = nudge(BASS_BY_DRIVE, bass, -1);
    if (!compLocked) comp = nudge(COMP_BY_DRIVE, comp, -1);
  }

  return {
    grooveId: grooveForGenre(genre, tempo),
    bassStyle: bass,
    compStyle: comp,
    instrument: base.instrument || GENERIC_PARTS.instrument,
    bassInstrument: base.bassInstrument || GENERIC_PARTS.bassInstrument,
  };
}

/** Resolve a bass style, where 'auto' now means "from genre and mood". */
export function resolveBassStyle(setting, genre, mood, tempo) {
  if (setting && setting !== 'auto' && BASS_STYLES[setting]) return setting;
  return partsForSong(genre, mood, tempo).bassStyle;
}

export function resolveCompStyle(setting, genre, mood, tempo) {
  if (setting && setting !== 'auto' && COMP_STYLES[setting]) return setting;
  return partsForSong(genre, mood, tempo).compStyle;
}
