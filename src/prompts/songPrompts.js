/**
 * songPrompts.js
 * ---------------------------------------------------------------------------
 * Every prompt the app sends lives here, so prompt tuning never means hunting
 * through component code.
 *
 * Design notes:
 *  - The schema is restated in full in the system prompt. Models follow a
 *    literal schema far more reliably than a prose description.
 *  - We ask for `melodyContour` as scale degrees rather than note names: it
 *    keeps the melody inside the key no matter what the model does with pitch
 *    spelling, and the client resolves degrees to pitches.
 *  - Genre guidance is injected as concrete, checkable constraints (chord
 *    vocabulary, line length, rhyme habits), not vibes.
 */

// ---------------------------------------------------------------------------
// Shared schema contract
// ---------------------------------------------------------------------------

export const SONG_SCHEMA_TEXT = `{
  "title": string,
  "key": string,            // e.g. "G major", "F# minor"
  "tempo": number,          // integer BPM
  "genre": string,
  "mood": string,
  "sections": [
    {
      "type": string,       // "Intro" | "Verse" | "Pre-Chorus" | "Chorus" | "Bridge" | "Outro" | "Hook" | "Refrain"
      "label": string,      // display label, e.g. "Verse 1"
      "lyrics": string,     // newline-separated lines; NO chord symbols inside
      "chords": string[],   // one chord symbol per BAR, e.g. ["G","Em","C","D"]
      "melodyContour": (string|number)[], // scale degrees 1-7, optionally with
                            // "b"/"#" and "^"/"v" octave markers: 1, "b3", "5^"
      "performanceNote": string  // one short line on delivery/arrangement
    }
  ]
}`;

const SCHEMA_RULES = `
HARD OUTPUT RULES
1. Respond with a single JSON object and nothing else. No markdown, no code fences, no commentary.
2. The object must match this schema exactly:
${SONG_SCHEMA_TEXT}
3. "chords" holds one chord symbol per bar. Use plain ASCII symbols: C, Am, F#m7b5, Cmaj7, G7sus4, D/F#. Never write chords inside the lyrics string.
4. Every chord must be diatonic to the stated key, or a deliberate, idiomatic borrowing (secondary dominant, bVII, iv in major, Picardy third). Do not emit random chromatic chords.
5. "melodyContour" uses scale degrees of the stated key, one entry per lyric line unless the section is instrumental. Use "r" for a rest. Keep the range inside roughly degrees 1 to "5^" so a human can sing it.
6. Chord count per section should be a musically sensible loop length: 2, 4, 8 or 16 bars.
7. Lyrics must be ORIGINAL. Never reproduce lines from existing published songs.
8. Keep every lyric line singable: 4 to 12 syllables, with stresses that fall naturally.
`.trim();

// ---------------------------------------------------------------------------
// Genre guidance
// ---------------------------------------------------------------------------

/**
 * Concrete per-genre craft constraints. Falling back to GENERIC_GUIDANCE keeps
 * custom genres working without a code change.
 */
const GENRE_GUIDANCE = {
  Pop: 'Diatonic I–V–vi–IV family progressions. Short, concrete images. A title phrase that lands in the first or last line of the chorus. Chorus melody sits higher than the verse.',
  'Indie Folk': 'Open, sustained chords, sus2/sus4 colour, occasional modal bVII. Specific physical detail over abstraction: place names, weather, objects. Conversational line lengths that vary.',
  Rock: 'Power-chord-friendly roots, bVII and IV borrowings, driving quarter-note harmonic rhythm. Direct, declarative lines. Repeated hook in the chorus.',
  'R&B': 'Extended harmony — maj7, m9, 11ths, slash chords. Melismatic melodic contour with wide intervals and syncopated phrasing. Intimate, second-person address.',
  'Hip-Hop': 'Two- or four-bar looping minor progression. Verses are dense, internally rhymed, rhythmically front-loaded; the hook is sparse and repeatable. Contour should be narrow and speech-like.',
  Country: 'I–IV–V with a vi, clean major tonality. Narrative verses with a turn in the last line. Plain-spoken diction, a concrete setting, a title that doubles as a phrase people say.',
  Electronic: 'Four-bar minor loop with a suspended or added-9th colour. Lyrics sparse and repetitive — a mantra, not a story. Contour built from a few repeated cells.',
  Jazz: 'ii–V–I motion, tritone substitutions, maj7/m7/dom7 throughout, frequent key centres shifting. Sophisticated interior rhyme, wry tone, AABA leaning.',
  Soul: 'Gospel-leaning harmony: IV/iv motion, dominant 7ths, passing diminished chords. Call-and-response phrasing and an ad-lib-ready final chorus.',
  Punk: 'Three or four chords, fast harmonic rhythm, I–IV–V or i–bVI–bVII. Blunt, short lines. Shoutable chorus of five words or fewer.',
  Metal: 'Minor or Phrygian tonality, power-chord roots, bII/bVI colour. Lyrics imagistic and severe. Contour built on low-register repetition with sudden leaps.',
  Ambient: 'Slow harmonic rhythm — one or two chords per section, maj7/add9 voicings. Very few words, long vowels, lots of space. Contour mostly stepwise and sustained.',
  Musical: 'Theatrical harmonic motion with clear modulation potential, suspensions resolving on strong beats. Lyrics advance a character objective; the bridge changes what the singer wants.',
  Reggae: 'i–bVII–bVI or I–V vamps with offbeat emphasis. Rootsy, communal diction. Hook repeats with small variations.',
  'Lo-fi': 'Jazzy maj7/m9 loop of two or four bars, relaxed. Lyrics fragmentary and nostalgic, present tense, small domestic detail.',
};

