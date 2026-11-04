/**
 * Smoke-test entry.
 *
 * Mounts the real App into a jsdom document with react-dom/client, so effects,
 * store subscriptions and event handlers all run the way they do in a browser.
 * Bundled for SSR by Vite and executed by run.mjs.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import App from '../src/App.jsx';
import { useSongStore } from '../src/store/useSongStore.js';
import { useSettingsStore } from '../src/store/useSettingsStore.js';
import { normaliseSong, parseModelJson } from '../src/lib/songSchema.js';
import { songToMarkdown, songToPlainText } from '../src/lib/exporters.js';
import { songToMidi } from '../src/lib/midi.js';
import { encodeSong, decodeSong } from '../src/lib/share.js';
import { voiceLeadChord, bassNoteFor } from '../src/lib/musicTheory.js';
import { INSTRUMENTS, DEFAULT_INSTRUMENT, DRUM_KITS, DEFAULT_DRUM_KIT, BASS_INSTRUMENTS, DEFAULT_BASS_INSTRUMENT, instrumentVoicing } from '../src/lib/audioEngine.js';
import { GROOVES, BASS_STYLES, COMP_STYLES, resolveGroove, stepToBeats, STEPS_PER_BAR, partsForSong } from '../src/lib/groove.js';
import { guitarVoicingMidi, powerChordMidi, STANDARD_TUNING } from '../src/lib/guitar.js';
import { arrange, DRUM_NOTES } from '../src/lib/arrange.js';

const FIXTURE = JSON.stringify({
  title: 'Paper Streets',
  key: 'G major',
  tempo: 96,
  genre: 'Indie Folk',
  mood: 'Wistful',
  sections: [
    { type: 'Verse', label: 'Verse 1', lyrics: 'We walked the paper streets at dawn\nYou counted every broken sign', chords: ['G', 'Em', 'C', 'D'], melodyContour: ['1', '3', '5', '5^'], performanceNote: 'Fingerpicked, half voice.' },
    { type: 'Chorus', label: 'Chorus', lyrics: 'Hold the line, hold the line\nEverything we built is still standing', chords: ['C', 'G', 'D', 'Em', 'C', 'G', 'D', 'D'], melodyContour: ['5', '6', '5', '3', '1', 'r', '2', 'b3'], performanceNote: 'Full band, open voicings.' },
    { type: 'Bridge', label: 'Bridge', lyrics: 'And if it falls\nLet it fall loud', chords: ['Am7', 'Cmaj7/G', 'F#m7b5', 'D7sus4'], melodyContour: [1, 2, 3, 4], performanceNote: '' },
  ],
});

const idle = { state: 'idle', message: '', stage: '', streamText: '', target: null };

/**
 * Parse a Standard MIDI File into its channel messages.
 *
 * Scanning raw bytes for status values is unreliable: a variable-length delta
 * time can carry the high bit, so a 0x99 or 0xC0 can turn up inside a timing
 * value rather than as a message. Walking the chunks properly is the only way
 * to trust an assertion about what the file contains.
 *
 * @returns {{track:number, type:string, channel:number, a:number, b:number}[]}
 */
