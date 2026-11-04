/**
 * SongView.jsx — the song itself: header, transport, and the section stack.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSongStore } from '../store/useSongStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { playSong, stopPlayback } from '../lib/audioEngine.js';
import { totalBars, totalWords } from '../lib/songSchema.js';
import { KEY_OPTIONS } from '../lib/musicTheory.js';
import { toast } from '../store/useToastStore.js';
import { resolveGroove } from '../lib/groove.js';
import SectionCard from './SectionCard.jsx';
import ExportMenu from './ExportMenu.jsx';
import ArrangementBar from './ArrangementBar.jsx';
import { Button, Badge, Select, TextInput, Slider, cx } from './ui.jsx';
import * as Icon from './icons.jsx';

export default function SongView({ onRegenerateSection, onRegenerateAll, generating }) {
  const { song, readOnly, updateSongMeta, addSection, setAllLocks } = useSongStore();
  const playbackMode = useSettingsStore((s) => s.playbackMode);
  const instrument = useSettingsStore((s) => s.instrument);
  const drumKit = useSettingsStore((s) => s.drumKit);
  const bassInstrument = useSettingsStore((s) => s.bassInstrument);
  const bassStyle = useSettingsStore((s) => s.bassStyle);
  const compStyle = useSettingsStore((s) => s.compStyle);
  const grooveSetting = useSettingsStore((s) => s.groove);
  const metronome = useSettingsStore((s) => s.metronome);

  const [playing, setPlaying] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(song?.title ?? '');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; stopPlayback(); }, []);
  useEffect(() => setTitleDraft(song?.title ?? ''), [song?.title]);

  if (!song) return null;

  const lockedCount = song.sections.filter((s) => s.locked).length;
  const groove = resolveGroove(grooveSetting, song.genre, song.tempo);
  const songGenre = song.genre;
  const songMood = song.mood;

  const handlePlayAll = async () => {
    if (playing) {
      stopPlayback();
      setPlaying(false);
      setActiveSection(null);
      return;
    }
    setPlaying(true);
    try {
      await playSong({
        sections: song.sections,
        key: song.key,
        tempo: song.tempo,
        mode: playbackMode,
        instrument,
        drumKit,
        bassInstrument,
        bassStyle,
        compStyle,
        genre: songGenre,
        mood: songMood,
        metronome,
        grooveId: groove,
        onPosition: (sectionId) => mounted.current && setActiveSection(sectionId),
        onEnd: () => {
          if (!mounted.current) return;
          setPlaying(false);
          setActiveSection(null);
        },
      });
    } catch (err) {
      setPlaying(false);
      toast.error(err?.message || 'Playback failed — your browser may have blocked audio.');
    }
  };

  const saveTitle = () => {
    updateSongMeta({ title: titleDraft.trim() || 'Untitled' });
    setEditingTitle(false);
  };

  return (
    <div className="space-y-4">
      {/* ------------------- song header ------------------- */}
      <header className="panel overflow-hidden">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              {editingTitle && !readOnly ? (
                <TextInput
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') { setTitleDraft(song.title); setEditingTitle(false); }
                  }}
                  className="font-display text-3xl"
                  aria-label="Song title"
                />
              ) : (
                <h2
                  onClick={() => !readOnly && setEditingTitle(true)}
                  className={cx(
                    'font-display text-3xl leading-tight text-white text-balance sm:text-4xl',
                    !readOnly && 'cursor-text rounded transition-colors hover:text-accent-soft',
                  )}
                  title={readOnly ? undefined : 'Click to rename'}
                >
                  {song.title}
                </h2>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {song.genre && <Badge>{song.genre}</Badge>}
                {song.mood && <Badge>{song.mood}</Badge>}
                <span className="whitespace-nowrap font-mono">
                  {totalBars(song)} bars · {totalWords(song)} words
                </span>
                {readOnly && <Badge tone="amber">Read-only share</Badge>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={playing ? 'secondary' : 'primary'}
                size="sm"
                onClick={handlePlayAll}
              >
                {playing ? <Icon.Stop className="h-3.5 w-3.5" /> : <Icon.Play className="h-3.5 w-3.5" />}
                {playing ? 'Stop' : 'Play song'}
              </Button>
              <ExportMenu song={song} />
            </div>
          </div>

          {/* Key and tempo are editable in place — changing them changes playback. */}
          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-white/[0.07] pt-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <label className="block">
              <span className="field-label">Key</span>
              <Select
                value={song.key}
                disabled={readOnly}
                onChange={(e) => updateSongMeta({ key: e.target.value })}
                className="py-2 text-[13px]"
              >
                {!KEY_OPTIONS.includes(song.key) && <option value={song.key}>{song.key}</option>}
                {KEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </Select>
            </label>

            <div className="pt-0.5">
              <Slider
                label="Tempo"
                min={40}
                max={220}
                step={1}
                disabled={readOnly}
                value={song.tempo}
                display={`${song.tempo} BPM`}
                onChange={(e) => updateSongMeta({ tempo: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <ArrangementBar genre={song.genre} mood={song.mood} tempo={song.tempo} />

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] bg-ink-950/30 px-5 py-3 sm:px-6">
            <Button size="sm" onClick={onRegenerateAll} loading={generating} disabled={generating}>
              <Icon.Refresh className="h-3.5 w-3.5" />
              Regenerate song
            </Button>

            {lockedCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-amber-glow">
                <Icon.Lock className="h-3 w-3" />
                {lockedCount} locked section{lockedCount > 1 ? 's' : ''} will be kept
              </span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => setAllLocks(true)} className="ghost-btn">
                <Icon.Lock className="h-3.5 w-3.5" /> Lock all
              </button>
              <button type="button" onClick={() => setAllLocks(false)} className="ghost-btn">
                <Icon.Unlock className="h-3.5 w-3.5" /> Unlock all
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ------------------- sections ------------------- */}
      <div className="space-y-3">
        {song.sections.map((section, i) => (
          <div
            key={section.id}
            className={cx(
              'transition-all duration-300',
              activeSection === section.id && 'scale-[1.005] drop-shadow-[0_0_24px_rgba(124,108,255,0.18)]',
            )}
          >
            <SectionCard
              section={section}
              index={i}
              songKey={song.key}
              tempo={song.tempo}
              genre={song.genre}
              mood={song.mood}
              readOnly={readOnly}
              onRegenerate={onRegenerateSection}
            />
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap gap-2 pb-6">
          {['Verse', 'Chorus', 'Bridge', 'Outro'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addSection(type)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/15
                         px-3.5 py-2 text-xs text-slate-500 transition-colors
                         hover:border-accent/40 hover:text-accent-soft"
            >
              <Icon.Plus className="h-3.5 w-3.5" /> Add {type}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
