/**
 * audioEngine.js
 * ---------------------------------------------------------------------------
 * A singleton wrapper around Tone.js.
 *
 * Tone is loaded lazily on first play, so the initial bundle stays small and
 * nothing touches the Web Audio API until the user clicks something (browsers
 * require a gesture before audio can start).
 *
 * This module does not decide what gets played — arrange.js does, producing a
 * flat list of note events. Here we only turn those events into sound. The MIDI
 * exporter renders the same list, which is what keeps playback and export from
 * drifting apart.
 *
 * Signal flow:
 *
 *   instrument (chord / bass / lead) ──► reverb bus ──┐
 *   drums ──► drum volume ──► (mostly dry) ───────────┼──► destination
 *   metronome click ──────────────────────────────────┘
 */

import { midiToNote, voiceLeadChord } from './musicTheory.js';
import { bassNoteForRole, stepToBeats } from './groove.js';
import { guitarVoicingMidi, powerChordMidi } from './guitar.js';
import { arrange } from './arrange.js';

// ---------------------------------------------------------------------------
// Pitched instruments
// ---------------------------------------------------------------------------

/**
 * Salamander Grand Piano, sampled in minor thirds and trimmed to the register
 * this app actually plays (bass A1 up to melody C6). The full set runs A0-C8;
 * dropping the octaves we never touch roughly halves the download.
 *
 * Keys are note names for Tone; values are filenames, which spell sharps "s".
 */
const PIANO_SAMPLES = {
  A1: 'A1.mp3',
  C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3', A2: 'A2.mp3',
  C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3', A3: 'A3.mp3',
  C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3',
  C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3',
  C6: 'C6.mp3',
};

const PIANO_BASE_URL = 'https://tonejs.github.io/audio/salamander/';

// ---------------------------------------------------------------------------
// Soundfont samples
// ---------------------------------------------------------------------------

/**
 * Guitars, basses and electric piano are recorded instruments from the Musyng
 * Kite General MIDI soundfont, as pre-rendered by gleitz/midi-js-soundfonts
 * (CC BY-SA 3.0). The synthesized versions they replaced are kept as stand-ins
 * for when the samples can't be fetched — offline before first use, or the host
 * is down — so the choice still plays, just with the old tone.
 *
 * Self-hosting: copy the `<instrument>-mp3/` folders you need and point
 * VITE_SAMPLE_BASE_URL at them.
 */
const SAMPLE_BASE_URL = String(
  import.meta.env?.VITE_SAMPLE_BASE_URL || 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/',
).replace(/\/?$/, '/');

/** Give up on a soundfont after this long and use the synth instead. */
const SAMPLE_TIMEOUT_MS = 15000;

/** A degraded rig is retried after this long, in case the network came back. */
const SAMPLE_RETRY_MS = 30000;

/*
 * One sample every minor third, so no note is pitch-shifted by more than a
 * semitone and a half — past about two the timbre starts to chipmunk. Files
 * spell accidentals as flats.
 */
const GUITAR_NOTES = ['E2', 'G2', 'Bb2', 'Db3', 'E3', 'G3', 'Bb3', 'Db4', 'E4', 'G4', 'Bb4', 'Db5', 'E5', 'G5', 'Bb5', 'Db6'];
const BASS_NOTES = ['E1', 'G1', 'Bb1', 'Db2', 'E2', 'G2', 'Bb2', 'Db3', 'E3', 'G3'];
const KEYS_NOTES = ['C2', 'Eb2', 'Gb2', 'A2', 'C3', 'Eb3', 'Gb3', 'A3', 'C4', 'Eb4', 'Gb4', 'A4', 'C5', 'Eb5', 'Gb5', 'A5', 'C6'];

/*
 * Decoded samples by URL. An AudioBuffer is not tied to the context that
 * decoded it, so a WAV export reuses what playback already fetched.
 */
const sampleCache = new Map();

function fetchSample(T, url) {
  if (!sampleCache.has(url)) {
    const pending = T.ToneAudioBuffer.fromUrl(url).catch(() => {
      sampleCache.delete(url); // let a later attempt try again
      return null;
    });
    sampleCache.set(url, pending);
  }
  return sampleCache.get(url);
}

/**
 * Fetch a set of samples, by name, without throwing.
 *
 * Each sampled instrument waits for its own files only. Tone.loaded() would be
 * simpler, but it waits on every download in flight — so a guitar sample that
 * failed would make a perfectly good piano report failure too.
 *
 * @returns {Promise<Record<string, object|null>|null>} null on timeout
 */
async function loadBuffers(T, urlsByName) {
  const entries = Object.entries(urlsByName);
  const all = Promise.all(entries.map(async ([name, url]) => [name, await fetchSample(T, url)]));

  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SAMPLE_TIMEOUT_MS); });
  const loaded = await Promise.race([all, timeout]);
  clearTimeout(timer);
  return loaded ? Object.fromEntries(loaded) : null;
}

/**
 * Fetch an instrument's samples, or resolve null if too few arrived.
 *
 * A few missing notes are tolerated — the sampler stretches its neighbours —
 * but not so many that whole octaves get pitch-shifted. The result feeds
 * `new Sampler({ urls })` directly, and can feed more than one: the buffers are
 * shared, not copied.
 */
async function loadNoteSet(T, urlsByNote) {
  const loaded = await loadBuffers(T, urlsByNote);
  if (!loaded) return null;
  const urls = Object.fromEntries(Object.entries(loaded).filter(([, buffer]) => buffer));
  if (Object.keys(urls).length < Math.ceil(Object.keys(urlsByNote).length * 0.75)) return null;
  return urls;
}