const GENERIC_GUIDANCE =
  'Match the harmonic vocabulary and lyrical diction that listeners expect from this genre. Favour a clear hook and a chorus that contrasts with the verse in register and density.';

export function genreGuidance(genre) {
  if (!genre) return GENERIC_GUIDANCE;
  const exact = GENRE_GUIDANCE[genre];
  if (exact) return exact;
  const hit = Object.keys(GENRE_GUIDANCE).find(
    (g) => g.toLowerCase() === String(genre).toLowerCase(),
  );
  return hit ? GENRE_GUIDANCE[hit] : `${GENERIC_GUIDANCE} The requested genre is "${genre}".`;
}

// ---------------------------------------------------------------------------
// Structure templates
// ---------------------------------------------------------------------------

export const STRUCTURE_PRESETS = {
  'Verse-Chorus': ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Bridge', 'Chorus'],
  'Verse-Chorus (short)': ['Verse 1', 'Chorus', 'Verse 2', 'Chorus'],
  'Verse-PreChorus-Chorus': ['Verse 1', 'Pre-Chorus', 'Chorus', 'Verse 2', 'Pre-Chorus', 'Chorus', 'Bridge', 'Chorus'],
  AABA: ['A Section 1', 'A Section 2', 'B Section (Bridge)', 'A Section 3'],
  'Through-composed': ['Part I', 'Part II', 'Part III', 'Part IV'],
  'Hook-Verse (Hip-Hop)': ['Hook', 'Verse 1', 'Hook', 'Verse 2', 'Hook', 'Outro'],
  'Intro-Verse-Chorus-Outro': ['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Outro'],
  'Ballad (ABABCB)': ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Bridge', 'Final Chorus'],
};

export const STRUCTURE_OPTIONS = Object.keys(STRUCTURE_PRESETS);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export function buildSystemPrompt() {
  return `You are Earworm, a songwriting collaborator with the ear of a working topliner and the harmonic knowledge of an arranger. You turn a seed idea into a complete, performable song draft.

You care about craft:
- Prosody first. Stressed syllables land on strong beats; line lengths are consistent within a section and contrast between sections.
- Concrete over abstract. One real image beats three adjectives.
- The chorus must be a lift: higher melodic register, simpler language, and the title phrase present.
- Verses carry new information; a second verse never restates the first.
- The bridge must change something — the perspective, the time frame, or what the singer wants.
- Harmony serves the melody. Chord changes mark phrase boundaries rather than fighting them.

${SCHEMA_RULES}`;
}

// ---------------------------------------------------------------------------
// User prompts
// ---------------------------------------------------------------------------

function brief(form) {
  const lines = [
    `Idea / seed: ${form.idea?.trim() || '(none given — invent something fresh and specific)'}`,
    `Genre: ${form.genre}`,
    `Key: ${form.key}`,
    `Tempo: around ${form.tempo} BPM`,
    `Mood: ${form.mood}`,
    `Structure: ${form.structure}`,
  ];
  if (form.notes?.trim()) lines.push(`Extra direction: ${form.notes.trim()}`);
  return lines.join('\n');
}

/** Prompt for a brand-new song. */
export function buildGeneratePrompt(form) {
  const sections = STRUCTURE_PRESETS[form.structure] || STRUCTURE_PRESETS['Verse-Chorus'];
  return `Write a complete song draft.

${brief(form)}

Genre craft notes: ${genreGuidance(form.genre)}

Produce exactly these sections in this order, using each name as the "label":
${sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Set "key" to "${form.key}" and "tempo" to an integer near ${form.tempo}.
Return the JSON object only.`;
}

