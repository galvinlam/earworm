/**
 * sharedSound.js
 * ---------------------------------------------------------------------------
 * The sound a share link carries is just names. Keep only the ones this
 * version of the app knows, so a link from an older or newer build can't put
 * the settings into a state the pickers don't have.
 */

import { INSTRUMENTS, BASS_INSTRUMENTS, DRUM_KITS } from './audioEngine.js';
import { GROOVES, BASS_STYLES, COMP_STYLES } from './groove.js';

const TABLES = {
  instrument: INSTRUMENTS,
  bassInstrument: BASS_INSTRUMENTS,
  drumKit: DRUM_KITS,
  groove: { auto: true, ...GROOVES },
  bassStyle: BASS_STYLES,
  compStyle: COMP_STYLES,
};

/** @returns {object|null} the recognised settings, or null if none were */
export function validSharedSound(sound) {
  if (!sound) return null;
  const out = {};
  for (const [field, table] of Object.entries(TABLES)) {
    const value = sound[field];
    if (typeof value === 'string' && Object.hasOwn(table, value)) out[field] = value;
  }
  return Object.keys(out).length ? out : null;
}
