/**
 * arrange.js
 * ---------------------------------------------------------------------------
 * Turns a song plus a groove into a flat, abstract list of note events.
 *
 * This is the one place that decides what gets played and when. The audio
 * engine renders the list with Tone.js; the MIDI exporter renders the same list
 * as bytes. Neither duplicates the arrangement logic, so playback and export
 * cannot drift apart.
 *
 * Positions are in sixteenth-note steps from the start, as floats. Converting
 * steps to seconds or to MIDI ticks (and applying swing) is the renderer's job.
 */

import {
  GROOVES,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  readGrid,
  readBassGrid,
  bassNoteForRole,
  resolveBassGrid,
  resolveCompGrid,
  resolveBassStyle,
  resolveCompStyle,
  isArpeggio,
  sectionDensity,
  applyDensity,
  applyTurnaround,
} from './groove.js';
import { voiceLeadChord, contourToNotes, noteToMidi } from './musicTheory.js';
import { guitarVoicingMidi, powerChordMidi } from './guitar.js';

/**
 * General MIDI percussion notes, so the drum track lands on the right pads in
 * any DAW without remapping.
 */
export const DRUM_NOTES = {
  kick: 36,   // Bass Drum 1
  snare: 38,  // Acoustic Snare
  hat: 42,    // Closed Hi-Hat
  crash: 49,  // Crash Cymbal 1
};

/** Velocities: [normal, accent] per voice. */
const VELOCITY = {
  kick: [92, 112],
  snare: [76, 108],
  hat: [54, 82],
  crash: [100, 100],
  chord: [72, 84],
  bass: [90, 102],
  lead: [92, 92],
  click: [70, 104],
};

const vel = (voice, accent) => (VELOCITY[voice] || [80, 96])[accent ? 1 : 0];

/**
 * @typedef {object} NoteEvent
 * @property {string} voice  chord | bass | lead | kick | snare | hat | crash | click
 * @property {number} step   position in sixteenths from the start
 * @property {number} duration  length in steps
 * @property {number} midi
 * @property {number} velocity
 * @property {string} [sectionId]
 * @property {number} [bar]   bar index within its section, for the playhead
 */

/** Durations from a list of hit positions: each hit lasts until the next one. */
function spanTo(hits, index, barStartStep, fallbackEnd) {
  const next = hits[index + 1];
  const end = next ? barStartStep + next.step : fallbackEnd;
  return Math.max(0.5, end - (barStartStep + hits[index].step));
}

/**
 * Arrange a list of sections into events.
 *
 * @param {object} opts
 * @param {Array}   opts.sections
 * @param {string}  opts.key
 * @param {string}  opts.grooveId
 * @param {boolean} [opts.chords=true]
 * @param {boolean} [opts.melody=true]
 * @param {boolean} [opts.drums=true]
 * @param {boolean} [opts.metronome=false]
 * @param {boolean} [opts.sustainChords=false]  hold chords for the whole bar,
 *   ignoring the comp pattern — what a pad wants
 * @param {string} [opts.bassStyle='auto']  overrides the groove's bass pattern
 * @param {string} [opts.compStyle='auto']  overrides the groove's chord rhythm
 * @param {string} [opts.genre]  used when a style is 'auto'
 * @param {string} [opts.mood]   used when a style is 'auto'
 * @param {number} [opts.tempo]  used when a style is 'auto'
 * @param {'keyboard'|'guitar'|'power'} [opts.voicing='keyboard'] how to voice
 *   a chord — a guitar fingering sounds nothing like a close piano voicing
 * @returns {{events: NoteEvent[], totalSteps: number, swing: number, grooveId: string}}
 */
