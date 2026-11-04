/**
 * SongForm.jsx — the brief. Everything the model needs before it writes.
 */

import React, { useState } from 'react';
import { useSongStore, GENRES, MOODS } from '../store/useSongStore.js';
import { KEY_OPTIONS } from '../lib/musicTheory.js';
import { STRUCTURE_OPTIONS, STRUCTURE_PRESETS } from '../prompts/songPrompts.js';
import { Button, Field, Select, TextArea, TextInput, Slider, cx } from './ui.jsx';
import * as Icon from './icons.jsx';

/** A few starters so the empty state is never a blank page. */
const SEEDS = [
  'The last train home after a conversation that went wrong',
  'Two friends who only speak in August',
  'A town that keeps the lights on for someone who left',
  'Learning to cook the way my mother did, badly',
  'The hour before a storm, waiting on a porch',
];

export default function SongForm({ onGenerate, generating, onCancel, configured, online = true, onOpenSettings }) {
  const { form, setForm } = useSongStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const usingCustomGenre = form.genre === '__custom';
  const sectionPreview = STRUCTURE_PRESETS[form.structure] || [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!generating) onGenerate();
      }}
      className="space-y-4"
    >
      <Field label="Song idea, theme or seed lyric">
        <TextArea
          rows={4}
          value={form.idea}
          onChange={(e) => setForm({ idea: e.target.value })}
          placeholder="A line, an image, a situation — anything to write toward."
        />
      </Field>

      <div className="flex flex-wrap gap-1.5">
        {SEEDS.map((seed) => (
          <button
            key={seed}
            type="button"
            onClick={() => setForm({ idea: seed })}
            className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-left text-[11px] leading-tight
                       text-slate-500 transition-colors hover:border-accent/40 hover:text-accent-soft"
          >
            {seed.length > 38 ? `${seed.slice(0, 36)}…` : seed}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Genre">
          <Select
            value={usingCustomGenre ? '__custom' : form.genre}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '__custom') setForm({ genre: '__custom' });
              else setForm({ genre: value, customGenre: '' });
            }}
          >
            {GENRES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            <option value="__custom">Custom…</option>
          </Select>
        </Field>

        <Field label="Key">
          <Select value={form.key} onChange={(e) => setForm({ key: e.target.value })}>
            {KEY_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
        </Field>
      </div>

      {usingCustomGenre && (
        <div className="animate-fade-up">
          <TextInput
            autoFocus
            value={form.customGenre}
            onChange={(e) => setForm({ customGenre: e.target.value })}
            placeholder="e.g. Shoegaze, Afrobeat, Bossa nova…"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Mood">
          <Select value={form.mood} onChange={(e) => setForm({ mood: e.target.value })}>
            {MOODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </Field>

        <div className="pt-0.5">
          <Slider
            label="Tempo"
            min={50}
            max={190}
            step={2}
            value={form.tempo}
            display={`${form.tempo} BPM`}
            onChange={(e) => setForm({ tempo: Number(e.target.value) })}
          />
          <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">
            {form.tempo < 76 ? 'Ballad' : form.tempo < 100 ? 'Mid' : form.tempo < 130 ? 'Driving' : 'Fast'}
          </p>
        </div>
      </div>

      <Field label="Structure">
        <Select value={form.structure} onChange={(e) => setForm({ structure: e.target.value })}>
          {STRUCTURE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </Field>

      {sectionPreview.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-600">
          {sectionPreview.map((s, i) => (
            <React.Fragment key={`${s}-${i}`}>
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono">{s}</span>
              {i < sectionPreview.length - 1 && <span className="text-slate-700">→</span>}
            </React.Fragment>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="ghost-btn -ml-2.5"
      >
        <Icon.ChevronDown className={cx('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180')} />
        Extra direction
      </button>

      {showAdvanced && (
        <div className="animate-fade-up">
          <TextArea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ notes: e.target.value })}
            placeholder="Reference artists, a rhyme scheme to follow, a word to avoid, an instrument to write for…"
          />
        </div>
      )}

      <div className="pt-1">
        {generating ? (
          <Button variant="secondary" size="lg" className="w-full" onClick={onCancel}>
            <Icon.Stop className="h-4 w-4" /> Cancel
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!configured || !online}
          >
            <Icon.Sparkles className="h-4 w-4" />
            Generate song
          </Button>
        )}

        {!online && (
          <p className="mt-2.5 rounded-lg border border-amber-glow/25 bg-amber-glow/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber-glow">
            You are offline, so there is no model to write with. Your saved songs still
            play, edit and export — generating will work again when you reconnect.
          </p>
        )}

        {!configured && online && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg
                       border border-amber-glow/25 bg-amber-glow/[0.07] px-3 py-2
                       text-[12px] text-amber-glow transition-colors hover:bg-amber-glow/[0.12]"
          >
            <Icon.Warning className="h-3.5 w-3.5" />
            Add an API key — free ones work
          </button>
        )}
      </div>
    </form>
  );
}
