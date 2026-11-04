/**
 * SettingsPanel.jsx
 * ---------------------------------------------------------------------------
 * API connection, model choice, generation knobs, playback and data clearing.
 *
 * The key lives in localStorage and goes nowhere except the Authorization
 * header of this browser's own requests — the panel says so, plainly, because
 * "paste your API key here" deserves an explanation.
 */

import React, { useState } from 'react';
import { useSettingsStore, SUGGESTED_MODELS, PRESET_ENDPOINTS } from '../store/useSettingsStore.js';
import { useSongStore } from '../store/useSongStore.js';
import { listModels, isFreeModelId, LLMError } from '../lib/llmClient.js';
import {
  setVolume,
  setDrumLevel,
  INSTRUMENTS,
  BASS_INSTRUMENTS,
  DRUM_KITS,
} from '../lib/audioEngine.js';
import { useSoundPicker } from '../hooks/useSoundPicker.js';
import { GROOVES } from '../lib/groove.js';
import { toast } from '../store/useToastStore.js';
import { Modal, Button, Field, Select, TextInput, Slider, Toggle, Divider, Spinner, cx } from './ui.jsx';
import * as Icon from './icons.jsx';

export default function SettingsPanel({ open, onClose }) {
  const s = useSettingsStore();
  const { clearHistory, clearAll, history } = useSongStore();

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const { pick, loading: loadingSound } = useSoundPicker();

  /** Hit /models — proves the key and URL work, and fills the model list. */
  const testConnection = async () => {
    setTesting(true);
    try {
      const models = await listModels({ baseUrl: s.baseUrl, apiKey: s.apiKey });
      s.setDiscoveredModels(models);
      const free = models.filter(isFreeModelId).length;
      toast.success(
        models.length
          ? `Connected — ${models.length} models${free ? `, ${free} of them free` : ''}.`
          : 'Connected, but the endpoint listed no models.',
      );
      // A provider with no free ids makes the filter a trap, so drop it.
      if (models.length && !free && s.freeOnly) {
        s.set({ freeOnly: false });
      }

      // If the saved model is not on the list, it has been retired. Replace it
      // here rather than letting the next generate fail.
      if (models.length && !models.includes(s.model)) {
        const pool = s.freeOnly ? models.filter(isFreeModelId) : models;
        const replacement = pool[0] || models[0];
        if (replacement) {
          s.set({ model: replacement });
          toast.info(`"${s.model}" is no longer served — switched to ${replacement}.`);
        }
      }
    } catch (err) {
      const message = err instanceof LLMError ? err.message : 'Could not reach the endpoint.';
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const modelOptions = s.discoveredModels.length ? s.discoveredModels : SUGGESTED_MODELS;
  const visibleModels = s.freeOnly ? modelOptions.filter(isFreeModelId) : modelOptions;
  const modelIsListed = visibleModels.includes(s.model);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="Stored in this browser only. Nothing is sent to a Earworm server — there isn't one."
      footer={<Button variant="primary" size="sm" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-6">
        {/* ------------------- connection ------------------- */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            API connection
          </h3>

          <Field
            label="API key"
            hint="Kept in localStorage on this device and sent only to the base URL below. Clearing site data removes it."
          >
            <div className="relative">
              <TextInput
                type={showKey ? 'text' : 'password'}
                value={s.apiKey}
                onChange={(e) => s.set({ apiKey: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                className="pr-16 font-mono text-[13px]"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px]
                           text-slate-500 transition-colors hover:text-slate-200"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Field label="Base URL" hint="Any OpenAI-compatible endpoint. Local servers must allow this origin via CORS.">
            <TextInput
              value={s.baseUrl}
              onChange={(e) => s.set({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {PRESET_ENDPOINTS.map((preset) => (
              <button
                key={preset.url}
                type="button"
                title={preset.note}
                onClick={() => s.set({ baseUrl: preset.url })}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                  s.baseUrl === preset.url
                    ? 'border-accent/50 bg-accent/10 text-accent-soft'
                    : 'border-white/10 text-slate-500 hover:border-white/25 hover:text-slate-300',
                )}
              >
                {/* A dot for whether a browser can call it at all: that, not the
                    key or the model, is what usually breaks. */}
                <span
                  className={cx(
                    'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                    preset.browser === 'ok' && 'bg-mint',
                    preset.browser === 'flag' && 'bg-amber-glow',
                    preset.browser === 'proxy' && 'bg-rose',
                    preset.browser === 'unknown' && 'bg-slate-600',
                  )}
                />
                {preset.label}
                {preset.free && <span className="text-[9px] uppercase tracking-wider opacity-60">free</span>}
              </button>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            The dot is whether a browser can call it directly:
            <span className="text-mint"> works</span>,
            <span className="text-amber-glow"> needs a flag on your own server</span>,
            <span className="text-rose"> blocked — run </span>
            <code className="rounded bg-ink-800 px-1 font-mono text-[10px]">node tools/cors-proxy.mjs</code>,
            <span className="text-slate-400"> unverified</span>. Providers change this without notice, so
            <strong className="font-medium text-slate-400"> Test</strong> is the real answer.
            {' '}{PRESET_ENDPOINTS.find((x) => x.url === s.baseUrl)?.note}
          </p>

          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Model">
              <Select value={s.model} onChange={(e) => s.set({ model: e.target.value })}>
                {!modelIsListed && s.model && <option value={s.model}>{s.model} (current)</option>}
                {visibleModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Button size="md" onClick={testConnection} loading={testing}>
              Test
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Toggle
              checked={s.freeOnly}
              onChange={(v) => s.set({ freeOnly: v })}
              label="Free models only"
              hint='Shows ids ending in ":free" — the only free marker any provider publishes. Press Test to load your key\u2019s real list.'
            />
          </div>

          {s.freeOnly && !visibleModels.length && (
            <p className="rounded-xl border border-amber-glow/25 bg-amber-glow/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-glow">
              No free ids in this list. Either this provider does not label free models,
              or it has none — turn the filter off to see everything.
            </p>
          )}

          <Field label="Or type a model id">
            <TextInput
              value={s.model}
              onChange={(e) => s.set({ model: e.target.value })}
              placeholder="gpt-4o-mini"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
          </Field>
        </section>

        <Divider />

        {/* ------------------- generation ------------------- */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Generation
          </h3>

          <Slider
            label="Temperature"
            min={0}
            max={1.4}
            step={0.05}
            value={s.temperature}
            display={s.temperature.toFixed(2)}
            onChange={(e) => s.set({ temperature: Number(e.target.value) })}
          />
          <p className="-mt-1 text-[11px] text-slate-500">
            Low is predictable and on-brief; high is surprising and less reliable. Around 0.9 suits lyrics.
          </p>

          <Slider
            label="Response limit"
            min={1000}
            max={8000}
            step={500}
            value={s.maxTokens}
            display={`${s.maxTokens} tokens`}
            onChange={(e) => s.set({ maxTokens: Number(e.target.value) })}
          />
          <p className="-mt-1 text-[11px] leading-relaxed text-slate-500">
            Some providers cap completions low enough to cut a song off mid-section.
            A truncated reply still produces a partial song rather than an error.
          </p>

          <Toggle
            checked={s.jsonMode}
            onChange={(v) => s.set({ jsonMode: v })}
            label="Force JSON mode"
            hint="Sends response_format: json_object. If the model rejects it, Earworm turns this off and retries automatically — you do not have to."
          />
          <Toggle
            checked={s.streaming}
            onChange={(v) => s.set({ streaming: v })}
            label="Stream responses"
            hint="Shows the draft arriving live. Turn off if your endpoint does not support server-sent events."
          />
        </section>

        <Divider />

        {/* ------------------- playback ------------------- */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Playback
          </h3>

          <Field label="Instrument" hint={INSTRUMENTS[s.instrument]?.hint}>
            <Select
              value={s.instrument}
              disabled={loadingSound === 'instrument'}
              onChange={(e) => pick('instrument', e.target.value)}
            >
              {Object.entries(INSTRUMENTS).map(([key, def]) => (
                <option key={key} value={key}>{def.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Bass" hint={BASS_INSTRUMENTS[s.bassInstrument]?.hint}>
            <Select
              value={s.bassInstrument}
              disabled={loadingSound === 'bass'}
              onChange={(e) => pick('bass', e.target.value)}
            >
              {Object.entries(BASS_INSTRUMENTS).map(([key, def]) => (
                <option key={key} value={key}>{def.label}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Groove"
            hint={
              s.groove === 'auto'
                ? 'Chosen from the song\u2019s genre and tempo. Sets what the drums, bass and chords play.'
                : GROOVES[s.groove]?.hint
            }
          >
            <Select value={s.groove} onChange={(e) => s.set({ groove: e.target.value })}>
              <option value="auto">Auto — from genre and tempo</option>
              {Object.entries(GROOVES).map(([key, def]) => (
                <option key={key} value={key}>{def.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Drums" hint={DRUM_KITS[s.drumKit]?.hint}>
            <Select
              value={s.drumKit}
              disabled={loadingSound === 'kit'}
              onChange={(e) => pick('kit', e.target.value)}
            >
              {Object.entries(DRUM_KITS).map(([key, def]) => (
                <option key={key} value={key}>{def.label}</option>
              ))}
            </Select>
          </Field>

          {loadingSound && (
            <p className="flex items-center gap-2 text-[11px] text-slate-400">
              <Spinner className="h-3 w-3" /> Downloading samples…
            </p>
          )}

          {s.drumKit !== 'off' && (
            <Slider
              label="Drum level"
              min={-30}
              max={6}
              step={1}
              value={s.drumLevelDb}
              display={`${s.drumLevelDb > 0 ? '+' : ''}${s.drumLevelDb} dB`}
              onChange={(e) => {
                const db = Number(e.target.value);
                s.set({ drumLevelDb: db });
                setDrumLevel(db);
              }}
            />
          )}

          <Toggle
            checked={s.metronome}
            onChange={(v) => s.set({ metronome: v })}
            label="Metronome click"
            hint="A click on every beat, accented on the first. Independent of the drums \u2014 you can have either, both or neither."
          />

          <Field label="What to play">
            <Select value={s.playbackMode} onChange={(e) => s.set({ playbackMode: e.target.value })}>
              <option value="both">Chords + melody</option>
              <option value="chords">Chords only</option>
              <option value="melody">Melody only</option>
            </Select>
          </Field>

          <Slider
            label="Volume"
            min={-40}
            max={0}
            step={1}
            value={s.volumeDb}
            display={`${s.volumeDb} dB`}
            onChange={(e) => {
              const db = Number(e.target.value);
              s.set({ volumeDb: db });
              setVolume(db);
            }}
          />

          <p className="text-[10.5px] leading-relaxed text-slate-600">
            Samples: guitars, basses and electric piano from the Musyng Kite soundfont via{' '}
            <a
              href="https://github.com/gleitz/midi-js-soundfonts"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-slate-700 underline-offset-2 hover:text-slate-400"
            >
              midi-js-soundfonts
            </a>{' '}
            (CC BY-SA 3.0); Salamander Grand Piano by Alexander Holm (CC BY 3.0). Fetched the first
            time each plays, then kept for offline use.
          </p>
        </section>

        <Divider />

        {/* ------------------- data ------------------- */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Stored data
          </h3>
          <p className="text-[12px] leading-relaxed text-slate-500">
            Earworm keeps your current draft, {history.length} saved version
            {history.length === 1 ? '' : 's'} and your settings in this browser's localStorage.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                clearHistory();
                toast.info('Version history cleared.');
              }}
              disabled={!history.length}
            >
              <Icon.History className="h-3.5 w-3.5" /> Clear history
            </Button>

            <Button size="sm" onClick={() => { s.resetSettings(); toast.info('Settings reset.'); }}>
              Reset settings
            </Button>

            {confirmWipe ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    clearAll();
                    setConfirmWipe(false);
                    onClose?.();
                    toast.info('Draft, history and form cleared.');
                  }}
                >
                  Yes, erase the draft
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmWipe(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmWipe(true)}>
                <Icon.Trash className="h-3.5 w-3.5" /> Erase everything
              </Button>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
