/**
 * ArrangementBar.jsx
 * ---------------------------------------------------------------------------
 * The arrangement controls, inline above the song.
 *
 * These live here rather than only in Settings because they are the controls
 * you change *while listening* — swapping groove or instrument is the core
 * iteration loop, and a modal is the wrong place for it. Settings keeps the
 * full set (levels, what-to-play); this is the part you reach for constantly.
 */

import React, { useState } from 'react';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { INSTRUMENTS, DRUM_KITS, BASS_INSTRUMENTS } from '../lib/audioEngine.js';
import {
  GROOVES,
  BASS_STYLES,
  COMP_STYLES,
  resolveGroove,
  resolveBassStyle,
  resolveCompStyle,
  partsForSong,
} from '../lib/groove.js';
import { useSoundPicker } from '../hooks/useSoundPicker.js';
import { cx, Spinner } from './ui.jsx';
import * as Icon from './icons.jsx';

/** A compact labelled select that fits on one line. */
function MiniSelect({ label, value, onChange, disabled, title, children }) {
  return (
    <label className="flex min-w-0 items-center gap-1.5" title={title}>
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      <div className="relative min-w-0">
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cx(
            'min-w-0 max-w-[11rem] cursor-pointer appearance-none truncate rounded-lg border border-white/10',
            'bg-ink-850/80 py-1 pl-2 pr-6 text-[12px] text-slate-200',
            'transition-colors hover:border-white/25 focus:border-accent/60 focus:outline-none',
            'focus:ring-2 focus:ring-accent/25 disabled:opacity-50',
            '[&>option]:bg-ink-850 [&>option]:text-slate-100',
          )}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.2 7.3a1 1 0 0 1 1.4 0L10 10.6l3.4-3.3a1 1 0 1 1 1.4 1.4l-4.1 4a1 1 0 0 1-1.4 0l-4.1-4a1 1 0 0 1 0-1.4Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </label>
  );
}

