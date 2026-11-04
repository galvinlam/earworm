/**
 * useSoundPicker.js
 * ---------------------------------------------------------------------------
 * Switching to a sampled sound, from either the arrangement bar or Settings.
 *
 * Samples are fetched when you pick, not when you next press play, so the wait
 * shows up next to the control you touched rather than as a stall. What
 * happens when they can't be fetched depends on the sound:
 *
 *  - guitars, basses and the electric piano have synthesized stand-ins, so the
 *    choice is kept and you are told you're hearing the stand-in;
 *  - the piano and the acoustic kit don't, so the choice falls back to the
 *    offline default and you are told that instead.
 */

import { useState } from 'react';
import {
  INSTRUMENTS,
  BASS_INSTRUMENTS,
  DRUM_KITS,
  preloadInstrument,
  preloadBass,
  preloadDrumKit,
  isInstrumentLoaded,
  isBassLoaded,
  isDrumKitLoaded,
} from '../lib/audioEngine.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { toast } from '../store/useToastStore.js';

const KINDS = {
  instrument: { field: 'instrument', table: INSTRUMENTS, preload: preloadInstrument, isLoaded: isInstrumentLoaded },
  bass: { field: 'bassInstrument', table: BASS_INSTRUMENTS, preload: preloadBass, isLoaded: isBassLoaded },
  kit: { field: 'drumKit', table: DRUM_KITS, preload: preloadDrumKit, isLoaded: isDrumKitLoaded },
};

/** Fetch one sound's samples and report how it went. Returns a toast-ready outcome. */
async function warm(kind, value) {
  const { field, table, preload, isLoaded } = KINDS[kind];
  const def = table[value];
  if (!def?.needsNetwork || isLoaded(value)) return { ok: true, cached: true };

  try {
    const { name, fellBack, degraded } = await preload(value);
    if (fellBack) {
      // Only undo the choice if the user hasn't moved on while it loaded.
      const store = useSettingsStore.getState();
      if (store[field] === value) store.set({ [field]: name });
      return { ok: false, message: `${def.label} samples didn't load — playing ${table[name].label.toLowerCase()} instead.` };
    }
    if (degraded) {
      return { ok: false, soft: true, message: `${def.label}: samples didn't load, so you'll hear the synthesized version until they do.` };
    }
    return { ok: true, label: def.label };
  } catch {
    return { ok: false, message: `Could not start ${def.label.toLowerCase()}.` };
  }
}

function report(outcomes) {
  const problems = outcomes.filter((o) => !o.ok);
  for (const p of problems) (p.soft ? toast.info : toast.error)(p.message);
  const loaded = outcomes.filter((o) => o.ok && o.label).map((o) => o.label);
  if (!problems.length && loaded.length) toast.success(`${loaded.join(' and ')} loaded.`);
}

export function useSoundPicker() {
  const set = useSettingsStore((s) => s.set);
  const [loading, setLoading] = useState(null); // kind | 'many' | null

  /** Choose one sound and warm it up. */
  const pick = async (kind, value) => {
    set({ [KINDS[kind].field]: value });
    const def = KINDS[kind].table[value];
    if (!def?.needsNetwork || KINDS[kind].isLoaded(value)) return;
    setLoading(kind);
    try {
      report([await warm(kind, value)]);
    } finally {
      setLoading(null);
    }
  };

  /**
   * Apply several settings at once — "fit to song" — fetching any samples
   * side by side and reporting once.
   *
   * @param {object} patch  settings fields; instrument / bassInstrument / drumKit get warmed
   */
  const applyMany = async (patch) => {
    set(patch);
    const jobs = Object.entries(KINDS)
      .filter(([, { field }]) => patch[field] !== undefined)
      .map(([kind, { field }]) => [kind, patch[field]]);
    if (!jobs.length) return;
    setLoading('many');
    try {
      report(await Promise.all(jobs.map(([kind, value]) => warm(kind, value))));
    } finally {
      setLoading(null);
    }
  };

  return { pick, applyMany, loading };
}
