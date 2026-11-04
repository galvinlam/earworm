/**
 * render.js
 * ---------------------------------------------------------------------------
 * Renders a song to an audio file, offline and faster than real time.
 *
 * This exists because a MIDI file has no sound of its own. Exported MIDI plays
 * through whatever synth opens it, which for most people is a thin General MIDI
 * bank — so the file sounds markedly worse than the browser did. A WAV carries
 * the actual performance: the same instruments, groove, voicings and mix you
 * just listened to.
 *
 * MIDI is still the better export for anyone taking the song into a DAW, since
 * notes can be edited and audio cannot. The two answer different questions.
 */

import { arrange } from './arrange.js';
import { stepToBeats } from './groove.js';
import { audioBufferToWav, lastAudibleFrame } from './wav.js';
import {
  INSTRUMENTS,
  BASS_INSTRUMENTS,
  DRUM_KITS,
  DEFAULT_INSTRUMENT,
  DEFAULT_BASS_INSTRUMENT,
  DEFAULT_DRUM_KIT,
  scheduleEvents,
} from './audioEngine.js';

/** Tail left after the last note so reverb and ringing strings are not cut off. */
const TAIL_SECONDS = 2.5;

/**
 * Render a song to a WAV blob.
 *
 * @param {object} opts
 * @param {Array}  opts.sections
 * @param {string} opts.key
 * @param {number} opts.tempo
 * @param {string} [opts.grooveId]
 * @param {string} [opts.instrument]
 * @param {string} [opts.bassInstrument]
 * @param {string} [opts.drumKit]
 * @param {string} [opts.bassStyle]
 * @param {string} [opts.compStyle]
 * @param {boolean}[opts.metronome]
 * @param {'chords'|'melody'|'both'} [opts.mode]
 * @param {(ratio:number)=>void} [opts.onProgress]
 * @returns {Promise<{blob: Blob, duration: number, degraded: boolean}>}
 *   `degraded` means a sampled instrument used its synthesized stand-in.
 */
export async function renderSongToWav({
  sections = [],
  key = 'C major',
  tempo = 100,
  grooveId = 'pop',
  instrument = DEFAULT_INSTRUMENT,
  bassInstrument = DEFAULT_BASS_INSTRUMENT,
  drumKit = DEFAULT_DRUM_KIT,
  bassStyle = 'auto',
  compStyle = 'auto',
  metronome = false,
  mode = 'both',
  genre = '',
  mood = '',
  onProgress,
} = {}) {
  const Tone = await import('tone');

  const instrumentDef = INSTRUMENTS[instrument] || INSTRUMENTS[DEFAULT_INSTRUMENT];
  const bassDef = BASS_INSTRUMENTS[bassInstrument] || BASS_INSTRUMENTS[DEFAULT_BASS_INSTRUMENT];
  const kitDef = DRUM_KITS[drumKit] || DRUM_KITS[DEFAULT_DRUM_KIT];

  const { events, totalSteps, swing } = arrange({
    sections,
    key,
    grooveId,
    chords: mode === 'chords' || mode === 'both',
    melody: mode === 'melody' || mode === 'both',
    drums: !kitDef.silent,
    metronome,
    sustainChords: Boolean(instrumentDef.sustains),
    bassStyle,
    compStyle,
    genre,
    mood,
    tempo,
    voicing: instrumentDef.voicing || 'keyboard',
  });

  if (!events.length) {
    throw new Error('There is nothing to render — this song has no chords yet.');
  }

  const bpm = Math.min(240, Math.max(40, Math.round(tempo)));
  const beatSeconds = 60 / bpm;
  const toSeconds = (step) => stepToBeats(step, swing) * beatSeconds;
  const duration = toSeconds(totalSteps) + TAIL_SECONDS;

  onProgress?.(0.05);

  let degraded = false;

  // Everything built inside this callback is recorded. Tone points its
  // "current context" at the offline one for the duration, so the same
  // instrument builders used for live playback work unchanged here.
  const buffer = await Tone.Offline(async ({ transport }) => {
    const reverb = new Tone.Reverb({ decay: 2.2, wet: 0.2 }).toDestination();
    // The impulse response is generated, not loaded, and offline rendering
    // will not wait for it on its own.
    if (typeof reverb.generate === 'function') await reverb.generate();

    const drumVolume = new Tone.Volume(-4).toDestination();
    const drumSend = new Tone.Gain(0.1).connect(reverb);
    drumVolume.connect(drumSend);

    const click = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
      volume: -16,
    }).toDestination();

    // Each builder waits for its own samples (and reuses any that live
    // playback already fetched), so these can load side by side.
    const [instrumentRig, bassRig, kitRig] = await Promise.all([
      instrumentDef.build(Tone, reverb),
      bassDef.follow ? {} : bassDef.build(Tone, reverb),
      // A kit has an offline equivalent; a piano does not, so only the kit
      // falls back here and a failed piano surfaces as an export error.
      kitDef.build(Tone, drumVolume).catch(() => DRUM_KITS[DEFAULT_DRUM_KIT].build(Tone, drumVolume)),
    ]);
    degraded = Boolean(instrumentRig.degraded || bassRig.degraded);

    const voices = {
      chord: instrumentRig.chord,
      lead: instrumentRig.lead,
      bass: bassDef.follow ? instrumentRig.bass : bassRig.bass,
    };

    transport.bpm.value = bpm;
    scheduleEvents({
      events,
      transport,
      toSeconds,
      beatSeconds,
      strum: (instrumentDef.strumMs || 0) / 1000,
      voices,
      kit: kitRig,
      click,
    });
    transport.start(0);
  }, duration);

  onProgress?.(0.9);

  // Tone wraps the buffer; unwrap to the raw AudioBuffer for encoding.
  const raw = typeof buffer.get === 'function' ? buffer.get() : buffer;

  // Keep a short breath after the last audible sample, then cut. The reserved
  // tail is deliberately generous, and whatever it does not use is silence.
  const audible = lastAudibleFrame(raw);
  const endFrame = Math.min(raw.length, audible + Math.round(raw.sampleRate * 0.25));

  const blob = audioBufferToWav(raw, { endFrame });
  onProgress?.(1);

  return { blob, duration: endFrame / raw.sampleRate, degraded };
}