/** One instrument from the soundfont, by folder name. */
function loadSoundfont(T, folder, notes) {
  const base = `${SAMPLE_BASE_URL}${folder}-mp3/`;
  return loadNoteSet(T, Object.fromEntries(notes.map((note) => [note, `${base}${note}.mp3`])));
}

/**
 * A sampled instrument that falls back to a synthesized one.
 *
 * @param {object} spec
 * @param {string}   spec.folder    soundfont instrument folder
 * @param {string[]} spec.notes     which notes to fetch
 * @param {object}   spec.sampler   Sampler options (volume, release)
 * @param {number}   [spec.leadDb]  melody level relative to the chords. A single
 *        line against a strummed six-string chord gets buried, and how badly
 *        depends on the instrument, so each sets its own. Non-zero gets the
 *        melody its own sampler over the same buffers.
 * @param {(T, bus) => object} [spec.chain]  effects between sampler and bus
 * @param {(voices:{sampler, lead}, T, bus) => object} spec.voices
 *        which voices the samplers play, and anything else the rig needs
 * @param {(T, bus) => Promise<object>} spec.synth  the stand-in
 */
function sampled({ folder, notes, sampler: samplerOptions, leadDb = 0, chain, voices, synth }) {
  const build = async (T, bus) => {
    const urls = await loadSoundfont(T, folder, notes);
    if (!urls) {
      const rig = await synth(T, bus);
      return { ...rig, degraded: true, builtAt: Date.now() };
    }
    const out = chain ? chain(T, bus) : bus;
    const sampler = new T.Sampler({ urls, ...samplerOptions }).connect(out);
    const lead = leadDb
      ? new T.Sampler({ urls, ...samplerOptions, volume: (samplerOptions.volume ?? 0) + leadDb }).connect(out)
      : sampler;
    return voices({ sampler, lead }, T, bus);
  };
  // Never throws for want of network: there is always the stand-in.
  build.hasStandIn = true;
  build.folder = folder;
  return build;
}

// ---------------------------------------------------------------------------
// Synthesized voices
// ---------------------------------------------------------------------------

/**
 * Six plucked string voices, played round-robin.
 *
 * PluckSynth is Karplus-Strong — a noise burst fed through a tuned delay —
 * which is what makes it sound like a string rather than an oscillator. It is
 * not a Monophonic, so it cannot go inside a PolySynth; building six of them
 * is both the way round that and closer to the instrument, since each string
 * rings on its own and a strum is just the same attack staggered across them.
 *
 * These are now only the offline stand-ins for the sampled guitars.
 */
function buildStringBank(T, out, { count = 6, dampening = 4000, resonance = 0.93, volume = -8 } = {}) {
  const strings = Array.from({ length: count }, () => new T.PluckSynth({
    attackNoise: 1,
    dampening,
    resonance,
    release: 1.2,
    volume,
  }).connect(out));

  let next = 0;
  return {
    triggerAttackRelease(note, _duration, time, velocity = 0.8) {
      // A plucked string decays on its own; the scheduled duration is about
      // when the next chord lands, not how long the string should ring.
      const voice = strings[next % strings.length];
      next += 1;
      voice.triggerAttack(note, time, velocity);
    },
    releaseAll() {
      for (const v of strings) {
        try { v.triggerRelease(); } catch { /* never attacked */ }
      }
    },
  };
}

/** The bass a guitar rig brings when the bass is set to follow it. */
function guitarRigBass(T, bus, { baseFrequency = 90, octaves = 2.2, volume = -14 } = {}) {
  return new T.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', Q: 1.1 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.6 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency, octaves },
    volume,
  }).connect(bus);
}

