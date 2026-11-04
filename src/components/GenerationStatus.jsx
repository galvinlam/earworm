/**
 * GenerationStatus.jsx
 * ---------------------------------------------------------------------------
 * Loading and error surfaces.
 *
 * While streaming we show the raw text arriving. That is deliberate: a song
 * takes 10-30 seconds to write, and watching lines land is both reassuring and
 * genuinely interesting, where a spinner is neither.
 */

import React, { useEffect, useRef } from 'react';
import { Button, cx } from './ui.jsx';
import * as Icon from './icons.jsx';
import Logo from './Logo.jsx';

/** Pull readable fragments out of partial JSON so the stream looks like a song. */
function previewFromStream(text) {
  if (!text) return '';
  const lines = [];

  const title = /"title"\s*:\s*"([^"]{1,80})/.exec(text);
  if (title) lines.push(title[1]);

  // Each lyrics field, including the one still being written.
  const lyricMatches = text.matchAll(/"lyrics"\s*:\s*"((?:[^"\\]|\\.)*)/g);
  for (const m of lyricMatches) {
    const decoded = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    lines.push(decoded);
  }

  return lines.join('\n\n').slice(-1200);
}

export function GenerationOverlay({ status, onCancel }) {
  const scrollRef = useRef(null);
  const preview = previewFromStream(status.streamText);

  // Keep the newest text in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [preview]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-accent" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <p className="flex-1 text-sm text-slate-200">
          {status.stage || 'Working'}
          <span className="ml-1 text-slate-500">…</span>
        </p>
        <Button variant="ghost" size="xs" onClick={onCancel}>Cancel</Button>
      </div>

      {preview ? (
        <div
          ref={scrollRef}
          className="max-h-72 overflow-y-auto px-5 py-4 font-display text-[17px] leading-relaxed text-slate-300"
        >
          <p className="whitespace-pre-wrap">{preview}</p>
          <span className="ml-0.5 inline-block h-5 w-[2px] translate-y-1 animate-pulse bg-accent" />
        </div>
      ) : (
        <div className="space-y-2.5 px-5 py-5">
          {[90, 72, 84, 60].map((w, i) => (
            <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorPanel({ status, onDismiss, onOpenSettings, onRetry }) {
  const isConfigError = status.kind === 'config' || status.kind === 'auth';

  return (
    <div className="panel animate-fade-up border-rose/25 bg-rose/[0.04] px-5 py-4">
      <div className="flex items-start gap-3">
        <Icon.Warning className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rose">{status.message}</p>
          {status.advice && (
            <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{status.advice}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {isConfigError && (
              <Button size="xs" variant="secondary" onClick={onOpenSettings}>
                <Icon.Settings className="h-3 w-3" /> Open settings
              </Button>
            )}
            {onRetry && (
              <Button size="xs" variant="secondary" onClick={onRetry}>
                <Icon.Refresh className="h-3 w-3" /> Try again
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shown before the first generation. */
export function EmptyState({ configured, onOpenSettings }) {
  return (
    <div className="panel flex min-h-[26rem] flex-col items-center justify-center px-8 py-16 text-center">
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-accent/20 blur-2xl" />
        <Logo size={52} className="relative" />
      </div>

      <h2 className="font-display text-3xl text-white text-balance">
        Start with an idea. Leave with a song.
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400 text-balance">
        Earworm writes lyrics, a chord progression and a melodic contour for every section —
        then lets you play it, edit it, lock what works and rewrite the rest.
      </p>

      <ul className="mt-8 grid max-w-lg gap-3 text-left sm:grid-cols-3">
        {[
          { title: 'Structured', body: 'Sections, chords per bar, and a singable contour — not a wall of text.' },
          { title: 'Playable', body: 'Hear any section in the browser. Export MIDI straight into your DAW.' },
          { title: 'Iterative', body: 'Lock the chorus you love and regenerate everything around it.' },
        ].map((item) => (
          <li key={item.title} className="rounded-xl border border-white/[0.07] bg-ink-850/40 px-3.5 py-3">
            <p className="text-[12px] font-semibold text-slate-200">{item.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{item.body}</p>
          </li>
        ))}
      </ul>

      {!configured && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className={cx(
              'inline-flex items-center gap-2 rounded-xl border border-amber-glow/30',
              'bg-amber-glow/[0.07] px-4 py-2.5 text-[13px] text-amber-glow transition-colors hover:bg-amber-glow/[0.12]',
            )}
          >
            <Icon.Settings className="h-4 w-4" />
            Add an API key to begin
          </button>
          <p className="max-w-sm text-[11px] leading-relaxed text-slate-500">
            It is set up for free models by default — an OpenRouter key costs nothing and
            its free model ids end in <code className="font-mono text-slate-400">:free</code>.
            The key stays in this browser.
          </p>
        </div>
      )}
    </div>
  );
}
