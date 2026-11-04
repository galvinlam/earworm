/**
 * LyricSheet.jsx
 * ---------------------------------------------------------------------------
 * Renders one section as a chord chart: chord chips sitting above the lyric
 * line they belong to, with the sounding bar highlighted during playback.
 *
 * Chords are spread evenly across each line. We know how many bars a line
 * covers, not which syllable each change lands on, so even distribution is the
 * honest reading — it tells a player how many changes happen per line without
 * pretending to a precision the data doesn't have.
 */

import React, { useMemo } from 'react';
import { lyricLinesWithChords } from '../lib/layout.js';
import { parseChord } from '../lib/musicTheory.js';
import { cx } from './ui.jsx';

export default function LyricSheet({
  section,
  showChords = true,
  playingBar = -1,
  onChordClick,
}) {
  // Walk the lines once, tagging each chord with its absolute bar index so the
  // playhead can highlight the right chip.
  const lines = useMemo(() => {
    let bar = 0;
    return lyricLinesWithChords(section).map((line) => {
      const chords = line.chords.map((symbol) => ({ symbol, bar: bar++ }));
      return { ...line, chords };
    });
  }, [section]);

  if (!lines.length) {
    return (
      <p className="py-3 text-sm italic text-slate-600">
        No lyrics yet — regenerate this section, or type into it with the edit button.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <div key={i} className={cx(line.isBlank && !line.chords.length && 'h-3')}>
          {showChords && line.chords.length > 0 && (
            <div className="flex w-full select-none items-end gap-1 pb-0.5">
              {line.chords.map(({ symbol, bar }) => {
                const { valid } = parseChord(symbol);
                const active = bar === playingBar;
                return (
                  <button
                    key={bar}
                    type="button"
                    onClick={() => onChordClick?.(symbol)}
                    title={valid ? `Hear ${symbol}` : `${symbol} — not a chord symbol Earworm recognises`}
                    className={cx(
                      'chord-chip flex-1 justify-start truncate text-left',
                      'hover:bg-amber-glow/10',
                      active && 'bg-amber-glow/20 text-amber-glow ring-1 ring-amber-glow/40',
                      !valid && 'text-rose/80 decoration-rose/50 decoration-dotted underline underline-offset-2',
                    )}
                  >
                    {symbol}
                  </button>
                );
              })}
            </div>
          )}
          {line.text ? (
            <p className="text-[15px] leading-snug text-slate-200">{line.text}</p>
          ) : (
            !line.chords.length && null
          )}
        </div>
      ))}
    </div>
  );
}