export function arrange({
  sections = [],
  key = 'C major',
  grooveId = 'pop',
  chords: withChords = true,
  melody: withMelody = true,
  drums: withDrums = true,
  metronome: withMetronome = false,
  sustainChords = false,
  bassStyle = 'auto',
  compStyle = 'auto',
  genre = '',
  mood = '',
  tempo = 100,
  voicing: voicingMode = 'keyboard',
}) {
  const id = GROOVES[grooveId] ? grooveId : 'pop';
  const groove = GROOVES[id];
  const events = [];

  const resolvedBassStyle = resolveBassStyle(bassStyle, genre, mood, tempo);
  const resolvedCompStyle = resolveCompStyle(compStyle, genre, mood, tempo);
  const compGrid = resolveCompGrid(resolvedCompStyle, groove);
  const bassGrid = resolveBassGrid(resolvedBassStyle, groove);
  const arpeggiate = isArpeggio(resolvedCompStyle);

  /**
   * Voice a chord for the instrument that will play it.
   *
   * A guitar falls back to the keyboard voicing when no shape is known — some
   * chords have no sensible fingering, and a wrong-but-playable voicing beats
   * silence.
   */
  const voiceChord = (symbol, previous) => {
    if (voicingMode === 'power') return powerChordMidi(symbol);
    if (voicingMode === 'guitar') {
      const shape = guitarVoicingMidi(symbol);
      if (shape) return shape;
    }
    return voiceLeadChord(symbol, previous);
  };

  // Voicing and bass position thread across bars AND sections, so the whole
  // song moves as one continuous progression.
  let voicing = null;
  let bassMidi = null;
  let cursor = 0;
  /** @type {{step:number, sectionId:string, bar:number}[]} */
  const barMarkers = [];

  for (const section of sections) {
    const symbols = Array.isArray(section.chords) ? section.chords : [];
    const bars = symbols.length;
    if (!bars) continue;

    const sectionStart = cursor;
    const sectionSteps = bars * STEPS_PER_BAR;

    // A band does not play a verse the way it plays a chorus. Every pattern is
    // re-read per section at that section's density, which is the difference
    // between an arrangement and a loop.
    const density = sectionDensity(section.type, section.label);
    const compHits = readGrid(applyDensity(compGrid, density, 'comp'));
    const bassHits = readBassGrid(applyDensity(bassGrid, density, 'bass'));
    const kickHits = readGrid(applyDensity(groove.kick, density, 'kick'));
    const snareHits = readGrid(applyDensity(groove.snare, density, 'snare'));
    const hatHits = readGrid(applyDensity(groove.hat, density, 'hat'));

    // The last bar of a section gets a turnaround — a fill, and a bass walk
    // into whatever comes next — so sections join rather than restart.
    const wantsTurnaround = bars >= 4;
    const turnSnare = wantsTurnaround
      ? readGrid(applyTurnaround(applyDensity(groove.snare, density, 'snare'), 'snare'))
      : snareHits;
    const turnBass = wantsTurnaround
      ? readBassGrid(applyTurnaround(applyDensity(bassGrid, density, 'bass'), 'bass'))
      : bassHits;

    symbols.forEach((symbol, bar) => {
      const barStart = sectionStart + bar * STEPS_PER_BAR;
      const barEnd = barStart + STEPS_PER_BAR;
      const nextSymbol = symbols[bar + 1] ?? symbols[0];
      barMarkers.push({ step: barStart, sectionId: section.id, bar });

      const isLastBar = bar === bars - 1;
      const barBass = isLastBar ? turnBass : bassHits;
      const barSnare = isLastBar ? turnSnare : snareHits;

      // ---- harmony --------------------------------------------------------
      voicing = voiceChord(symbol, voicing);

      if (withChords) {
        if (arpeggiate && !sustainChords && compHits.length) {
          // An arpeggio plays one note per hit, walking up the voicing and
          // back down, rather than sounding the chord at once.
          const up = voicing;
          const path = up.length > 2
            ? [...up, ...up.slice(1, -1).reverse()]
            : up;
          compHits.forEach((hit, i) => {
            events.push({
              voice: 'chord',
              step: barStart + hit.step,
              duration: spanTo(compHits, i, barStart, barEnd),
              midi: path[i % path.length],
              velocity: vel('chord', hit.step === 0),
              sectionId: section.id,
              bar,
            });
          });
        } else if (sustainChords || !compHits.length) {
          for (const midi of voicing) {
            events.push({
              voice: 'chord',
              step: barStart,
              duration: STEPS_PER_BAR,
              midi,
              velocity: vel('chord', false),
              sectionId: section.id,
              bar,
            });
          }
        } else {
          compHits.forEach((hit, i) => {
            const duration = spanTo(compHits, i, barStart, barEnd);
            for (const midi of voicing) {
              events.push({
                voice: 'chord',
                step: barStart + hit.step,
                duration,
                midi,
                velocity: vel('chord', hit.accent || hit.step === 0),
                sectionId: section.id,
                bar,
              });
            }
          });
        }
      }

      // ---- bass -----------------------------------------------------------
      if (withChords) {
        barBass.forEach((hit, i) => {
          bassMidi = bassNoteForRole(symbol, hit.role, bassMidi, nextSymbol);
          events.push({
            voice: 'bass',
            step: barStart + hit.step,
            duration: spanTo(barBass, i, barStart, barEnd),
            midi: bassMidi,
            velocity: vel('bass', hit.step === 0),
            sectionId: section.id,
            bar,
          });
        });
      }

      // ---- drums ----------------------------------------------------------
      if (withDrums) {
        const push = (voice, hits) => {
          for (const hit of hits) {
            events.push({
              voice,
              step: barStart + hit.step,
              duration: 1,
              midi: DRUM_NOTES[voice],
              velocity: vel(voice, hit.accent),
              sectionId: section.id,
              bar,
            });
          }
        };
        push('kick', kickHits);
        push('snare', barSnare);
        push('hat', hatHits);

        if (groove.crashOnSection && bar === 0) {
          events.push({
            voice: 'crash',
            step: barStart,
            duration: 4,
            midi: DRUM_NOTES.crash,
            velocity: vel('crash', true),
            sectionId: section.id,
            bar,
          });
        }
      }

      // ---- metronome ------------------------------------------------------
      if (withMetronome) {
        for (let beat = 0; beat < 4; beat += 1) {
          events.push({
            voice: 'click',
            step: barStart + beat * STEPS_PER_BEAT,
            duration: 0.5,
            // Pitch carries the accent: higher on beat 1.
            midi: beat === 0 ? 96 : 84,
            velocity: vel('click', beat === 0),
            sectionId: section.id,
            bar,
          });
        }
      }
    });

    // ---- melody: the contour spread evenly across the section -------------
    if (withMelody && Array.isArray(section.melodyContour) && section.melodyContour.length) {
      const notes = contourToNotes(section.melodyContour, key, 4);
      const step = sectionSteps / notes.length;
      notes.forEach((noteName, i) => {
        if (!noteName) return; // rest
        const midi = noteToMidi(noteName);
        if (midi === null) return;
        events.push({
          voice: 'lead',
          step: sectionStart + i * step,
          duration: Math.max(1, step * 0.85),
          midi,
          velocity: vel('lead', false),
          sectionId: section.id,
        });
      });
    }

    cursor += sectionSteps;
  }

  events.sort((a, b) => a.step - b.step);
  return {
    events,
    barMarkers,
    totalSteps: cursor,
    swing: groove.swing || 0,
    grooveId: id,
    bassStyle: resolvedBassStyle,
    compStyle: resolvedCompStyle,
  };
}

