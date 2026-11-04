/**
 * layout.js
 * ---------------------------------------------------------------------------
 * Shared logic for pairing chords with lyric lines.
 *
 * The on-screen sheet and the Markdown/plain-text exports both use this, so a
 * copied lyric sheet lines up the same way it did in the app.
 */

/**
 * Distribute a section's chords across its lyric lines.
 *
 * Chords are spread evenly over the non-empty lines: four chords over four
 * lines gives one each; eight chords over four lines gives two each; fewer
 * chords than lines leaves some lines bare, which is how a real chart looks.
 *
 * @param {{lyrics?:string, chords?:string[]}} section
 * @returns {{text:string, chords:string[], isBlank:boolean}[]}
 */
export function lyricLinesWithChords(section) {
  const lyrics = typeof section?.lyrics === 'string' ? section.lyrics : '';
  const chords = Array.isArray(section?.chords) ? section.chords : [];
  const rawLines = lyrics.length ? lyrics.split('\n') : [];

  // Instrumental section: show the chords on their own line.
  if (!rawLines.some((l) => l.trim())) {
    return chords.length ? [{ text: '', chords: [...chords], isBlank: false }] : [];
  }

  const singableIndexes = rawLines
    .map((line, i) => (line.trim() ? i : -1))
    .filter((i) => i !== -1);

  const perLine = chords.length / singableIndexes.length;
  const assignment = new Map();
  singableIndexes.forEach((lineIndex, n) => {
    const start = Math.round(n * perLine);
    const end = Math.round((n + 1) * perLine);
    assignment.set(lineIndex, chords.slice(start, end));
  });

  return rawLines.map((text, i) => ({
    text,
    chords: assignment.get(i) ?? [],
    isBlank: !text.trim(),
  }));
}

/**
 * Render a chord line that sits above a lyric line in monospace output.
 * Chords are spaced across the width of the lyric so they land roughly where
 * the change happens.
 *
 * @param {string[]} chords
 * @param {string} lyricText
 * @returns {string}
 */
export function chordLineFor(chords, lyricText) {
  if (!chords.length) return '';
  if (!lyricText.trim()) return chords.join('  ');

  const width = Math.max(lyricText.length, chords.length * 6);
  const slot = width / chords.length;
  let line = '';
  chords.forEach((chord, i) => {
    const target = Math.round(i * slot);
    if (line.length < target) line += ' '.repeat(target - line.length);
    else if (line.length > 0) line += ' '; // never let two chords touch
    line += chord;
  });
  return line.replace(/\s+$/, '');
}
