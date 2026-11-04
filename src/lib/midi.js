/**
 * midi.js
 * ---------------------------------------------------------------------------
 * A minimal Standard MIDI File (format 1) writer — no dependencies.
 *
 * Produces a five-track file:
 *   track 0 — tempo, time signature, song name, section markers
 *   track 1 — chords  (channel 1)
 *   track 2 — bass    (channel 2)
 *   track 3 — melody  (channel 3)
 *   track 4 — drums   (channel 10, General MIDI percussion map)
 *
 * The note data comes from arrange.js — the same arrangement the browser plays
 * — so the exported file is what you auditioned, groove and all, rather than a
 * pile of root-position triads.
 *
 * Each track also carries a General MIDI program change, a channel volume and a
 * pan position. Without those every melodic track defaults to program 0,
 * Acoustic Grand Piano — so the bass, the guitar and the vocal line all come
 * out as three pianos piled on top of each other, which is the single biggest
 * reason an exported file sounds worse than what you heard in the browser.
 */

import { clampTempo } from './musicTheory.js';
import { arrange } from './arrange.js';
import { STEPS_PER_BEAT, stepToBeats } from './groove.js';

const PPQ = 480; // ticks per quarter note

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

/** MIDI variable-length quantity. */
function vlq(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

const u32 = (n) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const ascii = (s) => Array.from(String(s)).map((c) => c.charCodeAt(0) & 0x7f);

/** Wrap event bytes in an MTrk chunk, appending End-of-Track. */
function trackChunk(eventBytes) {
  const body = [...eventBytes, 0x00, 0xff, 0x2f, 0x00];
  return [...ascii('MTrk'), ...u32(body.length), ...body];
}

/** Meta text event (0x01 text, 0x03 track name, 0x06 marker). */
function metaText(type, text) {
  const data = ascii(text).slice(0, 127);
  return [0xff, type, ...vlq(data.length), ...data];
}

/** @param {{tick:number, bytes:number[], order?:number}[]} events */
function encodeEvents(events) {
  const sorted = [...events].sort(
    (a, b) => a.tick - b.tick || (a.order ?? 0) - (b.order ?? 0),
  );
  const out = [];
  let last = 0;
  for (const ev of sorted) {
    out.push(...vlq(ev.tick - last), ...ev.bytes);
    last = ev.tick;
  }
  return out;
}

const noteOn = (ch, note, vel) => [0x90 | (ch & 0x0f), note & 0x7f, vel & 0x7f];
const noteOff = (ch, note) => [0x80 | (ch & 0x0f), note & 0x7f, 0x40];
const programChange = (ch, program) => [0xc0 | (ch & 0x0f), program & 0x7f];
const controlChange = (ch, cc, value) => [0xb0 | (ch & 0x0f), cc & 0x7f, value & 0x7f];

// ---------------------------------------------------------------------------
// Track layout
// ---------------------------------------------------------------------------

/** voice -> { track index, MIDI channel }. Channel 9 is GM percussion. */
/**
 * Our instrument ids -> General MIDI programs.
 *
 * GM is a crude palette, but it is what every player and DAW understands, and
 * a roughly right instrument beats a piano standing in for everything.
 */
const GM_CHORD_PROGRAM = {
  piano: 0,         // Acoustic Grand Piano
  pad: 89,          // Pad 2 (warm)
  electric: 4,      // Electric Piano 1
  guitarClean: 27,  // Electric Guitar (clean)
  guitarAcoustic: 25, // Acoustic Guitar (steel)
  guitarCrunch: 29, // Overdriven Guitar
  guitarPower: 30,  // Distortion Guitar
};

const GM_BASS_PROGRAM = {
  electric: 33,     // Electric Bass (finger)
  picked: 34,       // Electric Bass (pick)
  synth: 38,        // Synth Bass 1
  upright: 32,      // Acoustic Bass
};

/**
 * The melody track is a vocal line. GM's own "Voice Oohs" is mushy on fast
 * phrases in most soundfonts, so a flute stands in: it is clean, present in
 * every bank, and reads unambiguously as the tune.
 */
const GM_MELODY_PROGRAM = 73; // Flute

/**
 * Default mix, as channel volume (CC7) and pan (CC10).
 *
 * Velocity alone cannot balance parts across players, and a little stereo
 * spread stops the chords and the melody fighting in the middle.
 */
const CHANNEL_MIX = {
  chord: { volume: 92, pan: 54 },
  bass: { volume: 108, pan: 64 },
  lead: { volume: 112, pan: 74 },
  drums: { volume: 100, pan: 64 },
};

const VOICE_TRACK = {
  chord: { track: 0, channel: 0 },
  bass: { track: 1, channel: 1 },
  lead: { track: 2, channel: 2 },
  kick: { track: 3, channel: 9 },
  snare: { track: 3, channel: 9 },
  hat: { track: 3, channel: 9 },
  crash: { track: 3, channel: 9 },
};

const TRACK_NAMES = ['Chords', 'Bass', 'Melody', 'Drums'];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a MIDI file for a song.
 *
 * @param {object} song  normalised Song object
 * @param {object} [opts]
 * @param {boolean} [opts.includeMelody=true]
 * @param {boolean} [opts.includeChords=true]
 * @param {boolean} [opts.includeDrums=true]
 * @param {string}  [opts.grooveId='none'] which groove's rhythm to render
 * @param {string}  [opts.instrument]     chord instrument, for the GM program
 * @param {string}  [opts.bassInstrument] bass instrument, for the GM program
 * @param {string}  [opts.bassStyle]
 * @param {string}  [opts.compStyle]
 * @param {string}  [opts.voicing]        'keyboard' | 'guitar' | 'power'
 * @returns {Uint8Array}
 */
export function songToMidi(song, {
  includeMelody = true,
  includeChords = true,
  includeDrums = true,
  grooveId = 'none',
  instrument = 'piano',
  bassInstrument = 'electric',
  bassStyle = 'auto',
  compStyle = 'auto',
  voicing = 'keyboard',
} = {}) {
  const tempo = clampTempo(song?.tempo ?? 100);
  const sections = Array.isArray(song?.sections) ? song.sections : [];

  const { events, swing } = arrange({
    sections,
    key: song?.key || 'C major',
    grooveId,
    chords: includeChords,
    melody: includeMelody,
    drums: includeDrums,
    metronome: false,
    bassStyle,
    compStyle,
    genre: song?.genre || '',
    mood: song?.mood || '',
    tempo,
    voicing,
    // MIDI always carries the groove's chord rhythm: in a DAW you will assign a
    // real instrument, so the pad's "hold everything" behaviour is a limitation
    // of in-browser playback, not something worth baking into the file.
    sustainChords: false,
  });

  // Steps -> ticks, with the same swing the browser applies.
  const toTicks = (step) => Math.round(stepToBeats(step, swing) * PPQ);

  // --- track 0: tempo map and section markers -----------------------------
  const microsPerQuarter = Math.round(60_000_000 / tempo);
  const conductor = [
    { tick: 0, bytes: metaText(0x03, song?.title || 'Earworm Song') },
    {
      tick: 0,
      bytes: [
        0xff, 0x51, 0x03,
        (microsPerQuarter >> 16) & 0xff,
        (microsPerQuarter >> 8) & 0xff,
        microsPerQuarter & 0xff,
      ],
    },
    // 4/4, 24 MIDI clocks per metronome click, 8 32nds per quarter.
    { tick: 0, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] },
  ];

  let cursorSteps = 0;
  for (const section of sections) {
    const bars = (section.chords || []).length;
    if (!bars) continue;
    conductor.push({
      tick: toTicks(cursorSteps),
      bytes: metaText(0x06, section.label || section.type || 'Section'),
    });
    cursorSteps += bars * 4 * STEPS_PER_BEAT;
  }

  // --- note tracks ---------------------------------------------------------
  // Each opens with its GM program, channel volume and pan, so the file plays
  // with the right instruments and a sane balance anywhere, not just in a DAW
  // where someone reassigns everything by hand.
  const chordProgram = GM_CHORD_PROGRAM[instrument] ?? GM_CHORD_PROGRAM.piano;
  const bassProgram = bassInstrument === 'follow'
    // "Follow the instrument" means the chord instrument plays the bass too, so
    // the nearest honest GM equivalent is that same program.
    ? chordProgram
    : (GM_BASS_PROGRAM[bassInstrument] ?? GM_BASS_PROGRAM.electric);

  const TRACK_SETUP = [
    { channel: 0, program: chordProgram, mix: CHANNEL_MIX.chord },
    { channel: 1, program: bassProgram, mix: CHANNEL_MIX.bass },
    { channel: 2, program: GM_MELODY_PROGRAM, mix: CHANNEL_MIX.lead },
    // Channel 10 is percussion by definition; a program change there selects a
    // drum kit rather than an instrument, so 0 (Standard Kit) is correct.
    { channel: 9, program: 0, mix: CHANNEL_MIX.drums },
  ];

  const noteTracks = TRACK_NAMES.map((name, i) => {
    const setup = TRACK_SETUP[i];
    return [
      { tick: 0, bytes: metaText(0x03, name), order: -3 },
      { tick: 0, bytes: programChange(setup.channel, setup.program), order: -2 },
      { tick: 0, bytes: controlChange(setup.channel, 7, setup.mix.volume), order: -1 },
      { tick: 0, bytes: controlChange(setup.channel, 10, setup.mix.pan), order: -1 },
    ];
  });

  for (const ev of events) {
    const route = VOICE_TRACK[ev.voice];
    if (!route) continue; // 'click' never goes into the file

    const start = toTicks(ev.step);
    // Percussion is a one-shot: a short, fixed gate reads correctly everywhere.
    const isDrum = route.channel === 9;
    const end = isDrum
      ? start + 30
      : Math.max(start + 20, toTicks(ev.step + ev.duration) - 4);

    noteTracks[route.track].push({
      tick: start,
      bytes: noteOn(route.channel, ev.midi, ev.velocity),
      order: 1,
    });
    noteTracks[route.track].push({
      tick: end,
      bytes: noteOff(route.channel, ev.midi),
      order: 0,
    });
  }

  const tracks = [
    trackChunk(encodeEvents(conductor)),
    ...noteTracks.map((t) => trackChunk(encodeEvents(t))),
  ];

  const header = [
    ...ascii('MThd'),
    ...u32(6),
    ...u16(1),             // format 1
    ...u16(tracks.length),
    ...u16(PPQ),
  ];

  return new Uint8Array([...header, ...tracks.flat()]);
}