export default function ArrangementBar({ genre, mood, tempo, disabled }) {
  const s = useSettingsStore();
  const { pick, applyMany, loading } = useSoundPicker();
  // The parts row is hidden by default: four controls cover most sessions, and
  // seven in a row is unusable on a phone.
  const [showParts, setShowParts] = useState(false);

  const activeGroove = resolveGroove(s.groove, genre, tempo);
  const autoBass = resolveBassStyle('auto', genre, mood, tempo);
  const autoComp = resolveCompStyle('auto', genre, mood, tempo);

  // What this song's genre and mood call for. Auto already covers the groove
  // and both parts; the instruments have no Auto, so this is how you get them.
  const fit = partsForSong(genre, mood, tempo);
  const fitted = s.instrument === fit.instrument
    && s.bassInstrument === fit.bassInstrument
    && s.groove === 'auto' && s.bassStyle === 'auto' && s.compStyle === 'auto';
  const fitSummary = [
    `${INSTRUMENTS[fit.instrument]?.label} — ${COMP_STYLES[fit.compStyle]?.label?.toLowerCase()}`,
    `${BASS_INSTRUMENTS[fit.bassInstrument]?.label?.toLowerCase()} — ${BASS_STYLES[fit.bassStyle]?.label?.toLowerCase()}`,
  ].join('; ');

  const fitToSong = () => applyMany({
    instrument: fit.instrument,
    bassInstrument: fit.bassInstrument,
    groove: 'auto',
    bassStyle: 'auto',
    compStyle: 'auto',
  });

  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-white/[0.07]',
        'bg-ink-950/30 px-5 py-3 sm:px-6',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <MiniSelect
        label="Sound"
        value={s.instrument}
        disabled={loading === 'instrument' || loading === 'many'}
        title={INSTRUMENTS[s.instrument]?.hint}
        onChange={(e) => pick('instrument', e.target.value)}
      >
        {Object.entries(INSTRUMENTS).map(([key, def]) => (
          <option key={key} value={key}>{def.label}</option>
        ))}
      </MiniSelect>

      <MiniSelect
        label="Groove"
        value={s.groove}
        title={s.groove === 'auto'
          ? `Auto — currently ${GROOVES[activeGroove]?.label}. ${GROOVES[activeGroove]?.hint ?? ''}`
          : GROOVES[s.groove]?.hint}
        onChange={(e) => s.set({ groove: e.target.value })}
      >
        <option value="auto">
          Auto ({GROOVES[activeGroove]?.label ?? activeGroove})
        </option>
        {Object.entries(GROOVES).map(([key, def]) => (
          <option key={key} value={key}>{def.label}</option>
        ))}
      </MiniSelect>

      <MiniSelect
        label="Drums"
        value={s.drumKit}
        disabled={loading === 'kit'}
        title={DRUM_KITS[s.drumKit]?.hint}
        onChange={(e) => pick('kit', e.target.value)}
      >
        {Object.entries(DRUM_KITS).map(([key, def]) => (
          <option key={key} value={key}>{def.label}</option>
        ))}
      </MiniSelect>

      <button
        type="button"
        onClick={() => s.set({ metronome: !s.metronome })}
        title="Click on every beat, accented on the first"
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition-colors',
          s.metronome
            ? 'border-accent/50 bg-accent/15 text-accent-soft'
            : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200',
        )}
      >
        <Icon.Metronome className="h-3.5 w-3.5" />
        Click
      </button>

      <button
        type="button"
        onClick={() => setShowParts((v) => !v)}
        title="Bass and guitar parts"
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition-colors',
          showParts
            ? 'border-accent/50 bg-accent/15 text-accent-soft'
            : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200',
        )}
      >
        Parts
        <Icon.ChevronDown className={cx('h-3 w-3 transition-transform', showParts && 'rotate-180')} />
      </button>

      {loading && (
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Spinner className="h-3 w-3" /> Loading samples…
        </span>
      )}

      <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-slate-600 lg:flex">
        <Icon.Settings className="h-3 w-3" />
        Levels in Settings
      </span>

      {showParts && (
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-white/[0.07] pt-3">
          <MiniSelect
            label="Bass"
            value={s.bassInstrument}
            disabled={loading === 'bass' || loading === 'many'}
            title={BASS_INSTRUMENTS[s.bassInstrument]?.hint}
            onChange={(e) => pick('bass', e.target.value)}
          >
            {Object.entries(BASS_INSTRUMENTS).map(([key, def]) => (
              <option key={key} value={key}>{def.label}</option>
            ))}
          </MiniSelect>

          <MiniSelect
            label="Bass part"
            value={s.bassStyle}
            title={s.bassStyle === 'auto'
              ? `Auto — ${BASS_STYLES[autoBass]?.label} for ${genre || 'this song'}${mood ? `, ${mood.toLowerCase()}` : ''}. ${BASS_STYLES[autoBass]?.hint ?? ''}`
              : BASS_STYLES[s.bassStyle]?.hint}
            onChange={(e) => s.set({ bassStyle: e.target.value })}
          >
            {Object.entries(BASS_STYLES).map(([key, def]) => (
              <option key={key} value={key}>
                {key === 'auto' ? `Auto (${BASS_STYLES[autoBass]?.label ?? autoBass})` : def.label}
              </option>
            ))}
          </MiniSelect>

          <MiniSelect
            label="Chord part"
            value={s.compStyle}
            title={s.compStyle === 'auto'
              ? `Auto — ${COMP_STYLES[autoComp]?.label} for ${genre || 'this song'}${mood ? `, ${mood.toLowerCase()}` : ''}. ${COMP_STYLES[autoComp]?.hint ?? ''}`
              : COMP_STYLES[s.compStyle]?.hint}
            onChange={(e) => s.set({ compStyle: e.target.value })}
          >
            {Object.entries(COMP_STYLES).map(([key, def]) => (
              <option key={key} value={key}>
                {key === 'auto' ? `Auto (${COMP_STYLES[autoComp]?.label ?? autoComp})` : def.label}
              </option>
            ))}
          </MiniSelect>

          <button
            type="button"
            onClick={fitToSong}
            disabled={fitted || Boolean(loading)}
            title={fitted
              ? 'Already set up for this song\u2019s genre and mood.'
              : `Switch to what ${genre || 'this song'}${mood ? ` (${mood.toLowerCase()})` : ''} calls for: ${fitSummary}.`}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition-colors',
              'border-accent/40 text-accent-soft hover:border-accent/70 hover:bg-accent/10',
              'disabled:cursor-default disabled:border-white/10 disabled:bg-transparent disabled:text-slate-500',
            )}
          >
            <Icon.Sparkles className="h-3.5 w-3.5" />
            {fitted ? 'Fitted to song' : 'Fit to song'}
          </button>

          <p className="w-full text-[10.5px] leading-relaxed text-slate-600">
            {fitted
              ? `Set up for ${genre || 'this song'}${mood ? `, ${mood.toLowerCase()}` : ''}: ${fitSummary}. Quiet sections thin out, choruses fill in, and long sections end on a fill.`
              : `Auto parts follow the genre and mood. Fit to song also picks the instruments: ${fitSummary}.`}
          </p>
        </div>
      )}
    </div>
  );
}