const SYNTH = {
  async keys(T, bus) {
    const tremolo = new T.Tremolo({ frequency: 3.2, depth: 0.22, wet: 0.4 }).connect(bus).start();
    const chord = new T.PolySynth(T.FMSynth, {
      harmonicity: 2.6,
      modulationIndex: 5.5,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 1.6, sustain: 0.08, release: 1.4 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.4 },
      volume: -17,
    }).connect(tremolo);
    const bass = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.5, sustain: 0.35, release: 0.7 },
      volume: -11,
    }).connect(bus);
    const lead = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.5 },
      volume: -12,
    }).connect(bus);
    return { chord, bass, lead };
  },

  async guitarClean(T, bus) {
    const amp = new T.Filter({ type: 'lowpass', frequency: 4200, rolloff: -12 }).connect(bus);
    const chorus = new T.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.3, wet: 0.25 }).connect(amp).start();
    const chord = buildStringBank(T, chorus, { dampening: 4200, resonance: 0.94, volume: -9 });
    const lead = new T.PluckSynth({ attackNoise: 0.8, dampening: 5200, resonance: 0.95, volume: -6 }).connect(chorus);
    return { chord, bass: guitarRigBass(T, bus), lead };
  },

  async guitarAcoustic(T, bus) {
    const body = new T.Filter({ type: 'lowpass', frequency: 6500, rolloff: -12 }).connect(bus);
    const chord = buildStringBank(T, body, { dampening: 5600, resonance: 0.92, volume: -9 });
    const lead = new T.PluckSynth({ attackNoise: 1.2, dampening: 6000, resonance: 0.94, volume: -7 }).connect(body);
    return { chord, bass: guitarRigBass(T, bus), lead };
  },

  async guitarCrunch(T, bus) {
    // A speaker cabinet has almost nothing above 5 kHz; without this a
    // distorted synth is all fizz.
    const cab = new T.Filter({ type: 'lowpass', frequency: 3400, rolloff: -24 }).connect(bus);
    const drive = new T.Distortion({ distortion: 0.45, wet: 0.7 }).connect(cab);
    const chord = buildStringBank(T, drive, { dampening: 3600, resonance: 0.95, volume: -16 });
    const lead = new T.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.96, volume: -12 }).connect(drive);
    return { chord, bass: guitarRigBass(T, bus, { baseFrequency: 85, octaves: 2.4, volume: -13 }), lead };
  },

  async guitarPower(T, bus) {
    const cab = new T.Filter({ type: 'lowpass', frequency: 3000, rolloff: -24 }).connect(bus);
    const drive = new T.Distortion({ distortion: 0.72, wet: 0.85 }).connect(cab);
    const chord = buildStringBank(T, drive, { count: 3, dampening: 3200, resonance: 0.96, volume: -19 });
    const lead = new T.PluckSynth({ attackNoise: 1, dampening: 3800, resonance: 0.96, volume: -13 }).connect(drive);
    return { chord, bass: guitarRigBass(T, bus, { baseFrequency: 80, octaves: 2.6, volume: -12 }), lead };
  },

  async bassFinger(T, bus) {
    const tone = new T.Filter({ type: 'lowpass', frequency: 2600, rolloff: -12 }).connect(bus);
    const bass = new T.MonoSynth({
      oscillator: { type: 'fmsquare', modulationType: 'sine', harmonicity: 0.5 },
      filter: { type: 'lowpass', Q: 2 },
      envelope: { attack: 0.015, decay: 0.4, sustain: 0.62, release: 0.5 },
      filterEnvelope: { attack: 0.012, decay: 0.26, sustain: 0.28, baseFrequency: 70, octaves: 2.6 },
      volume: -10,
    }).connect(tone);
    return { bass };
  },

  async bassPick(T, bus) {
    const tone = new T.Filter({ type: 'lowpass', frequency: 3400, rolloff: -12 }).connect(bus);
    const grit = new T.Distortion({ distortion: 0.18, wet: 0.35 }).connect(tone);
    const bass = new T.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 2.4 },
      envelope: { attack: 0.004, decay: 0.3, sustain: 0.45, release: 0.4 },
      filterEnvelope: { attack: 0.004, decay: 0.18, sustain: 0.22, baseFrequency: 110, octaves: 3 },
      volume: -12,
    }).connect(grit);
    return { bass };
  },

  async bassUpright(T, bus) {
    const body = new T.Filter({ type: 'lowpass', frequency: 1500, rolloff: -24 }).connect(bus);
    const pluck = new T.PluckSynth({ attackNoise: 2, dampening: 1300, resonance: 0.86, volume: -3 }).connect(body);
    return {
      bass: {
        triggerAttackRelease(note, _d, time, velocity = 0.8) {
          pluck.triggerAttack(note, time, velocity);
        },
        triggerRelease() {},
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Instrument tables
// ---------------------------------------------------------------------------

/**
 * Each instrument builds chord / bass / lead voices onto the reverb bus.
 *
 * `sustains` says whether the chord voice holds for a whole bar regardless of
 * the groove's comp pattern. A pad wants to wash; a piano wants to play the
 * rhythm. arrange.js takes this flag and lays the bar out accordingly.
 *
 * `strumMs` spreads a chord's notes apart on attack. Block chords that start
 * perfectly together are half of why naive playback sounds synthetic; a few
 * milliseconds of spread reads as "played".
 *
 * Sampler `release` is how fast a held note dies when the next chord lands.
 * Guitarists mute the old chord as they strum the new one, so the guitars are
 * short; through distortion anything longer turns to mud.
 */
export const INSTRUMENTS = {
  piano: {
    label: 'Piano',
    hint: 'Sampled grand. The most useful reference for songwriting. ~1.5 MB of samples the first time you play.',
    needsNetwork: true,
    strumMs: 12,
    sustains: false,
    voicing: 'keyboard',
    async build(T, bus) {
      const urls = Object.fromEntries(
        Object.entries(PIANO_SAMPLES).map(([note, file]) => [note, PIANO_BASE_URL + file]),
      );
      const loaded = await loadNoteSet(T, urls);
      // No synth stand-in that could pass for a piano, so this one throws and
      // getRig falls back to the pad.
      if (!loaded) throw new Error('Piano samples did not load');
      const sampler = new T.Sampler({ urls: loaded, release: 1.4, volume: -8 }).connect(bus);

      // One sampler covers chords, bass and melody — a piano is one instrument.
      return { chord: sampler, bass: sampler, lead: sampler, shared: true };
    },
  },

  electric: {
    label: 'Electric piano',
    hint: 'Sampled Rhodes-style keys. Warmer than the grand, and right for soul, R&B and lo-fi.',
    needsNetwork: true,
    strumMs: 14,
    sustains: false,
    voicing: 'keyboard',
    build: sampled({
      folder: 'electric_piano_1',
      notes: KEYS_NOTES,
      sampler: { release: 0.9, volume: -2.5 },
      chain: (T, bus) => new T.Tremolo({ frequency: 3.2, depth: 0.18, wet: 0.35 }).connect(bus).start(),
      voices: ({ sampler }) => ({ chord: sampler, bass: sampler, lead: sampler, shared: true }),
      synth: SYNTH.keys,
    }),
  },

  guitarClean: {
    label: 'Electric guitar (clean)',
    hint: 'Sampled clean electric, voiced from real fingerings — open strings and doubled octaves, not a piano chord with a guitar tone.',
    needsNetwork: true,
    strumMs: 14,
    sustains: false,
    voicing: 'guitar',
    build: sampled({
      folder: 'electric_guitar_clean',
      notes: GUITAR_NOTES,
      sampler: { release: 0.35, volume: 6.5 },
      chain: (T, bus) => new T.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.3, wet: 0.2 }).connect(bus).start(),
      voices: ({ sampler, lead }, T, bus) => ({ chord: sampler, lead, bass: guitarRigBass(T, bus) }),
      synth: SYNTH.guitarClean,
    }),
  },

  guitarAcoustic: {
    label: 'Acoustic guitar',
    hint: 'Sampled steel-string. Strummed, it is the folk and country sound.',
    needsNetwork: true,
    strumMs: 18,
    sustains: false,
    voicing: 'guitar',
    build: sampled({
      folder: 'acoustic_guitar_steel',
      notes: GUITAR_NOTES,
      sampler: { release: 0.5, volume: 2.5 },
      leadDb: 6,
      voices: ({ sampler, lead }, T, bus) => ({ chord: sampler, lead, bass: guitarRigBass(T, bus) }),
      synth: SYNTH.guitarAcoustic,
    }),
  },

  guitarCrunch: {
    label: 'Electric guitar (crunch)',
    hint: 'Sampled overdriven guitar. Full chords — pick power chords below if you want the thirds gone.',
    needsNetwork: true,
    strumMs: 10,
    sustains: false,
    voicing: 'guitar',
    build: sampled({
      folder: 'overdriven_guitar',
      notes: GUITAR_NOTES,
      sampler: { release: 0.22, volume: -4 },
      leadDb: 3.5,
      voices: ({ sampler, lead }, T, bus) => ({
        chord: sampler, lead,
        bass: guitarRigBass(T, bus, { baseFrequency: 85, octaves: 2.4, volume: -13 }),
      }),
      synth: SYNTH.guitarCrunch,
    }),
  },

  guitarPower: {
    label: 'Electric guitar (power chords)',
    hint: 'Sampled distortion guitar playing root, fifth, octave and nothing else. Thirds turn to mud through heavy gain, which is why rock guitarists drop them.',
    needsNetwork: true,
    strumMs: 6,
    sustains: false,
    voicing: 'power',
    build: sampled({
      folder: 'distortion_guitar',
      notes: GUITAR_NOTES,
      sampler: { release: 0.18, volume: 2 },
      leadDb: -3,
      voices: ({ sampler, lead }, T, bus) => ({
        chord: sampler, lead,
        bass: guitarRigBass(T, bus, { baseFrequency: 80, octaves: 2.6, volume: -12 }),
      }),
      synth: SYNTH.guitarPower,
    }),
  },

  pad: {
    label: 'Synth pad',
    hint: 'Works instantly and offline. Soft and sustained — good for hearing harmony, less good for rhythm.',
    strumMs: 0,
    sustains: true,
    voicing: 'keyboard',
    async build(T, bus) {
      // A lowpass filter is what separates a pad from a buzzsaw.
      const filter = new T.Filter({ type: 'lowpass', frequency: 1900, rolloff: -24, Q: 0.6 }).connect(bus);
      const chorus = new T.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.5, wet: 0.35 }).connect(filter).start();

      const chord = new T.PolySynth(T.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
        envelope: { attack: 0.35, decay: 0.4, sustain: 0.7, release: 1.6 },
        volume: -20,
      }).connect(chorus);

      const bass = new T.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.03, decay: 0.3, sustain: 0.65, release: 0.7 },
        volume: -13,
      }).connect(filter);

      const lead = new T.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.25, sustain: 0.4, release: 0.6 },
        volume: -11,
      }).connect(bus);

      return { chord, bass, lead };
    },
  },
};