function parseMidi(bytes) {
  const msgs = [];
  const u32 = (i) => (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
  const trackCount = (bytes[10] << 8) | bytes[11];
  let off = 14;
  for (let t = 0; t < trackCount; t += 1) {
    const len = u32(off + 4);
    let i = off + 8;
    const end = i + len;
    let running = 0;
    while (i < end) {
      // delta time (variable-length quantity)
      while (bytes[i] & 0x80) i += 1;
      i += 1;
      let status = bytes[i];
      if (status === 0xff) {
        const type = bytes[i + 1];
        i += 2;
        let l = 0;
        while (bytes[i] & 0x80) { l = (l << 7) | (bytes[i] & 0x7f); i += 1; }
        l = (l << 7) | bytes[i]; i += 1;
        i += l;
        if (type === 0x2f) break;
        continue;
      }
      if (status & 0x80) { running = status; i += 1; } else { status = running; }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const two = kind === 0xc0 || kind === 0xd0;
      const a = bytes[i];
      const b = two ? 0 : bytes[i + 1];
      i += two ? 1 : 2;
      const type = kind === 0x90 && b > 0 ? 'noteOn'
        : kind === 0x80 || kind === 0x90 ? 'noteOff'
        : kind === 0xc0 ? 'program'
        : kind === 0xb0 ? 'cc'
        : 'other';
      msgs.push({ track: t, type, channel, a, b });
    }
    off = end;
  }
  return msgs;
}


export async function run() {
  const results = [];
  const pass = (name) => results.push(['PASS', name, '']);
  const fail = (name, msg) => results.push(['FAIL', name, msg]);
  const check = async (name, fn) => {
    try { await fn(); pass(name); } catch (e) { fail(name, e.message); }
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const html = () => container.innerHTML;
  const text = () => container.textContent;
  const render = async () => { await act(async () => { root.render(React.createElement(App)); }); };
  const update = async (fn) => { await act(async () => { fn(); }); };
  const clickByText = async (label) => {
    const el = [...container.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label));
    if (!el) throw new Error(`no button containing "${label}"`);
    await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    return el;
  };

  // ---------------------------------------------------------------- render
  await render();

  await check('render: empty state', () => {
    if (!text().includes('Earworm')) throw new Error('header missing');
    if (!text().includes('Start with an idea')) throw new Error('empty state missing');
    if (!text().includes('No API key')) throw new Error('unconfigured badge missing');
    // First run should point at a free route, not just demand a key.
    if (!text().includes(':free')) throw new Error('no guidance toward free models');
  });

  await check('settings: free-only filter narrows the model list', () => {
    useSettingsStore.setState({
      discoveredModels: ['gpt-4o-mini', 'deepseek/deepseek-chat:free', 'x/y:free'],
      freeOnly: true,
    });
    const free = useSettingsStore.getState().discoveredModels.filter((m) => /:free$/.test(m));
    if (free.length !== 2) throw new Error('filter logic wrong');
    useSettingsStore.setState({ discoveredModels: [], freeOnly: true });
  });

  await check('render: form seeds and structure preview', () => {
    if (!text().includes('The brief')) throw new Error('brief panel missing');
    if (!text().includes('Verse-Chorus') && !html().includes('Verse-Chorus')) throw new Error('structure select missing');
    if (!text().includes('Generate song')) throw new Error('generate button missing');
  });

  const song = normaliseSong(parseModelJson(FIXTURE), { genre: 'Indie Folk' });
  await update(() => useSongStore.setState({ song, history: [], readOnly: false, status: { ...idle } }));

  await check('render: the arrangement bar exposes the controls inline', () => {
    // These must be reachable without opening Settings: they are what you
    // change while listening.
    if (!text().includes('Sound')) throw new Error('instrument control missing');
    if (!text().includes('Groove')) throw new Error('groove control missing');
    if (!text().includes('Drums')) throw new Error('drums control missing');
    if (!text().includes('Click')) throw new Error('metronome button missing');
    // Auto should name the groove it resolved to, not just say "Auto".
    if (!/Auto \(/.test(text())) throw new Error('auto groove does not show what it picked');
  });

  await check('render: Parts shows what Auto picked, and Fit to song applies it', async () => {
    useSettingsStore.setState({ instrument: 'pad', bassInstrument: 'synth', groove: 'auto', bassStyle: 'auto', compStyle: 'auto' });
    await clickByText('Parts');
    const fit = partsForSong(song.genre, song.mood, song.tempo);
    // Auto has to say what it resolved to, or nobody can tell what they're hearing.
    if (!text().includes(`Auto (${BASS_STYLES[fit.bassStyle].label})`)) throw new Error('bass part Auto does not name its pick');
    if (!text().includes(`Auto (${COMP_STYLES[fit.compStyle].label})`)) throw new Error('chord part Auto does not name its pick');

    await clickByText('Fit to song');
    const st = useSettingsStore.getState();
    if (st.instrument !== fit.instrument) throw new Error(`instrument not applied: ${st.instrument}`);
    if (st.bassInstrument !== fit.bassInstrument) throw new Error(`bass not applied: ${st.bassInstrument}`);
    if (fit.instrument !== 'guitarAcoustic') throw new Error(`folk should get the acoustic guitar, got ${fit.instrument}`);
    if (!text().includes('Fitted to song')) throw new Error('button did not acknowledge the fit');
    await clickByText('Parts');
  });

  await check('render: with song', () => {
    if (!text().includes('Paper Streets')) throw new Error('title missing');
    if (!text().includes('Verse 1')) throw new Error('section label missing');
    if (!text().includes('Em')) throw new Error('chord chip missing');
    if (!text().includes('broken sign')) throw new Error('lyric line missing');
    if (!text().includes('16 bars')) throw new Error('bar count wrong: ' + (/\d+ bars/.exec(text()) || [])[0]);
    if (!text().includes('Fingerpicked')) throw new Error('performance note missing');
    if (!text().includes('Regenerate song')) throw new Error('regenerate control missing');
  });

  await check('render: unknown chord is flagged in the UI', async () => {
    const id = useSongStore.getState().song.sections[0].id;
    await update(() => useSongStore.getState().updateSection(id, { chords: ['G', 'ZZZ', 'C', 'D'] }));
    if (!text().includes('Not recognised as chord symbols')) throw new Error('warning not shown');
    await update(() => useSongStore.getState().updateSection(id, { chords: ['G', 'Em', 'C', 'D'] }));
    if (text().includes('Not recognised as chord symbols')) throw new Error('warning did not clear');
  });

  await check('render: read-only share mode', async () => {
    await update(() => useSongStore.setState({ readOnly: true }));
    if (!text().includes('Read-only share')) throw new Error('badge missing');
    if (text().includes('Regenerate song')) throw new Error('edit controls should be hidden');
    await update(() => useSongStore.setState({ readOnly: false }));
  });

  await check('render: streaming overlay shows partial lyrics', async () => {
    await update(() => useSongStore.setState({
      status: {
        ...idle,
        state: 'generating',
        stage: 'Writing your song',
        streamText: '{"title":"Half Light","tempo":84,"sections":[{"lyrics":"a line arriving slowly',
      },
    }));
    if (!text().includes('Writing your song')) throw new Error('stage missing');
    if (!text().includes('a line arriving slowly')) throw new Error('stream preview missing');
    if (!text().includes('Half Light')) throw new Error('streamed title missing');
    await update(() => useSongStore.setState({ status: { ...idle } }));
  });

  await check('render: error panel with settings CTA', async () => {
    await update(() => useSongStore.setState({
      status: { ...idle, state: 'error', message: 'Your API key was rejected.', advice: 'Check the key in Settings.', kind: 'auth' },
    }));
    if (!text().includes('Your API key was rejected.')) throw new Error('message missing');
    if (!text().includes('Open settings')) throw new Error('settings CTA missing');
    await update(() => useSongStore.setState({ status: { ...idle } }));
  });

  // ---------------------------------------------------------- interactions
  await check('interact: lock button toggles the section lock', async () => {
    const before = useSongStore.getState().song.sections[0].locked;
    const btn = container.querySelector('button[title^="Lock"]');
    if (!btn) throw new Error('no lock button');
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    if (useSongStore.getState().song.sections[0].locked === before) throw new Error('lock did not toggle');
    if (!text().includes('locked section')) throw new Error('locked hint not shown in header');
    await update(() => useSongStore.getState().toggleLock(useSongStore.getState().song.sections[0].id));
  });

  await check('interact: edit mode exposes chord and contour inputs', async () => {
    const btn = container.querySelector('button[title="Edit lyrics and chords"]');
    if (!btn) throw new Error('no edit button');
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    if (!text().includes('Chords — one per bar')) throw new Error('chord input missing');
    if (!text().includes('Melody contour')) throw new Error('contour input missing');
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel');
    await act(async () => { cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    if (text().includes('Chords — one per bar')) throw new Error('edit mode did not close');
  });

  await check('interact: quick-rewrite buttons appear on demand', async () => {
    await clickByText('Rewrite');
    if (!text().includes('More anthemic')) throw new Error('rewrite options missing');
    if (!text().includes('Simpler chords')) throw new Error('chord rewrite missing');
  });

  await check('interact: chord shapes render an SVG diagram', async () => {
    await clickByText('Chord shapes');
    const svg = container.querySelector('svg[aria-label$="guitar chord diagram"]');
    if (!svg) throw new Error('no diagram rendered');
    if (!svg.querySelectorAll('circle').length) throw new Error('diagram has no finger dots');
  });

  await check('interact: settings modal opens and shows connection fields', async () => {
    const btn = container.querySelector('button[title="Settings"]');
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    if (!text().includes('Base URL')) throw new Error('base url field missing');
    if (!text().includes('Force JSON mode')) throw new Error('json toggle missing');
    if (!text().includes('Erase everything')) throw new Error('clear-history control missing');
    if (!text().includes('Instrument')) throw new Error('instrument selector missing');
    if (!container.querySelector('option[value="piano"]')) throw new Error('piano option missing');
    if (!container.querySelector('option[value="guitarAcoustic"]')) throw new Error('acoustic guitar option missing');
    if (!text().includes('Groove')) throw new Error('groove selector missing');
    if (!text().includes('Drums')) throw new Error('drum kit selector missing');
    if (!text().includes('Metronome click')) throw new Error('metronome toggle missing');
    if (!text().includes('Drum level')) throw new Error('drum level slider missing');
    if (!text().includes('Free models only')) throw new Error('free-model filter missing');
    if (!text().includes('Response limit')) throw new Error('token limit slider missing');
    await clickByText('Done');
    if (text().includes('Base URL')) throw new Error('modal did not close');
  });

  await check('interact: history modal lists snapshots', async () => {
    await update(() => useSongStore.getState().pushHistory(useSongStore.getState().song, 'Snapshot A'));
    const btn = container.querySelector('button[title="Version history"]');
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    if (!text().includes('Version history')) throw new Error('history modal missing');
    if (!text().includes('Snapshot A')) throw new Error('snapshot not listed');
    await clickByText('Done');
  });

  // ---------------------------------------------------------------- stores
  await check('store: edit chords revalidates unknown symbols', () => {
    const id = useSongStore.getState().song.sections[0].id;
    useSongStore.getState().updateSection(id, { chords: ['G', 'NOPE', 'C'] });
    if (!useSongStore.getState().song.sections[0].unknownChords.includes('NOPE')) throw new Error('not flagged');
    useSongStore.getState().updateSection(id, { chords: ['G', 'Em', 'C', 'D'] });
  });

  await check('store: move, add and remove sections', () => {
    const s = useSongStore.getState();
    const before = s.song.sections.map((x) => x.label);
    s.moveSection(s.song.sections[0].id, 1);
    if (useSongStore.getState().song.sections[0].label !== before[1]) throw new Error('move failed');
    useSongStore.getState().moveSection(useSongStore.getState().song.sections[1].id, -1);
    useSongStore.getState().addSection('Outro');
    if (useSongStore.getState().song.sections.length !== 4) throw new Error('add failed');
    useSongStore.getState().removeSection(useSongStore.getState().song.sections[3].id);
    if (useSongStore.getState().song.sections.length !== 3) throw new Error('remove failed');
  });

  await check('store: history restore brings the old draft back', () => {
    const s = useSongStore.getState();
    s.pushHistory(s.song, 'Snapshot B');
    const vId = useSongStore.getState().history[0].id;
    useSongStore.getState().updateSongMeta({ title: 'Changed' });
    useSongStore.getState().restoreHistory(vId);
    if (useSongStore.getState().song.title !== 'Paper Streets') throw new Error('restore failed');
  });

  await check('settings: isConfigured handles local endpoints', () => {
    useSettingsStore.setState({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
    if (useSettingsStore.getState().isConfigured()) throw new Error('remote without key should be unconfigured');
    useSettingsStore.setState({ baseUrl: 'http://localhost:11434/v1' });
    if (!useSettingsStore.getState().isConfigured()) throw new Error('local should need no key');
    useSettingsStore.setState({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' });
    if (!useSettingsStore.getState().isConfigured()) throw new Error('should be configured');
  });

  await check('render: configured state shows the model in the header', async () => {
    await act(async () => {});
    if (!text().includes('gpt-4o-mini')) throw new Error('model not shown');
  });

  // ----------------------------------------------------------- voicing
  /** Mean distance each voice travels between two voicings. */
  const movement = (a, b) =>
    b.reduce((sum, n) => sum + Math.min(...a.map((p) => Math.abs(p - n))), 0) / b.length;

  await check('voicing: voice leading beats root-position stacking', () => {
    const prog = ['G', 'Em', 'C', 'D', 'G'];

    // Naive: every chord stacked from its own root in one octave.
    let naive = 0;
    let prevNaive = null;
    for (const c of prog) {
      const v = voiceLeadChord(c, null, { center: 0, low: 48, high: 72 }); // no previous -> lowest
      if (prevNaive) naive += movement(prevNaive, v);
      prevNaive = v;
    }

    let led = 0;
    let prev = null;
    for (const c of prog) {
      const v = voiceLeadChord(c, prev);
      if (prev) led += movement(prev, v);
      prev = v;
    }

    if (!(led < naive)) throw new Error(`voice leading did not reduce movement: ${led} vs ${naive}`);
  });

  await check('voicing: common tones are held between chords', () => {
    const g = voiceLeadChord('G', null);
    const em = voiceLeadChord('Em', g);
    // G and Em share G and B; a sane voicing keeps at least two notes put.
    const held = em.filter((n) => g.includes(n)).length;
    if (held < 2) throw new Error(`only ${held} common tones held`);
  });

  await check('voicing: stays inside a singable register', () => {
    for (const c of ['C', 'F#m7b5', 'Bbmaj7', 'D7sus4', 'Am9']) {
      const v = voiceLeadChord(c, null);
      if (!v.length) throw new Error(`${c} produced no voicing`);
      if (Math.min(...v) < 48 || Math.max(...v) > 72) throw new Error(`${c} out of range: ${v.join()}`);
      const span = Math.max(...v) - Math.min(...v);
      if (span > 20) throw new Error(`${c} spans ${span} semitones`);
    }
  });

  await check('voicing: bass does not drift upward over a long progression', () => {
    let bass = null;
    const line = [];
    // Four passes of a loop — a drifting bass would climb out of register.
    for (let i = 0; i < 4; i += 1) {
      for (const c of ['Am', 'F', 'C', 'G']) {
        bass = bassNoteFor(c, bass);
        line.push(bass);
      }
    }
    if (Math.min(...line) < 36 || Math.max(...line) > 52) {
      throw new Error(`bass left its register: ${Math.min(...line)}-${Math.max(...line)}`);
    }
    // The same chord should land on the same note each time round the loop.
    if (line[0] !== line[12]) throw new Error('bass did not settle into a stable cycle');
  });

  await check('voicing: slash chords put the named note in the bass', () => {
    if (bassNoteFor('G/B', null) % 12 !== 11) throw new Error('G/B bass is not B');
    if (bassNoteFor('C/E', null) % 12 !== 4) throw new Error('C/E bass is not E');
    if (bassNoteFor('Am', null) % 12 !== 9) throw new Error('Am bass is not A');
  });

  await check('instruments: every instrument is declared sanely', () => {
    const keys = Object.keys(INSTRUMENTS);
    if (keys.length < 2) throw new Error('expected several instruments');
    if (!keys.includes(DEFAULT_INSTRUMENT)) throw new Error('default instrument is not in the list');
    if (INSTRUMENTS[DEFAULT_INSTRUMENT].needsNetwork) throw new Error('the default must work offline');
    for (const [k, def] of Object.entries(INSTRUMENTS)) {
      if (!def.label || !def.hint) throw new Error(`${k} is missing a label or hint`);
      if (typeof def.build !== 'function') throw new Error(`${k} has no build()`);
    }
  });

  // ------------------------------------------------------------ guitar
  await check('guitar: voicings come from real fingerings, not piano chords', () => {
    const g = guitarVoicingMidi('G');
    if (!g) throw new Error('no voicing for G');
    // Open G is six strings with the root doubled across three octaves —
    // a keyboard voicing would be three or four notes inside one octave.
    if (g.length !== 6) throw new Error(`expected 6 strings, got ${g.length}`);
    const span = Math.max(...g) - Math.min(...g);
    if (span < 24) throw new Error(`span ${span} is too narrow to be a guitar`);
    const roots = g.filter((n) => n % 12 === 7); // G
    if (roots.length < 2) throw new Error('open G should double the root');
    // Every note must be reachable on a real neck.
    for (const n of g) {
      const ok = STANDARD_TUNING.some((open) => n - open >= 0 && n - open <= 15);
      if (!ok) throw new Error(`${n} is not playable in standard tuning`);
    }
  });

  await check('guitar: an unknown shape falls back rather than failing', () => {
    // A chord with no table entry and no movable shape returns null, and
    // arrange() is expected to fall back to the keyboard voicing.
    const odd = guitarVoicingMidi('Cmaj7#11');
    if (odd && odd.some((n) => !Number.isFinite(n))) throw new Error('produced junk notes');
    const arranged = arrange({
      sections: [{ id: 's', chords: ['Cmaj7#11'], melodyContour: [] }],
      grooveId: 'rock', drums: false, voicing: 'guitar',
    });
    const chords = arranged.events.filter((e) => e.voice === 'chord');
    if (!chords.length) throw new Error('no chord events — the fallback did not fire');
  });

  await check('guitar: a power chord has no third', () => {
    const p = powerChordMidi('E');
    const root = p[0] % 12;
    const intervals = p.map((n) => ((n - p[0]) % 12 + 12) % 12);
    if (intervals.includes(4) || intervals.includes(3)) throw new Error('power chord contains a third');
    if (!intervals.includes(7)) throw new Error('power chord is missing its fifth');
    if (root !== 4) throw new Error('wrong root');
  });

  // ------------------------------------------------------------ parts
  await check('parts: bass style overrides the groove, auto follows it', () => {
    const sections = [{ id: 's', chords: ['C', 'G'], melodyContour: [] }];
    const bassHits = (bassStyle) =>
      arrange({ sections, grooveId: 'ballad', drums: false, bassStyle })
        .events.filter((e) => e.voice === 'bass').length;

    const auto = bassHits('auto');       // ballad: two hits a bar
    const eighths = bassHits('eighths'); // eight a bar
    const whole = bassHits('whole');     // one a bar
    if (!(eighths > auto && auto > whole)) {
      throw new Error(`styles did not change density: whole=${whole} auto=${auto} eighths=${eighths}`);
    }
  });

  await check('parts: a walking bass moves, it does not repeat one note', () => {
    const { events } = arrange({
      sections: [{ id: 's', chords: ['Cmaj7', 'Am7', 'Dm7', 'G7'], melodyContour: [] }],
      grooveId: 'rock', drums: false, bassStyle: 'walking',
    });
    const notes = events.filter((e) => e.voice === 'bass').map((e) => e.midi);
    // Four quarters a bar over four bars, plus the turnaround on the last bar.
    if (notes.length < 16 || notes.length > 20) {
      throw new Error(`expected 16-20 bass notes, got ${notes.length}`);
    }
    if (new Set(notes).size < 8) throw new Error('a walking line should not repeat so much');
    // Steps should be small — a walking bass walks.
    const leaps = notes.slice(1).map((n, i) => Math.abs(n - notes[i]));
    const avg = leaps.reduce((a, b) => a + b, 0) / leaps.length;
    if (avg > 6) throw new Error(`average leap ${avg.toFixed(1)} is too wide to be walking`);
  });

  await check('parts: comp style changes the chord rhythm', () => {
    const sections = [{ id: 's', chords: ['C', 'G'], melodyContour: [] }];
    const density = (compStyle) =>
      new Set(
        arrange({ sections, grooveId: 'ballad', drums: false, compStyle })
          .events.filter((e) => e.voice === 'chord').map((e) => e.step),
      ).size;

    const sustain = density('sustain');
    const eighths = density('eighths');
    const strum = density('strum');
    if (sustain !== 2) throw new Error(`sustain should hit once a bar, got ${sustain}`);
    if (eighths !== 16) throw new Error(`eighths should hit 8 a bar, got ${eighths}`);
    if (!(strum > sustain && strum < eighths)) throw new Error('strum density is wrong: ' + strum);
  });

  await check('parts: an arpeggio plays one note at a time, not a block chord', () => {
    const sections = [{ id: 's', chords: ['C'], melodyContour: [] }];
    const arp = arrange({ sections, grooveId: 'rock', drums: false, compStyle: 'arpeggio' })
      .events.filter((e) => e.voice === 'chord');
    // One note per step, so no two chord events share a step.
    const steps = arp.map((e) => e.step);
    if (new Set(steps).size !== steps.length) throw new Error('arpeggio sounded more than one note at a step');
    if (new Set(arp.map((e) => e.midi)).size < 3) throw new Error('arpeggio did not move through the chord');

    const block = arrange({ sections, grooveId: 'rock', drums: false, compStyle: 'eighths' })
      .events.filter((e) => e.voice === 'chord');
    const blockSteps = block.map((e) => e.step);
    if (new Set(blockSteps).size === blockSteps.length) throw new Error('a block chord should stack notes on a step');
  });

  await check('dynamics: a chorus plays harder than a verse, an intro softer', () => {
    const sections = [
      { id: 'i', type: 'Intro', label: 'Intro', chords: ['C', 'C', 'F', 'G'], melodyContour: [] },
      { id: 'v', type: 'Verse', label: 'Verse 1', chords: ['C', 'Am', 'F', 'G'], melodyContour: [] },
      { id: 'c', type: 'Chorus', label: 'Chorus', chords: ['F', 'C', 'G', 'Am'], melodyContour: [] },
    ];
    const { events } = arrange({ sections, grooveId: 'rock', drums: true, bassStyle: 'quarters', compStyle: 'quarters' });
    const count = (id, voice) => events.filter((e) => e.sectionId === id && e.voice === voice).length;

    // Same chord count per section, so any difference is the arrangement.
    if (!(count('c', 'chord') > count('v', 'chord'))) throw new Error('the chorus should be fuller than the verse');
    if (!(count('v', 'chord') > count('i', 'chord'))) throw new Error('the intro should be sparser than the verse');
    if (!(count('c', 'hat') > count('v', 'hat'))) throw new Error('the chorus should have busier hats');
    if (!(count('i', 'hat') < count('v', 'hat'))) throw new Error('the intro should have fewer hats');
  });

  await check('dynamics: thinning never deletes the backbeat', () => {
    const sections = [{ id: 'i', type: 'Intro', label: 'Intro', chords: ['C', 'C', 'F', 'G'], melodyContour: [] }];
    const { events } = arrange({ sections, grooveId: 'pop', drums: true });
    // A section with no snare at all reads as broken, not sparse.
    if (!events.some((e) => e.voice === 'snare')) throw new Error('the intro lost its snare entirely');
  });

  await check('dynamics: the last bar of a section gets a turnaround', () => {
    const sections = [{ id: 'v', type: 'Verse', label: 'Verse 1', chords: ['C', 'Am', 'F', 'G'], melodyContour: [] }];
    const { events } = arrange({ sections, grooveId: 'rock', drums: true });
    const perBar = {};
    for (const e of events.filter((x) => x.voice === 'snare')) {
      perBar[e.bar] = (perBar[e.bar] || 0) + 1;
    }
    if (!(perBar[3] > perBar[0])) throw new Error(`last bar should fill: ${JSON.stringify(perBar)}`);

    // A two-bar section is too short to justify a fill.
    const short = arrange({
      sections: [{ id: 's', type: 'Verse', chords: ['C', 'G'], melodyContour: [] }],
      grooveId: 'rock', drums: true,
    });
    const shortBars = {};
    for (const e of short.events.filter((x) => x.voice === 'snare')) {
      shortBars[e.bar] = (shortBars[e.bar] || 0) + 1;
    }
    if (shortBars[1] !== shortBars[0]) throw new Error('a short section should not get a fill');
  });

  await check('dynamics: an unlabelled section is left exactly as written', () => {
    const plain = arrange({
      sections: [{ id: 'x', chords: ['C', 'G'], melodyContour: [] }],
      grooveId: 'rock', drums: true, compStyle: 'quarters',
    });
    // Two bars of quarters, three notes a chord: no density change applied.
    const chords = plain.events.filter((e) => e.voice === 'chord');
    const steps = new Set(chords.map((e) => e.step));
    if (steps.size !== 8) throw new Error(`expected 8 chord hits, got ${steps.size}`);
  });

  await check('parts: auto resolves from genre and mood, not the groove alone', () => {
    const sections = [{ id: 's', chords: ['C', 'G'], melodyContour: [] }];
    const resolve = (genre, mood) => {
      const r = arrange({ sections, grooveId: 'pop', drums: false, genre, mood, tempo: 110 });
      return `${r.bassStyle}/${r.compStyle}`;
    };
    // Same groove, different genre and mood, different parts.
    const folk = resolve('Indie Folk', 'Wistful');
    const punk = resolve('Punk', 'Restless');
    const tender = resolve('Pop', 'Tender');
    if (folk === punk) throw new Error('folk and punk resolved the same way: ' + folk);
    if (tender === punk) throw new Error('tender and restless resolved the same way');
    if (!folk.endsWith('strum')) throw new Error('folk should strum: ' + folk);
    if (!tender.endsWith('arpeggio')) throw new Error('tender should arpeggiate: ' + tender);
  });

  await check('parts: a mood cannot erase a genre signature', () => {
    // Jazz is a walking bass whatever the mood says, or it is not jazz.
    for (const mood of ['Weary', 'Euphoric', 'Numb', 'Menacing']) {
      const { bassStyle, compStyle } = arrange({
        sections: [{ id: 's', chords: ['Cmaj7', 'G7'], melodyContour: [] }],
        grooveId: 'shuffle', drums: false, genre: 'Jazz', mood, tempo: 120,
      });
      if (bassStyle !== 'walking') throw new Error(`Jazz/${mood} lost its walking bass: ${bassStyle}`);
      if (compStyle !== 'syncopated') throw new Error(`Jazz/${mood} lost its comping: ${compStyle}`);
    }
  });

  await check('parts: every style grid is a well-formed bar', () => {
    for (const [id, def] of Object.entries(BASS_STYLES)) {
      if (!def.label) throw new Error(`bass style ${id} has no label`);
      if (def.grid === null) continue;
      if (def.grid.length !== STEPS_PER_BAR) throw new Error(`bass ${id} is ${def.grid.length} steps`);
      if (!/^[RTFOA.]+$/.test(def.grid)) throw new Error(`bass ${id} has an unknown role`);
    }
    for (const [id, def] of Object.entries(COMP_STYLES)) {
      if (!def.label) throw new Error(`comp style ${id} has no label`);
      if (def.grid === null) continue;
      if (def.grid.length !== STEPS_PER_BAR) throw new Error(`comp ${id} is ${def.grid.length} steps`);
      if (!/^[Xx.]+$/.test(def.grid)) throw new Error(`comp ${id} has an unknown character`);
    }
  });

  await check('instruments: guitars declare a guitar voicing, keyboards do not', () => {
    if (instrumentVoicing('piano') !== 'keyboard') throw new Error('piano should voice as a keyboard');
    if (instrumentVoicing('guitarClean') !== 'guitar') throw new Error('clean guitar should voice as a guitar');
    if (instrumentVoicing('guitarPower') !== 'power') throw new Error('power guitar should use power chords');
    if (instrumentVoicing('nonsense') !== 'keyboard') throw new Error('unknown instrument should default safely');
  });

  await check('instruments: every bass instrument is declared sanely', () => {
    if (!BASS_INSTRUMENTS[DEFAULT_BASS_INSTRUMENT]) throw new Error('default bass is not in the list');
    // The default is the last resort, so it must play without the network —
    // either by needing none, or by having a synthesized stand-in.
    const def = BASS_INSTRUMENTS[DEFAULT_BASS_INSTRUMENT];
    if (def.needsNetwork && !def.build.hasStandIn) throw new Error('default bass must work offline');
    for (const [k, d] of Object.entries(BASS_INSTRUMENTS)) {
      if (d.needsNetwork && !d.build.hasStandIn) throw new Error(`sampled bass ${k} has no offline stand-in`);
    }
    if (!BASS_INSTRUMENTS.follow?.follow) throw new Error('there should be a "follow the instrument" option');
    for (const [k, def] of Object.entries(BASS_INSTRUMENTS)) {
      if (!def.label || !def.hint) throw new Error(`${k} is missing a label or hint`);
      if (typeof def.build !== 'function') throw new Error(`${k} has no build()`);
    }
  });

  // --------------------------------------------------------------- exports
  await check('export: markdown, plain text and MIDI', () => {
    const md = songToMarkdown(song);
    if (!md.includes('## Chorus')) throw new Error('markdown sections wrong');
    if (!md.includes('G | Em | C | D')) throw new Error('markdown chords wrong');
    const txt = songToPlainText(song);
    if (!txt.includes('PAPER STREETS')) throw new Error('text header wrong');
    const midi = songToMidi(song);
    if (String.fromCharCode(...midi.slice(0, 4)) !== 'MThd') throw new Error('midi header wrong');
    if (midi.length < 300) throw new Error('midi suspiciously small');
    // format 1, five tracks: conductor, chords, bass, melody, drums
    if (midi[9] !== 1) throw new Error('midi format should be 1');
    if (midi[11] !== 5) throw new Error('expected 5 tracks, got ' + midi[11]);
    const asText = String.fromCharCode(...midi);
    for (const name of ['Chords', 'Bass', 'Melody', 'Drums']) {
      if (!asText.includes(name)) throw new Error(`track "${name}" missing`);
    }
  });

  // ---------------------------------------------------------------- groove
  await check('groove: auto-selection follows genre, tempo wins at the extremes', () => {
    if (resolveGroove('auto', 'Jazz', 120) !== 'shuffle') throw new Error('jazz should shuffle');
    if (resolveGroove('auto', 'Electronic', 124) !== 'fourfloor') throw new Error('electronic should be four-on-the-floor');
    if (resolveGroove('auto', 'Pop', 58) !== 'ballad') throw new Error('a slow pop song should be a ballad');
    if (resolveGroove('rock', 'Jazz', 120) !== 'rock') throw new Error('an explicit choice must win');
    if (resolveGroove('auto', 'Shoegaze', 110) !== 'pop') throw new Error('unknown genre should fall back');
  });

  await check('groove: every pattern is a well-formed 16-step bar', () => {
    for (const [id, g] of Object.entries(GROOVES)) {
      if (!g.label || !g.hint) throw new Error(`${id} is missing a label or hint`);
      for (const field of ['kick', 'snare', 'hat', 'comp', 'bass']) {
        const grid = g[field];
        if (typeof grid !== 'string') throw new Error(`${id}.${field} is not a string`);
        if (grid.length !== STEPS_PER_BAR) throw new Error(`${id}.${field} is ${grid.length} steps, expected 16`);
      }
      if (!/^[RTFOA.]+$/.test(g.bass)) throw new Error(`${id}.bass has an unknown role: ${g.bass}`);
      if (!/^[Xx.]+$/.test(g.kick + g.snare + g.hat)) throw new Error(`${id} has an unknown drum character`);
      if (g.swing < 0 || g.swing > 0.4) throw new Error(`${id} swing out of range`);
    }
  });

  await check('groove: swing delays the offbeat eighths and nothing else', () => {
    // Downbeats and on-beat eighths must not move, or the groove loses its grid.
    for (const step of [0, 4, 8, 12]) {
      if (stepToBeats(step, 0.3) !== step / 4) throw new Error(`step ${step} moved under swing`);
    }
    for (const step of [2, 6, 10, 14]) {
      if (!(stepToBeats(step, 0.3) > step / 4)) throw new Error(`offbeat step ${step} did not swing`);
    }
    if (stepToBeats(2, 0) !== 0.5) throw new Error('straight feel should be unswung');
  });

  await check('arrange: drums appear only when asked, on GM notes', () => {
    const sections = [{ id: 's1', chords: ['C', 'G', 'Am', 'F'], melodyContour: ['1', '3', '5'] }];

    const withDrums = arrange({ sections, grooveId: 'rock', drums: true });
    const drumVoices = withDrums.events.filter((e) => ['kick', 'snare', 'hat', 'crash'].includes(e.voice));
    if (!drumVoices.length) throw new Error('no drum events');
    for (const ev of drumVoices) {
      if (ev.midi !== DRUM_NOTES[ev.voice]) throw new Error(`${ev.voice} is not on its GM note`);
    }

    const without = arrange({ sections, grooveId: 'rock', drums: false });
    if (without.events.some((e) => ['kick', 'snare', 'hat', 'crash'].includes(e.voice))) {
      throw new Error('drums leaked through with drums: false');
    }
    // Harmony must be unaffected by the drum switch.
    const harmony = (r) => r.events.filter((e) => e.voice === 'chord' || e.voice === 'bass').length;
    if (harmony(withDrums) !== harmony(without)) throw new Error('turning drums off changed the harmony');
  });

  await check('arrange: a sustaining instrument holds chords, a percussive one does not', () => {
    const sections = [{ id: 's1', chords: ['C', 'G'], melodyContour: [] }];
    const held = arrange({ sections, grooveId: 'rock', sustainChords: true });
    const played = arrange({ sections, grooveId: 'rock', sustainChords: false });

    const chordsOf = (r) => r.events.filter((e) => e.voice === 'chord');
    if (chordsOf(held).length >= chordsOf(played).length) {
      throw new Error('a sustained chord should be fewer events than a comped one');
    }
    if (chordsOf(held).some((e) => e.duration !== STEPS_PER_BAR)) {
      throw new Error('a sustained chord should last a whole bar');
    }
  });

  await check('arrange: the metronome is four clicks a bar, accented on one', () => {
    const sections = [{ id: 's1', chords: ['C', 'G'], melodyContour: [] }];
    const r = arrange({ sections, grooveId: 'none', metronome: true });
    const clicks = r.events.filter((e) => e.voice === 'click');
    if (clicks.length !== 8) throw new Error(`expected 8 clicks over 2 bars, got ${clicks.length}`);
    const downbeats = clicks.filter((c) => c.step % STEPS_PER_BAR === 0);
    if (downbeats.length !== 2) throw new Error('expected one accented click per bar');
    for (const d of downbeats) {
      if (!clicks.every((c) => c.velocity <= d.velocity)) throw new Error('the downbeat should be the loudest click');
    }
    if (arrange({ sections, grooveId: 'none' }).events.some((e) => e.voice === 'click')) {
      throw new Error('the metronome should be off by default');
    }
  });

  await check('arrange: bar markers line up with the sections', () => {
    const sections = [
      { id: 'a', chords: ['C', 'G', 'Am', 'F'], melodyContour: [] },
      { id: 'b', chords: ['F', 'C'], melodyContour: [] },
    ];
    const { barMarkers, totalSteps } = arrange({ sections, grooveId: 'pop' });
    if (barMarkers.length !== 6) throw new Error(`expected 6 bars, got ${barMarkers.length}`);
    if (totalSteps !== 6 * STEPS_PER_BAR) throw new Error('total length wrong');
    if (barMarkers[4].sectionId !== 'b' || barMarkers[4].bar !== 0) {
      throw new Error('the second section does not start at the right bar');
    }
    // Markers must be strictly increasing, or the playhead jumps about.
    for (let i = 1; i < barMarkers.length; i += 1) {
      if (barMarkers[i].step <= barMarkers[i - 1].step) throw new Error('markers are out of order');
    }
  });

  await check('arrange: a section with no chords is skipped, not crashed on', () => {
    const r = arrange({
      sections: [{ id: 'a', chords: [], melodyContour: [] }, { id: 'b', chords: ['C'], melodyContour: [] }],
      grooveId: 'pop',
    });
    if (r.totalSteps !== STEPS_PER_BAR) throw new Error('an empty section should contribute no bars');
    if (r.events.some((e) => e.sectionId === 'a')) throw new Error('the empty section produced events');
  });

  await check('arrange: every event is finite and in range', () => {
    const sections = [{ id: 's1', chords: ['Cmaj7', 'F#m7b5', 'Bb', 'G7sus4'], melodyContour: ['1', 'b3', '5^', 'r'] }];
    for (const grooveId of Object.keys(GROOVES)) {
      const { events } = arrange({ sections, grooveId, drums: true, metronome: true });
      for (const ev of events) {
        if (!Number.isFinite(ev.step) || ev.step < 0) throw new Error(`${grooveId}: bad step ${ev.step}`);
        if (!Number.isFinite(ev.duration) || ev.duration <= 0) throw new Error(`${grooveId}: bad duration`);
        if (!Number.isInteger(ev.midi) || ev.midi < 0 || ev.midi > 127) throw new Error(`${grooveId}: midi ${ev.midi} out of range`);
        if (ev.velocity < 1 || ev.velocity > 127) throw new Error(`${grooveId}: velocity ${ev.velocity} out of range`);
      }
    }
  });

  await check('drums: every kit is declared sanely', () => {
    if (!DRUM_KITS[DEFAULT_DRUM_KIT]) throw new Error('the default kit is not in the list');
    if (DRUM_KITS[DEFAULT_DRUM_KIT].needsNetwork) throw new Error('the default kit must work offline');
    if (!DRUM_KITS.off?.silent) throw new Error('there should be a silent "off" kit');
    for (const [k, def] of Object.entries(DRUM_KITS)) {
      if (!def.label || !def.hint) throw new Error(`${k} is missing a label or hint`);
      if (typeof def.build !== 'function') throw new Error(`${k} has no build()`);
    }
  });

  await check('export: MIDI sets a General MIDI program on every track', () => {
    // Without these every melodic track defaults to program 0, Acoustic Grand
    // Piano, so bass and guitar both come out as pianos. This is the single
    // biggest reason an exported file sounds worse than the browser.
    const programs = (opts) => new Map(
      parseMidi(songToMidi(song, opts))
        .filter((m) => m.type === 'program')
        .map((m) => [m.channel, m.a]),
    );

    const rock = programs({ grooveId: 'rock', instrument: 'guitarCrunch', bassInstrument: 'picked' });
    if (rock.get(0) !== 29) throw new Error('chords are not Overdriven Guitar: ' + rock.get(0));
    if (rock.get(1) !== 34) throw new Error('bass is not Electric Bass (pick): ' + rock.get(1));
    if (rock.get(2) !== 73) throw new Error('melody has no program: ' + rock.get(2));

    // A piano song should select a piano, not a guitar.
    const piano = programs({ grooveId: 'pop', instrument: 'piano', bassInstrument: 'upright' });
    if (piano.get(0) !== 0) throw new Error('piano chords should be program 0');
    if (piano.get(1) !== 32) throw new Error('upright bass should be Acoustic Bass (32)');
  });

  await check('export: MIDI sets channel volume and pan on every track', () => {
    const ccs = new Set(
      parseMidi(songToMidi(song, { grooveId: 'rock' }))
        .filter((m) => m.type === 'cc')
        .map((m) => `${m.channel}:${m.a}`),
    );
    for (const channel of [0, 1, 2, 9]) {
      if (!ccs.has(`${channel}:7`)) throw new Error(`channel ${channel} has no volume`);
      if (!ccs.has(`${channel}:10`)) throw new Error(`channel ${channel} has no pan`);
    }
  });

  await check('export: MIDI carries the groove it was given', () => {
    const drumNotes = (opts) => parseMidi(songToMidi(song, opts))
      .filter((m) => m.type === 'noteOn' && m.channel === 9).length;

    // The real distinction is whether a kit is playing, not the byte count.
    if (drumNotes({ grooveId: 'none' }) !== 0) {
      throw new Error('the "none" groove should have no drums — including no fills');
    }
    const rock = drumNotes({ grooveId: 'rock' });
    if (rock < 20) throw new Error(`rock should have a busy kit, got ${rock}`);
    if (drumNotes({ grooveId: 'rock', includeDrums: false }) !== 0) {
      throw new Error('includeDrums: false still wrote drums');
    }
  });

  await check('export: every MIDI note-on has a matching note-off', () => {
    // A dangling note rings forever in most players.
    for (const grooveId of Object.keys(GROOVES)) {
      const open = new Map();
      for (const m of parseMidi(songToMidi(song, { grooveId, instrument: 'guitarClean' }))) {
        const k = `${m.channel}:${m.a}`;
        if (m.type === 'noteOn') open.set(k, (open.get(k) || 0) + 1);
        if (m.type === 'noteOff') open.set(k, (open.get(k) || 0) - 1);
      }
      const dangling = [...open.entries()].filter(([, n]) => n !== 0);
      if (dangling.length) throw new Error(`${grooveId}: dangling ${JSON.stringify(dangling)}`);
    }
  });

  // ----------------------------------------------------------------- share
  const payload = await encodeSong(song);
  await check('share: round trip preserves the song', async () => {
    const back = await decodeSong(payload);
    if (!back) throw new Error('decode returned null');
    if (back.title !== song.title) throw new Error('title lost');
    if (back.sections.length !== song.sections.length) throw new Error('sections lost');
    if (back.sections[1].chords.join() !== song.sections[1].chords.join()) throw new Error('chords lost');
    if (back.sections[2].melodyContour.join() !== song.sections[2].melodyContour.join()) throw new Error('contour lost');
  });

  await check('share: malformed payload decodes to null', async () => {
    if ((await decodeSong('zNOTVALID!!')) !== null) throw new Error('expected null');
    if ((await decodeSong('')) !== null) throw new Error('expected null for empty');
  });

  await act(async () => { root.unmount(); });

  return { results, payloadLength: payload.length };
}
