/**
 * exporters.js
 * ---------------------------------------------------------------------------
 * Markdown, plain text and file-download helpers.
 */

import { lyricLinesWithChords, chordLineFor } from './layout.js';
import { songToMidi } from './midi.js';

/** Safe filename stem from a song title. */
export function slugify(text, fallback = 'earworm-song') {
  const slug = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/**
 * Render the song as Markdown — chord charts in fenced code blocks so the
 * alignment survives a paste into GitHub, Notion or Obsidian.
 */
export function songToMarkdown(song, { includeChords = true, includeNotes = true } = {}) {
  if (!song) return '';
  const out = [`# ${song.title}`, ''];

  const meta = [
    song.key && `**Key:** ${song.key}`,
    song.tempo && `**Tempo:** ${song.tempo} BPM`,
    song.genre && `**Genre:** ${song.genre}`,
    song.mood && `**Mood:** ${song.mood}`,
  ].filter(Boolean);
  if (meta.length) out.push(meta.join('  ·  '), '');

  for (const section of song.sections || []) {
    out.push(`## ${section.label}${section.locked ? ' 🔒' : ''}`, '');

    if (includeChords && section.chords?.length) {
      out.push(`\`${section.chords.join(' | ')}\``, '');
    }

    const lines = lyricLinesWithChords(section);
    if (lines.length) {
      if (includeChords) {
        out.push('```');
        for (const line of lines) {
          const chordLine = chordLineFor(line.chords, line.text);
          if (chordLine) out.push(chordLine);
          out.push(line.text);
        }
        out.push('```', '');
      } else {
        for (const line of lines) out.push(line.text || '');
        out.push('');
      }
    }

    if (section.melodyContour?.length) {
      out.push(`*Melody contour:* \`${section.melodyContour.join(' ')}\``, '');
    }
    if (includeNotes && section.performanceNote) {
      out.push(`> ${section.performanceNote}`, '');
    }
  }

  out.push('---', '', '*Drafted with [Earworm](https://github.com/galvinlam/earworm).*');
  return out.join('\n');
}

/** Render the song as a plain-text lyric sheet. */
export function songToPlainText(song) {
  if (!song) return '';
  const out = [song.title.toUpperCase(), ''];

  const meta = [
    song.key && `Key: ${song.key}`,
    song.tempo && `Tempo: ${song.tempo} BPM`,
    song.genre && `Genre: ${song.genre}`,
    song.mood && `Mood: ${song.mood}`,
  ].filter(Boolean);
  if (meta.length) out.push(meta.join('   '), '');
  out.push('='.repeat(48), '');

  for (const section of song.sections || []) {
    out.push(`[${section.label}]`);
    if (section.chords?.length) out.push(section.chords.join('  |  '));
    out.push('');
    for (const line of lyricLinesWithChords(section)) {
      const chordLine = chordLineFor(line.chords, line.text);
      if (chordLine) out.push(chordLine);
      out.push(line.text);
    }
    if (section.performanceNote) out.push('', `(${section.performanceNote})`);
    out.push('');
  }

  out.push('—', 'Drafted with Earworm.');
  return out.join('\n');
}

/** Lyrics only — no chords, no labels. Useful for pasting into a notes app. */
export function songToLyricsOnly(song) {
  if (!song) return '';
  return [
    song.title,
    '',
    ...(song.sections || []).flatMap((s) => [`[${s.label}]`, s.lyrics, '']),
  ].join('\n').trim();
}

// ---------------------------------------------------------------------------
// Browser actions
// ---------------------------------------------------------------------------

/** Copy text to the clipboard, falling back for non-secure contexts. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Trigger a browser download for a Blob or string. */
export function downloadFile(filename, data, mime = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSongAsText(song) {
  downloadFile(`${slugify(song?.title)}.txt`, songToPlainText(song));
}

export function downloadSongAsMarkdown(song) {
  downloadFile(`${slugify(song?.title)}.md`, songToMarkdown(song), 'text/markdown;charset=utf-8');
}

export function downloadSongAsMidi(song, opts = {}) {
  const bytes = songToMidi(song, opts);
  downloadFile(
    `${slugify(song?.title)}.mid`,
    new Blob([bytes], { type: 'audio/midi' }),
    'audio/midi',
  );
}

export function downloadSongAsJson(song) {
  downloadFile(
    `${slugify(song?.title)}.json`,
    JSON.stringify(song, null, 2),
    'application/json',
  );
}
