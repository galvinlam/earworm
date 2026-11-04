/**
 * ChordDiagram.jsx — a small SVG fretboard for one chord.
 * Renders nothing when no sensible shape exists, rather than guessing.
 */

import React, { useMemo } from 'react';
import { guitarVoicing } from '../lib/guitar.js';

const STRINGS = 6;
const FRETS = 5;

export default function ChordDiagram({ symbol, width = 76 }) {
  const voicing = useMemo(() => guitarVoicing(symbol), [symbol]);
  if (!voicing) return null;

  const { frets, baseFret, barre } = voicing;

  const padX = 8;
  const padTop = 16;
  const gridW = width - padX * 2;
  const stringGap = gridW / (STRINGS - 1);
  const fretGap = 15;
  const gridH = fretGap * FRETS;
  const height = padTop + gridH + 12;

  const xFor = (stringIndex) => padX + stringIndex * stringGap;
  const yForFret = (fret) => padTop + (fret - baseFret + 0.5) * fretGap;

  // A barre is only drawn when it is inside the visible window.
  const barreVisible = barre !== null && barre >= baseFret && barre < baseFret + FRETS;
  const barreStrings = barreVisible
    ? frets.map((f, i) => (f === barre ? i : -1)).filter((i) => i !== -1)
    : [];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-slate-500"
      role="img"
      aria-label={`${symbol} guitar chord diagram`}
    >
      {/* Nut, drawn thick only when the window starts at fret 1. */}
      {baseFret === 1 ? (
        <rect x={padX} y={padTop - 3} width={gridW} height={3} rx={1} fill="currentColor" opacity="0.85" />
      ) : (
        <text x={padX - 2} y={padTop + 10} fontSize="8" fill="currentColor" textAnchor="end">
          {baseFret}
        </text>
      )}

      {/* Frets */}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line
          key={`f${i}`}
          x1={padX}
          y1={padTop + i * fretGap}
          x2={padX + gridW}
          y2={padTop + i * fretGap}
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.28"
        />
      ))}

      {/* Strings */}
      {Array.from({ length: STRINGS }, (_, i) => (
        <line
          key={`s${i}`}
          x1={xFor(i)}
          y1={padTop}
          x2={xFor(i)}
          y2={padTop + gridH}
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.35"
        />
      ))}

      {/* Barre */}
      {barreStrings.length > 1 && (
        <rect
          x={xFor(barreStrings[0]) - 4}
          y={yForFret(barre) - 4}
          width={xFor(barreStrings[barreStrings.length - 1]) - xFor(barreStrings[0]) + 8}
          height={8}
          rx={4}
          className="fill-amber-glow"
          opacity="0.9"
        />
      )}

      {/* Open / muted markers above the nut, and fingered dots */}
      {frets.map((fret, i) => {
        const x = xFor(i);
        if (fret === -1) {
          return (
            <g key={`m${i}`} stroke="currentColor" strokeWidth="1.3" opacity="0.6">
              <line x1={x - 3} y1={padTop - 11} x2={x + 3} y2={padTop - 5} />
              <line x1={x - 3} y1={padTop - 5} x2={x + 3} y2={padTop - 11} />
            </g>
          );
        }
        if (fret === 0) {
          return (
            <circle key={`o${i}`} cx={x} cy={padTop - 8} r={3} fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.65" />
          );
        }
        if (fret === barre && barreStrings.length > 1) return null; // covered by the barre
        if (fret < baseFret || fret >= baseFret + FRETS) return null;
        return <circle key={`d${i}`} cx={x} cy={yForFret(fret)} r={4.2} className="fill-amber-glow" />;
      })}
    </svg>
  );
}