/**
 * Bass instruments, chosen independently of the chord instrument.
 *
 * Bass used to be whatever the chord rig happened to provide, which meant
 * picking a piano got you a piano bass whether you wanted one or not.
 */
export const BASS_INSTRUMENTS = {
  follow: {
    label: 'Follow the instrument',
    hint: 'Whatever the chord instrument provides. A piano plays its own left hand.',
    follow: true,
    async build() { return {}; },
  },

  electric: {
    label: 'Electric bass (finger)',
    hint: 'Sampled, round and warm. The default for most things.',
    needsNetwork: true,
    build: sampled({
      folder: 'electric_bass_finger',
      notes: BASS_NOTES,
      sampler: { release: 0.14, volume: 5 },
      voices: ({ sampler }) => ({ bass: sampler }),
      synth: SYNTH.bassFinger,
    }),
  },

  picked: {
    label: 'Electric bass (pick)',
    hint: 'Sampled, brighter, with attack on the front. Cuts through a busy mix.',
    needsNetwork: true,
    build: sampled({
      folder: 'electric_bass_pick',
      notes: BASS_NOTES,
      sampler: { release: 0.12, volume: 12.5 },
      voices: ({ sampler }) => ({ bass: sampler }),
      synth: SYNTH.bassPick,
    }),
  },

  upright: {
    label: 'Upright bass',
    hint: 'Sampled acoustic bass. Short and woody — what a walking line wants.',
    needsNetwork: true,
    build: sampled({
      folder: 'acoustic_bass',
      notes: BASS_NOTES,
      sampler: { release: 0.2, volume: 10 },
      voices: ({ sampler }) => ({ bass: sampler }),
      synth: SYNTH.bassUpright,
    }),
  },

  synth: {
    label: 'Synth bass',
    hint: 'Fat and square-edged, and synthesized on purpose. Electronic, hip-hop, anything with a four-on-the-floor kick.',
    async build(T, bus) {
      const bass = new T.MonoSynth({
        oscillator: { type: 'fatsawtooth', count: 2, spread: 14 },
        filter: { type: 'lowpass', Q: 4 },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.7, release: 0.5 },
        filterEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.35, baseFrequency: 60, octaves: 3.2 },
        volume: -11,
      }).connect(bus);
      return { bass };
    },
  },
};

