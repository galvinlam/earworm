/**
 * SectionCard.jsx
 * ---------------------------------------------------------------------------
 * One song section: chart, playback, inline editing, lock, regenerate and the
 * quick-rewrite buttons.
 *
 * Editing is local-state-first — the store is only written on blur/save, so
 * typing never re-renders the whole song.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSongStore } from '../store/useSongStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { QUICK_REWRITES } from '../prompts/songPrompts.js';
import { playSection, stopPlayback, previewChord } from '../lib/audioEngine.js';
import { resolveGroove } from '../lib/groove.js';
import { toast } from '../store/useToastStore.js';
import LyricSheet from './LyricSheet.jsx';
import ChordDiagram from './ChordDiagram.jsx';
import { Button, Badge, TextArea, TextInput, cx, Spinner } from './ui.jsx';
import * as Icon from './icons.jsx';

const TYPE_TONE = {
  Chorus: 'accent',
  Hook: 'accent',
  'Final Chorus': 'accent',
  Bridge: 'amber',
  'Pre-Chorus': 'amber',
  Intro: 'neutral',
  Outro: 'neutral',
};

export default function SectionCard({ section, index, songKey, tempo, genre, mood, onRegenerate, readOnly }) {
  const { updateSection, toggleLock, moveSection, removeSection, busySections } = useSongStore();
  const playbackMode = useSettingsStore((s) => s.playbackMode);
  const instrument = useSettingsStore((s) => s.instrument);
  const drumKit = useSettingsStore((s) => s.drumKit);
  const bassInstrument = useSettingsStore((s) => s.bassInstrument);
  const bassStyle = useSettingsStore((s) => s.bassStyle);
  const compStyle = useSettingsStore((s) => s.compStyle);
  const grooveSetting = useSettingsStore((s) => s.groove);
  const metronome = useSettingsStore((s) => s.metronome);

  const [editing, setEditing] = useState(false);
  const [draftLyrics, setDraftLyrics] = useState(section.lyrics);
  const [draftChords, setDraftChords] = useState(section.chords.join(' | '));
  const [draftContour, setDraftContour] = useState(section.melodyContour.join(' '));
  const [draftLabel, setDraftLabel] = useState(section.label);
  const [playingBar, setPlayingBar] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDiagrams, setShowDiagrams] = useState(false);
  const [showRewrites, setShowRewrites] = useState(false);

  const busy = busySections.includes(section.id);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Pull fresh content in when a regenerate replaces this section underneath us.
  useEffect(() => {
    if (editing) return;
    setDraftLyrics(section.lyrics);
    setDraftChords(section.chords.join(' | '));
    setDraftContour(section.melodyContour.join(' '));
    setDraftLabel(section.label);
  }, [section.lyrics, section.chords, section.melodyContour, section.label, editing]);

  // --- playback ------------------------------------------------------------

  const handlePlay = async () => {
    if (isPlaying) {
      stopPlayback();
      setIsPlaying(false);
      setPlayingBar(-1);
      return;
    }
    if (!section.chords.length && !section.melodyContour.length) {
      toast.info('This section has no chords or melody to play yet.');
      return;
    }
    setIsPlaying(true);
    try {
      await playSection({
        section,
        key: songKey,
        tempo,
        mode: playbackMode,
        instrument,
        drumKit,
        bassInstrument,
        bassStyle,
        compStyle,
        genre,
        mood,
        metronome,
        grooveId: resolveGroove(grooveSetting, genre, tempo),
        onBar: (bar) => mountedRef.current && setPlayingBar(bar),
        onEnd: () => {
          if (!mountedRef.current) return;
          setIsPlaying(false);
          setPlayingBar(-1);
        },
      });
    } catch (err) {
      setIsPlaying(false);
      toast.error(err?.message || 'Playback failed — your browser may have blocked audio.');
    }
  };

  // Stop this card's audio if it unmounts mid-play.
  useEffect(() => () => { if (isPlaying) stopPlayback(); }, [isPlaying]);

  // --- editing -------------------------------------------------------------

  const saveEdits = () => {
    updateSection(section.id, {
      label: draftLabel.trim() || section.label,
      lyrics: draftLyrics,
      chords: draftChords.split(/[|,\n]/).map((c) => c.trim()).filter(Boolean),
      melodyContour: draftContour.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean),
    });
    setEditing(false);
    toast.success(`${draftLabel.trim() || section.label} updated.`);
  };

  const cancelEdits = () => {
    setDraftLyrics(section.lyrics);
    setDraftChords(section.chords.join(' | '));
    setDraftContour(section.melodyContour.join(' '));
    setDraftLabel(section.label);
    setEditing(false);
  };

  const barCount = section.chords.length;
  const uniqueChords = [...new Set(section.chords)];

  return (
    <article
      id={`section-${section.id}`}
      className={cx(
        'panel group relative scroll-mt-24 overflow-hidden transition-all duration-200',
        section.locked && 'border-amber-glow/25',
        busy && 'opacity-70',
      )}
    >
      {/* Locked sections get a hairline down the left edge. */}
      {section.locked && <div className="absolute inset-y-0 left-0 w-0.5 bg-amber-glow/60" />}

      {/* ---------------- header ---------------- */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <span className="font-mono text-[11px] text-slate-600">{String(index + 1).padStart(2, '0')}</span>

        {editing ? (
          <TextInput
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="max-w-[12rem] py-1 text-sm"
            aria-label="Section label"
          />
        ) : (
          <h3 className="font-display text-xl leading-none text-white">{section.label}</h3>
        )}

        <Badge tone={TYPE_TONE[section.type] || 'neutral'}>{section.type}</Badge>
        {barCount > 0 && (
          <span className="font-mono text-[11px] text-slate-500">{barCount} bars</span>
        )}
        {section.locked && <Badge tone="amber">Locked</Badge>}

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={handlePlay}
            title={isPlaying ? 'Stop' : 'Play this section'}
            className={cx(
              'relative rounded-lg p-2 transition-colors',
              isPlaying ? 'bg-accent/20 text-accent-soft' : 'text-slate-400 hover:bg-white/[0.06] hover:text-white',
            )}
          >
            {isPlaying ? <Icon.Stop className="h-4 w-4" /> : <Icon.Play className="h-4 w-4" />}
          </button>

          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => toggleLock(section.id)}
                title={section.locked ? 'Unlock — full regenerate may rewrite this' : 'Lock — keep this through a full regenerate'}
                className={cx(
                  'rounded-lg p-2 transition-colors',
                  section.locked ? 'text-amber-glow hover:bg-amber-glow/10' : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200',
                )}
              >
                {section.locked ? <Icon.Lock className="h-4 w-4" /> : <Icon.Unlock className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => (editing ? saveEdits() : setEditing(true))}
                title={editing ? 'Save changes' : 'Edit lyrics and chords'}
                className={cx(
                  'rounded-lg p-2 transition-colors',
                  editing ? 'text-mint hover:bg-mint/10' : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-200',
                )}
              >
                {editing ? <Icon.Check className="h-4 w-4" /> : <Icon.Pencil className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => onRegenerate(section.id, '')}
                disabled={busy}
                title="Regenerate this section"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
              >
                {busy ? <Spinner className="h-4 w-4" /> : <Icon.Refresh className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div className="px-4 py-4 sm:px-5">
        {editing ? (
          <div className="space-y-3">
            <div>
              <span className="field-label">Chords — one per bar, separated by |</span>
              <TextInput
                value={draftChords}
                onChange={(e) => setDraftChords(e.target.value)}
                placeholder="G | Em | C | D"
                className="font-mono text-[13px]"
              />
            </div>
            <div>
              <span className="field-label">Lyrics</span>
              <TextArea
                rows={Math.max(4, draftLyrics.split('\n').length + 1)}
                value={draftLyrics}
                onChange={(e) => setDraftLyrics(e.target.value)}
                placeholder="One line per line."
              />
            </div>
            <div>
              <span className="field-label">Melody contour — scale degrees</span>
              <TextInput
                value={draftContour}
                onChange={(e) => setDraftContour(e.target.value)}
                placeholder="1 3 5 5^ b7 r"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="primary" size="sm" onClick={saveEdits}>
                <Icon.Check className="h-3.5 w-3.5" /> Save
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelEdits}>Cancel</Button>
              <div className="ml-auto flex gap-0.5">
                <button
                  type="button"
                  onClick={() => moveSection(section.id, -1)}
                  title="Move up"
                  className="ghost-btn px-2"
                >
                  <Icon.ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(section.id, 1)}
                  title="Move down"
                  className="ghost-btn px-2"
                >
                  <Icon.ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    removeSection(section.id);
                    toast.info(`${section.label} removed.`);
                  }}
                  title="Delete section"
                  className="ghost-btn px-2 hover:text-rose"
                >
                  <Icon.Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <LyricSheet
              section={section}
              playingBar={playingBar}
              onChordClick={(symbol) => previewChord(symbol, instrument).catch(() => {})}
            />

            {section.unknownChords?.length > 0 && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-rose/80">
                <Icon.Warning className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  Not recognised as chord symbols: {section.unknownChords.join(', ')}. They play as a
                  major triad on the root — edit them if that is wrong.
                </span>
              </p>
            )}

            {section.performanceNote && (
              <p className="mt-3 border-l-2 border-white/10 pl-3 text-[13px] italic leading-relaxed text-slate-400">
                {section.performanceNote}
              </p>
            )}

            {showDiagrams && uniqueChords.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3 border-t border-white/[0.07] pt-4">
                {uniqueChords.map((chord) => (
                  <figure key={chord} className="text-center">
                    <ChordDiagram symbol={chord} />
                    <figcaption className="-mt-1 font-mono text-[11px] text-amber-glow">{chord}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------------- quick rewrites ---------------- */}
      {!editing && !readOnly && (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.07] bg-ink-950/30 px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setShowRewrites((v) => !v)}
            className="ghost-btn"
          >
            <Icon.Sparkles className="h-3.5 w-3.5" />
            Rewrite
            <Icon.ChevronDown className={cx('h-3 w-3 transition-transform', showRewrites && 'rotate-180')} />
          </button>

          {showRewrites &&
            QUICK_REWRITES.map((rw) => (
              <button
                key={rw.id}
                type="button"
                disabled={busy}
                onClick={() => onRegenerate(section.id, rw.instruction)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400
                           transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent-soft
                           disabled:cursor-not-allowed disabled:opacity-40"
              >
                {rw.label}
              </button>
            ))}

          {uniqueChords.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDiagrams((v) => !v)}
              className={cx('ghost-btn ml-auto', showDiagrams && 'text-amber-glow')}
            >
              <Icon.Grid className="h-3.5 w-3.5" />
              {showDiagrams ? 'Hide shapes' : 'Chord shapes'}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