/**
 * Prompt for a full regenerate that must preserve locked sections verbatim.
 */
export function buildFullRegeneratePrompt(form, song, lockedSections) {
  const locked = lockedSections.length
    ? `These sections are LOCKED. Reproduce them byte-for-byte in your output — same label, lyrics, chords and melodyContour — and write everything around them so the song still coheres:

${JSON.stringify(lockedSections, null, 2)}`
    : 'No sections are locked; you may rewrite everything.';

  return `Rewrite this song, keeping its identity but finding stronger material.

${brief(form)}

Genre craft notes: ${genreGuidance(form.genre)}

Current title: ${song.title}
Current section order: ${song.sections.map((s) => s.label).join(' → ')}

${locked}

Keep the same section order and labels. Return the complete JSON object for the whole song.`;
}

/**
 * Prompt for regenerating or restyling one section.
 *
 * @param {string} instruction extra direction, e.g. "Make it more anthemic"
 */
export function buildSectionPrompt(form, song, section, instruction) {
  const neighbours = song.sections
    .filter((s) => s.id !== section.id)
    .map((s) => `${s.label}: ${s.lyrics.split('\n')[0] || '(instrumental)'}`)
    .join('\n');

  return `Rewrite ONE section of an existing song.

Song: "${song.title}" — ${song.key}, ${song.tempo} BPM, ${form.genre}, ${form.mood}.
Genre craft notes: ${genreGuidance(form.genre)}

For context, the other sections open like this:
${neighbours || '(this is the only section)'}

The section to rewrite is "${section.label}" (${section.type}). Here it is now:
${JSON.stringify(
  {
    type: section.type,
    label: section.label,
    lyrics: section.lyrics,
    chords: section.chords,
    melodyContour: section.melodyContour,
  },
  null,
  2,
)}

Direction: ${instruction || 'Write a stronger alternative that keeps the same role in the song.'}

Keep the key (${song.key}), the section's role, and a comparable number of bars unless the direction says otherwise. Do not touch the rest of the song.

Respond with a single JSON object for this section only:
{
  "type": string,
  "label": string,
  "lyrics": string,
  "chords": string[],
  "melodyContour": (string|number)[],
  "performanceNote": string
}
Return the JSON object only — no markdown, no commentary.`;
}

/** One-click rewrite directions shown as buttons on each section. */
export const QUICK_REWRITES = [
  { id: 'anthemic', label: 'More anthemic', instruction: 'Make it more anthemic: wider melodic leaps, a higher chorus register, simpler and more communal language, a line a crowd could shout back.' },
  { id: 'darker', label: 'Darker', instruction: 'Make it darker: minor or modal harmonic colour, colder imagery, more ambiguity and menace. Avoid melodrama — let the detail do the work.' },
  { id: 'conversational', label: 'More conversational', instruction: 'Make it more conversational: plain speech, contractions, the rhythm of someone actually talking. Cut any line that sounds written.' },
  { id: 'shorten', label: 'Shorten', instruction: 'Shorten it by roughly a third. Keep the strongest image and the hook; cut everything that repeats an idea already present.' },
  { id: 'vivid', label: 'More vivid', instruction: 'Replace abstractions with concrete sensory detail — objects, places, light, texture, time of day. Keep the same syllable counts.' },
  { id: 'simpler-chords', label: 'Simpler chords', instruction: 'Simplify the harmony to three or four diatonic triads with a slower harmonic rhythm. Keep the lyrics essentially intact.' },
  { id: 'richer-chords', label: 'Richer chords', instruction: 'Enrich the harmony with sevenths, added ninths, suspensions, an inversion in the bass, and one tasteful borrowed chord. Keep the lyrics intact.' },
];

/**
 * Appended on a retry after the model returned something that was not usable
 * JSON.
 *
 * Deliberately blunt and short: a model that just failed to follow a long
 * schema is not helped by being sent the long schema again. It is helped by a
 * single unambiguous instruction and an example of the exact opening.
 */
export function buildJsonRepairNudge(previousText = '') {
  const preview = String(previousText).slice(0, 400);
  return `Your previous reply could not be parsed as JSON.

${preview ? `It began:\n${preview}\n\n` : ''}Send the song again as ONE JSON object and nothing else.

- No markdown, no code fences, no explanation before or after.
- Start your reply with the character { and end it with }.
- Inside any string, write a line break as \\n — never a real line break.
- Use double quotes for every key and string.

Begin exactly like this:
{"title": "`;
}