export const DEFAULT_BASS_INSTRUMENT = 'electric';


export const DEFAULT_INSTRUMENT = 'pad';

// ---------------------------------------------------------------------------
// Drum kits
// ---------------------------------------------------------------------------

const DRUM_SAMPLE_BASE = 'https://tonejs.github.io/audio/drum-samples/acoustic-kit/';

/**
 * Two kits.
 *
 * The crash is synthesised in both: it is a filtered noise swell, which
 * synthesises convincingly, and it avoids depending on a sample file whose
 * presence we have not confirmed.
 */
export const DRUM_KITS = {
  off: {
    label: 'Off',
    hint: 'No drums. Chords and bass still follow the groove.',
    silent: true,
    async build() {
      return { trigger() {} };
    },
  },

  machine: {
    label: 'Drum machine (synth)',
    hint: 'Instant and offline. Sounds like a drum machine, because it is one.',
    async build(T, out) {
      const kick = new T.MembraneSynth({
        pitchDecay: 0.03,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.36, sustain: 0, release: 0.2 },
        volume: -5,
      }).connect(out);

      // Noise through a bandpass is the body of a snare; the tuned blip under
      // it is what stops it sounding like a burst of static.
      const snareBody = new T.Filter({ type: 'bandpass', frequency: 1800, Q: 1.1 }).connect(out);
      const snareNoise = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
        volume: -9,
      }).connect(snareBody);
      const snareTone = new T.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 3,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
        volume: -19,
      }).connect(out);

      const hatTop = new T.Filter({ type: 'highpass', frequency: 8500 }).connect(out);
      const hat = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
        volume: -15,
      }).connect(hatTop);

      const crashTop = new T.Filter({ type: 'highpass', frequency: 5000 }).connect(out);
      const crash = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.002, decay: 1.6, sustain: 0 },
        volume: -19,
      }).connect(crashTop);

      return {
        trigger(voice, time, velocity) {
          switch (voice) {
            case 'kick':
              kick.triggerAttackRelease('C1', 0.3, time, velocity);
              break;
            case 'snare':
              snareNoise.triggerAttackRelease(0.16, time, velocity);
              snareTone.triggerAttackRelease('A2', 0.1, time, velocity * 0.7);
              break;
            case 'hat':
              hat.triggerAttackRelease(0.03, time, velocity);
              break;
            case 'crash':
              crash.triggerAttackRelease(1.4, time, velocity * 0.8);
              break;
            default:
              break;
          }
        },
      };
    },
  },

  acoustic: {
    label: 'Acoustic kit (sampled)',
    hint: 'A real kit — three samples, well under 200 KB. Needs the network the first time you play.',
    needsNetwork: true,
    async build(T, out) {
      const buffers = await loadBuffers(T, {
        kick: `${DRUM_SAMPLE_BASE}kick.mp3`,
        snare: `${DRUM_SAMPLE_BASE}snare.mp3`,
        hat: `${DRUM_SAMPLE_BASE}hihat.mp3`,
      });
      if (!buffers || Object.values(buffers).some((b) => !b)) {
        throw new Error('Drum samples did not load');
      }

      const crashTop = new T.Filter({ type: 'highpass', frequency: 5000 }).connect(out);
      const crash = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.002, decay: 1.8, sustain: 0 },
        volume: -21,
      }).connect(crashTop);

      return {
        trigger(voice, time, velocity) {
          if (voice === 'crash') {
            crash.triggerAttackRelease(1.5, time, velocity * 0.8);
            return;
          }
          if (!buffers[voice]) return;
          // A fresh source per hit, the way a sampler works: overlapping hats
          // layer correctly instead of cutting each other off.
          //
          // The context is passed explicitly because these nodes are made
          // while the transport runs, and during a WAV render Tone has already
          // pointed its global context back at the live one by then — nodes
          // made without it play into the speakers instead of the file.
          const { context } = out;
          // The samples are mastered hot; this sits them level with the
          // machine kit, so switching kits doesn't jump the drums 7 dB.
          const gain = new T.Gain({ context, gain: velocity * 0.45 }).connect(out);
          const source = new T.ToneBufferSource({ context, url: buffers[voice] }).connect(gain);
          source.onended = () => {
            source.dispose();
            gain.dispose();
          };
          source.start(time);
        },
      };
    },
  },
};

export const DEFAULT_DRUM_KIT = 'machine';

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------

let Tone = null;
let reverbBus = null;     // pitched instruments -> reverb -> destination
let drumVolume = null;    // drums -> level control -> destination (mostly dry)
let clickVoice = null;    // metronome
const rigs = new Map();         // instrument name -> voices
const kits = new Map();         // kit name -> { trigger }
const basses = new Map();       // bass instrument name -> { bass }
const building = new Map();     // in-flight builds, so two clicks share one load
let currentToken = 0;           // invalidates callbacks from cancelled playback
// Levels can be set before any audio exists (Settings is reachable from a cold
// start). Remember them and apply them the moment Tone comes up.
let pendingVolumeDb = null;
let pendingDrumDb = null;

