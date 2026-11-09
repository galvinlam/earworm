/**
 * ExportMenu.jsx — copy, download and share actions for the finished draft.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  songToMarkdown,
  songToPlainText,
  songToLyricsOnly,
  copyToClipboard,
  downloadSongAsText,
  downloadSongAsMarkdown,
  downloadSongAsMidi,
  downloadSongAsJson,
} from '../lib/exporters.js';
import { buildShareUrl } from '../lib/share.js';
import { renderSongToWav } from '../lib/render.js';
import { downloadFile, slugify } from '../lib/exporters.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { resolveGroove, GROOVES } from '../lib/groove.js';
import { instrumentVoicing } from '../lib/audioEngine.js';
import { toast } from '../store/useToastStore.js';
import { Button, cx } from './ui.jsx';
import * as Icon from './icons.jsx';

export default function ExportMenu({ song }) {
  const [open, setOpen] = useState(false);
  const [rendering, setRendering] = useState(false);
  const ref = useRef(null);

  // MIDI carries whatever groove is currently playing, so the file you open in
  // a DAW is the arrangement you just heard.
  const grooveSetting = useSettingsStore((s) => s.groove);
  const instrument = useSettingsStore((s) => s.instrument);
  const bassInstrument = useSettingsStore((s) => s.bassInstrument);
  const bassStyle = useSettingsStore((s) => s.bassStyle);
  const compStyle = useSettingsStore((s) => s.compStyle);
  const drumKit = useSettingsStore((s) => s.drumKit);
  const playbackMode = useSettingsStore((s) => s.playbackMode);

  const grooveId = resolveGroove(grooveSetting, song?.genre, song?.tempo);
  const grooveLabel = GROOVES[grooveId]?.label ?? grooveId;

  // The file carries the instruments you chose, as General MIDI programs, so
  // it opens sounding like the arrangement rather than four stacked pianos.
  const midiOptions = {
    grooveId,
    instrument,
    bassInstrument,
    bassStyle,
    compStyle,
    voicing: instrumentVoicing(instrument),
  };

  // Click-away and Escape to dismiss.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn, message) => async () => {
    setOpen(false);
    try {
      const ok = await fn();
      if (ok !== false) toast.success(message);
    } catch (err) {
      toast.error(err?.message || 'That export failed.');
    }
  };

  /**
   * Render the arrangement to audio.
   *
   * Offline and faster than real time, but a long song still takes a few
   * seconds, so the menu entry reports that it is working.
   */
  const renderAudio = async () => {
    setOpen(false);
    setRendering(true);
    try {
      // Everything playback uses, so the file is the arrangement you heard —
      // genre and mood included, since Auto parts are resolved from them.
      const { blob, duration, degraded } = await renderSongToWav({
        sections: song.sections,
        key: song.key,
        tempo: song.tempo,
        genre: song.genre,
        mood: song.mood,
        mode: playbackMode,
        grooveId,
        instrument,
        bassInstrument,
        drumKit,
        bassStyle,
        compStyle,
      });
      downloadFile(`${slugify(song.title)}.wav`, blob, 'audio/wav');
      if (degraded) {
        toast.info(`Audio rendered (${Math.round(duration)}s), but some samples could not load, so it uses the synthesized stand-ins.`);
      } else {
        toast.success(`Audio rendered — ${Math.round(duration)} seconds of what you heard.`);
      }
    } catch (err) {
      toast.error(err?.message || 'Could not render the audio.');
    } finally {
      setRendering(false);
    }
  };

  const items = [
    {
      group: 'Copy',
      entries: [
        { label: 'Markdown', onClick: run(() => copyToClipboard(songToMarkdown(song)), 'Markdown copied.') },
        { label: 'Plain text chart', onClick: run(() => copyToClipboard(songToPlainText(song)), 'Chart copied.') },
        { label: 'Lyrics only', onClick: run(() => copyToClipboard(songToLyricsOnly(song)), 'Lyrics copied.') },
      ],
    },
    {
      group: 'Download',
      entries: [
        { label: '.txt lyric sheet', onClick: run(() => downloadSongAsText(song), 'Text file downloaded.') },
        { label: '.md Markdown', onClick: run(() => downloadSongAsMarkdown(song), 'Markdown downloaded.') },
        {
          label: `.mid — full arrangement (${grooveLabel})`,
          onClick: run(
            () => downloadSongAsMidi(song, midiOptions),
            'MIDI downloaded — four tracks, each set to its matching General MIDI instrument.',
          ),
        },
        {
          label: rendering ? '.wav — rendering…' : '.wav — the actual sound',
          onClick: rendering ? () => {} : renderAudio,
        },
        {
          label: '.mid — no drums, sustained',
          onClick: run(
            () => downloadSongAsMidi(song, { ...midiOptions, grooveId: 'none', includeDrums: false }),
            'MIDI downloaded — chords, bass and melody only.',
          ),
        },
        { label: '.json raw data', onClick: run(() => downloadSongAsJson(song), 'JSON downloaded.') },
      ],
    },
    {
      group: 'Share',
      entries: [
        {
          label: 'Copy read-only link',
          onClick: run(async () => {
            // The link carries the sound too, so it opens the way it plays here.
            const url = await buildShareUrl(song, {
              instrument, bassInstrument, drumKit, groove: grooveSetting, bassStyle, compStyle,
            });
            if (url.length > 8000) {
              toast.error('This song is too long to fit in a link — download the JSON instead.');
              return false;
            }
            return copyToClipboard(url);
          }, 'Share link copied. The whole song travels inside the URL.'),
        },
      ],
    },
  ];

  return (
    <div ref={ref} className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)} loading={rendering}>
        {!rendering && <Icon.Download className="h-3.5 w-3.5" />}
        {rendering ? 'Rendering' : 'Export'}
        <Icon.ChevronDown className={cx('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div
          className="panel absolute right-0 z-40 mt-2 w-60 animate-fade-up overflow-hidden p-1.5"
          role="menu"
        >
          {items.map((section, i) => (
            <div key={section.group}>
              {i > 0 && <div className="my-1.5 h-px bg-white/[0.07]" />}
              <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                {section.group}
              </p>
              {section.entries.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  role="menuitem"
                  onClick={entry.onClick}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-slate-300
                             transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