async function ensureTone() {
  if (!Tone) Tone = await import('tone');
  if (Tone.getContext().state !== 'running') await Tone.start();

  if (!reverbBus) {
    reverbBus = new Tone.Reverb({ decay: 2.2, wet: 0.2 }).toDestination();

    // Drums stay largely dry — reverb on a kit muddies the backbeat fast.
    drumVolume = new Tone.Volume(pendingDrumDb ?? -4).toDestination();
    const drumSend = new Tone.Gain(0.1).connect(reverbBus);
    drumVolume.connect(drumSend);

    clickVoice = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
      volume: -16,
    }).toDestination();

    pendingDrumDb = null;
    if (pendingVolumeDb !== null) {
      Tone.getDestination().volume.value = pendingVolumeDb;
      pendingVolumeDb = null;
    }
  }
  return Tone;
}

/**
 * Build (or reuse) a rig.
 *
 * Two kinds of fallback, because there are two kinds of failure:
 *  - a sampled guitar, bass or electric piano that can't fetch its samples
 *    builds its synthesized stand-in instead and comes back `degraded`. The
 *    user's choice is kept, and the samples are tried again on a later play.
 *  - anything that throws outright (the piano, the acoustic kit) falls back to
 *    the offline default for its kind, and comes back `fellBack`.
 *
 * Being offline should cost sample quality, not playback.
 *
 * @param {'instrument'|'kit'|'bass'} kind
 */
async function getRig(kind, name) {
  const table = kind === 'kit' ? DRUM_KITS : kind === 'bass' ? BASS_INSTRUMENTS : INSTRUMENTS;
  const cache = kind === 'kit' ? kits : kind === 'bass' ? basses : rigs;
  const fallbackName = kind === 'kit'
    ? DEFAULT_DRUM_KIT
    : kind === 'bass' ? DEFAULT_BASS_INSTRUMENT : DEFAULT_INSTRUMENT;

  const key = table[name] ? name : fallbackName;
  const cached = cache.get(key);
  if (cached && !shouldRetrySamples(cached)) {
    return { rig: cached, config: table[key], name: key, fellBack: false, degraded: Boolean(cached.degraded) };
  }

  const cacheKey = `${kind}:${key}`;
  if (building.has(cacheKey)) return building.get(cacheKey);

  const T = await ensureTone();
  const target = kind === 'kit' ? drumVolume : reverbBus;

  const promise = (async () => {
    try {
      const rig = await table[key].build(T, target);
      // A retry that degraded again keeps the rig it already had; building a
      // fresh synth each time would leak nodes onto the bus.
      if (rig.degraded && cached?.degraded) {
        cached.builtAt = rig.builtAt;
        return { rig: cached, config: table[key], name: key, fellBack: false, degraded: true };
      }
      cache.set(key, rig);
      return { rig, config: table[key], name: key, fellBack: false, degraded: Boolean(rig.degraded) };
    } catch {
      if (key === fallbackName) throw new Error(`Could not start ${key}`);
      const fallback = await getRig(kind, fallbackName);
      return { ...fallback, fellBack: true };
    } finally {
      building.delete(cacheKey);
    }
  })();

  building.set(cacheKey, promise);
  return promise;
}

/**
 * Warm an instrument or kit up without playing, so Settings can show a loading
 * state and report a fallback before the user hits play.
 *
 * @returns {Promise<{name:string, fellBack:boolean, degraded:boolean}>}
 */
export async function preloadInstrument(name) {
  const { name: loaded, fellBack, degraded } = await getRig('instrument', name);
  return { name: loaded, fellBack, degraded };
}

export async function preloadDrumKit(name) {
  const { name: loaded, fellBack, degraded } = await getRig('kit', name);
  return { name: loaded, fellBack, degraded };
}

export async function preloadBass(name) {
  const { name: loaded, fellBack, degraded } = await getRig('bass', name);
  return { name: loaded, fellBack, degraded };
}

/** Degraded rigs get another go at their samples once the network may be back. */
function shouldRetrySamples(rig) {
  if (!rig?.degraded) return false;
  if (globalThis.navigator?.onLine === false) return false;
  return Date.now() - (rig.builtAt || 0) > SAMPLE_RETRY_MS;
}

/** Loaded *with its samples* — a degraded rig still counts as not loaded. */
export function isInstrumentLoaded(name) {
  return rigs.has(name) && !rigs.get(name).degraded;
}

export function isBassLoaded(name) {
  return basses.has(name) && !basses.get(name).degraded;
}

export function isDrumKitLoaded(name) {
  return kits.has(name);
}

/** Does this instrument hold chords through the bar? arrange.js needs to know. */
export function instrumentSustains(name) {
  return Boolean((INSTRUMENTS[name] || INSTRUMENTS[DEFAULT_INSTRUMENT]).sustains);
}

/** How this instrument wants its chords voiced: keyboard, guitar or power. */
export function instrumentVoicing(name) {
  return (INSTRUMENTS[name] || INSTRUMENTS[DEFAULT_INSTRUMENT]).voicing || 'keyboard';
}

/**
 * Silence the transport and every voice, WITHOUT invalidating the current
 * playback token.
 *
 * Keeping the token valid matters at the natural end of a song: the final
 * callback queues an onEnd notification through Tone.Draw, which runs on a
 * later animation frame. Bumping the token before that frame arrives would
 * make the notification discard itself, and the UI would sit on "Stop" forever.
 */
function haltTransport() {
  if (!Tone) return;
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.position = 0;
  // A sampler can be chord, lead and bass at once; release each voice once.
  const voices = new Set();
  for (const rig of [...rigs.values(), ...basses.values()]) {
    for (const v of [rig.chord, rig.lead, rig.bass]) if (v) voices.add(v);
  }
  for (const v of voices) releaseVoice(v);
}

/** Polyphonic voices release everything; monophonic ones just let go. */
function releaseVoice(voice) {
  try {
    if (voice.releaseAll) voice.releaseAll();
    else voice.triggerRelease?.();
  } catch {
    // Releasing a voice that never attacked is harmless.
  }
}

/**
 * Stop everything and cancel any pending callbacks.
 *
 * Used when the user stops playback or starts something else: the token bump
 * is what stops already-scheduled events from firing.
 */
export function stopPlayback() {
  currentToken += 1;
  haltTransport();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Small jitter so repeated hats don't machine-gun. */
function humanize(voice, velocity) {
  if (voice !== 'hat' && voice !== 'snare') return velocity;
  const jitter = (Math.random() - 0.5) * 0.12;
  return Math.min(1, Math.max(0.05, velocity + jitter));
}

/**
 * Put an arrangement's events onto a transport.
 *
 * Shared by live playback and by the offline renderer, so a rendered file
 * cannot drift from what you heard. It takes its transport and its guard as
 * arguments rather than reaching for module state, which is what lets the
 * offline context use it.
 *
 * @param {object} opts
 * @param {import('./arrange.js').NoteEvent[]} opts.events
 * @param {object}   opts.transport    live or offline transport
 * @param {(step:number)=>number} opts.toSeconds
 * @param {number}   opts.beatSeconds
 * @param {number}   opts.strum        seconds between strummed notes
 * @param {object}   opts.voices       { chord, bass, lead }
 * @param {object}   opts.kit          { trigger }
 * @param {object}   [opts.click]      metronome voice
 * @param {()=>boolean} [opts.guard]   false aborts a hit (a cancelled pass)
 */
export function scheduleEvents({
  events, transport, toSeconds, beatSeconds, strum,
  voices, kit, click, guard = () => true,
}) {
  // Chord notes sharing a step get strummed, so they need their index within
  // that step. Counting as we go is cheaper than grouping up front.
  const strumIndex = new Map();

  for (const ev of events) {
    const at = toSeconds(ev.step);
    const durationSeconds = Math.max(0.05, toSeconds(ev.step + ev.duration) - at);
    const velocity = Math.min(1, Math.max(0.05, ev.velocity / 127));

    let offset = 0;
    if (ev.voice === 'chord' && strum > 0) {
      const n = strumIndex.get(ev.step) || 0;
      strumIndex.set(ev.step, n + 1);
      offset = n * strum;
    }

    transport.scheduleOnce((time) => {
      if (!guard()) return;
      try {
        switch (ev.voice) {
          case 'chord':
            voices.chord.triggerAttackRelease(midiToNote(ev.midi), durationSeconds, time + offset, velocity);
            break;
          case 'bass':
            voices.bass.triggerAttackRelease(midiToNote(ev.midi), durationSeconds, time, velocity);
            break;
          case 'lead':
            voices.lead.triggerAttackRelease(
              midiToNote(ev.midi),
              Math.min(durationSeconds, beatSeconds * 2),
              time,
              velocity,
            );
            break;
          case 'click':
            click?.triggerAttackRelease(midiToNote(ev.midi), 0.02, time, velocity);
            break;
          default:
            // kick | snare | hat | crash
            kit.trigger(ev.voice, time, humanize(ev.voice, velocity));
            break;
        }
      } catch {
        // One failed hit should never take down the whole render.
      }
    }, at);
  }
}

/**
 * Schedule an arrangement onto the transport.
 *
 * @param {object} opts
 * @param {import('./arrange.js').NoteEvent[]} opts.events
 * @param {{step:number, sectionId:string, bar:number}[]} opts.barMarkers
 * @param {number} opts.totalSteps
 * @param {number} opts.swing
 * @param {number} opts.tempo
 * @param {object} opts.voices   instrument rig
 * @param {object} opts.config   instrument config (for strumMs)
 * @param {object} opts.kit      drum rig
 * @param {number} opts.token
 * @param {(sectionId:string|null, bar:number)=>void} [opts.onPosition]
 * @param {()=>void} [opts.onEnd]
 * @returns {number} duration in seconds
 */
function schedule({
  events, barMarkers, totalSteps, swing, tempo,
  voices, config, kit, token,
  onPosition, onEnd,
}) {
  const T = Tone;
  const transport = T.getTransport();
  transport.bpm.value = tempo;

  const beatSeconds = 60 / tempo;
  const toSeconds = (step) => stepToBeats(step, swing) * beatSeconds;
  const strum = (config.strumMs || 0) / 1000;

  scheduleEvents({
    events, transport, toSeconds, beatSeconds, strum,
    voices, kit, click: clickVoice,
    guard: () => token === currentToken,
  });

  // Playhead, one callback per bar.
  for (const marker of barMarkers) {
    transport.scheduleOnce((time) => {
      if (token !== currentToken) return;
      T.getDraw().schedule(() => {
        if (token === currentToken) onPosition?.(marker.sectionId, marker.bar);
      }, time);
    }, toSeconds(marker.step));
  }

  const duration = toSeconds(totalSteps);
  transport.scheduleOnce(() => {
    if (token !== currentToken) return;
    T.getDraw().schedule(() => {
      if (token === currentToken) {
        onPosition?.(null, -1);
        onEnd?.();
      }
    }, T.now());
    // halt, not stopPlayback: the Draw callback above still has to run.
    haltTransport();
  }, duration + 0.05);

  transport.start();
  return duration;
}

/**
 * Shared entry point for both playback calls.
 *
 * @returns {Promise<{duration:number, instrument:string, kit:string, fellBack:boolean, degraded:boolean}>}
 */
async function play({
  sections, key, tempo, mode, grooveId,
  instrument, drumKit, bassInstrument, bassStyle, compStyle,
  genre, mood, metronome,
  onPosition, onEnd,
}) {
  stopPlayback();
  const token = currentToken;

  const [instrumentRig, kitRig, bassRig] = await Promise.all([
    getRig('instrument', instrument),
    getRig('kit', drumKit),
    getRig('bass', bassInstrument),
  ]);
  await ensureTone();
  if (token !== currentToken) {
    return { duration: 0, instrument: instrumentRig.name, kit: kitRig.name, fellBack: false };
  }

  // A dedicated bass instrument overrides the chord rig's own bass voice;
  // 'follow' leaves it alone, which is what a piano wants.
  const voices = {
    chord: instrumentRig.rig.chord,
    lead: instrumentRig.rig.lead,
    bass: bassRig.config.follow ? instrumentRig.rig.bass : bassRig.rig.bass,
  };

  const { events, barMarkers, totalSteps, swing } = arrange({
    sections,
    key,
    grooveId,
    chords: mode === 'chords' || mode === 'both',
    melody: mode === 'melody' || mode === 'both',
    drums: !kitRig.config.silent,
    metronome,
    sustainChords: Boolean(instrumentRig.config.sustains),
    bassStyle,
    compStyle,
    genre,
    mood,
    tempo,
    voicing: instrumentRig.config.voicing || 'keyboard',
  });

  const result = {
    duration: 0,
    instrument: instrumentRig.name,
    kit: kitRig.name,
    fellBack: instrumentRig.fellBack || kitRig.fellBack,
    degraded: Boolean(instrumentRig.degraded || (!bassRig.config.follow && bassRig.degraded)),
  };

  if (!events.length || !totalSteps) {
    onEnd?.();
    return result;
  }

  result.duration = schedule({
    events, barMarkers, totalSteps, swing,
    tempo: Math.min(240, Math.max(40, Math.round(tempo))),
    voices,
    config: instrumentRig.config,
    kit: kitRig.rig,
    token,
    onPosition,
    onEnd,
  });
  return result;
}

/**
 * Play one section.
 *
 * @param {object} opts
 * @param {object} opts.section       the section to play
 * @param {string} opts.key
 * @param {number} opts.tempo
 * @param {'chords'|'melody'|'both'} [opts.mode]
 * @param {string} [opts.grooveId]
 * @param {string} [opts.instrument]
 * @param {string} [opts.drumKit]
 * @param {boolean} [opts.metronome]
 * @param {(barIndex:number)=>void} [opts.onBar]
 * @param {()=>void} [opts.onEnd]
 */
export function playSection({
  section,
  key = 'C major',
  tempo = 100,
  mode = 'both',
  grooveId = 'pop',
  instrument = DEFAULT_INSTRUMENT,
  drumKit = DEFAULT_DRUM_KIT,
  bassInstrument = DEFAULT_BASS_INSTRUMENT,
  bassStyle = 'auto',
  compStyle = 'auto',
  genre = '',
  mood = '',
  metronome = false,
  onBar,
  onEnd,
} = {}) {
  return play({
    sections: section ? [section] : [],
    key, tempo, mode, grooveId, instrument, drumKit,
    bassInstrument, bassStyle, compStyle, genre, mood, metronome,
    onPosition: (_sectionId, bar) => onBar?.(bar),
    onEnd,
  });
}

/**
 * Play the whole song. Voice leading and the groove carry across section
 * boundaries, so it moves as one continuous arrangement.
 */
export function playSong({
  sections = [],
  key = 'C major',
  tempo = 100,
  mode = 'both',
  grooveId = 'pop',
  instrument = DEFAULT_INSTRUMENT,
  drumKit = DEFAULT_DRUM_KIT,
  bassInstrument = DEFAULT_BASS_INSTRUMENT,
  bassStyle = 'auto',
  compStyle = 'auto',
  genre = '',
  mood = '',
  metronome = false,
  onPosition,
  onEnd,
} = {}) {
  return play({
    sections, key, tempo, mode, grooveId, instrument, drumKit,
    bassInstrument, bassStyle, compStyle, genre, mood, metronome,
    onPosition,
    onEnd,
  });
}

/**
 * Audition a single chord — used when a chord chip is clicked.
 *
 * Deliberately does NOT touch `currentToken`: clicking a chord while a section
 * is playing should layer on top of it, not invalidate the scheduled playback.
 */
export async function previewChord(symbol, instrument = DEFAULT_INSTRUMENT) {
  const mode = instrumentVoicing(instrument);
  const voicing = mode === 'power'
    ? powerChordMidi(symbol)
    : (mode === 'guitar' && guitarVoicingMidi(symbol)) || voiceLeadChord(symbol, null);
  if (!voicing.length) return;

  const { rig, config } = await getRig('instrument', instrument);
  const strum = (config.strumMs || 0) / 1000;
  const now = Tone.now();

  voicing.forEach((midi, i) => {
    rig.chord.triggerAttackRelease(midiToNote(midi), 1.3, now + i * strum, 0.6);
  });
  rig.bass.triggerAttackRelease(midiToNote(bassNoteForRole(symbol, 'R', null, null)), 1.3, now, 0.7);
}

/**
 * Master output volume in decibels (-40 .. 0).
 * Safe to call before any audio exists.
 */
export function setVolume(db) {
  if (!Tone || !reverbBus) {
    pendingVolumeDb = db;
    return;
  }
  Tone.getDestination().volume.rampTo(db, 0.1);
}

/** Drum level in decibels (-30 .. +6), relative to the rest of the mix. */
export function setDrumLevel(db) {
  if (!Tone || !drumVolume) {
    pendingDrumDb = db;
    return;
  }
  drumVolume.volume.rampTo(db, 0.1);
}
