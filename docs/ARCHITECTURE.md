# How Earworm works

The design decisions worth knowing if you are going to change the code.

[← back to the README](../README.md)

## Guitars, bass and parts

Three things are chosen separately, because musicians think of them separately:
the **groove** (what the drums do), the **parts** (what the bass and chord
instrument play), and the **instruments** (what they sound like).

**Guitars are voiced from real fingerings.** `guitarVoicingMidi` in `guitar.js`
turns a chord symbol into fret positions, then into pitches through standard
tuning. That is why an open G comes out as `G2 B2 D3 G3 B3 G4` — six strings with
the root doubled across three octaves — instead of the close three-note voicing a
keyboard would play. Chords with no known shape fall back to the keyboard voicing
rather than going silent.

Power chords drop the third on purpose: thirds turn to mud through heavy gain,
which is why rock guitarists leave them out.

**Guitars, basses and the electric piano are recordings.** They were synthesized
— Karplus-Strong strings for the guitars, filtered oscillators for the basses — and
synthesized guitar is exactly what a 1990s FM soundcard sounded like. They now play
samples from the Musyng Kite General MIDI soundfont, as pre-rendered to MP3 by
[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), one note
every minor third so nothing is pitch-shifted by more than a semitone and a half.
Each instrument is 10–17 small files, 160–450 KB in all, fetched the first time you
pick it.

The synthesized versions are kept as **stand-ins**. If an instrument's samples can't
be fetched — offline before first use, or the host is down — `sampled()` in
`audioEngine.js` builds the old synth instead and marks the rig `degraded`. Your
choice is kept, you are told, and the samples are retried on a later play. The piano
and the acoustic kit have no stand-in that could pass for them, so those fall back
to the pad and the drum machine instead.

Each instrument waits for its own samples only. `Tone.loaded()` would be simpler,
but it waits on every download in flight, so one failed bass note would make a
perfectly good piano report failure too. Decoded buffers are cached by URL, so the
WAV renderer reuses what playback already fetched.

Levels were set by measurement, not by ear: each instrument rendered in headless
Chromium, chords against bass against drums, and trimmed so switching sound doesn't
jump the mix. Melody gets its own level per instrument (`leadDb`), since a single line
against a strummed six-string chord gets buried, and how badly depends on the
instrument.

**Bass is its own instrument.** It used to be whatever the chord rig happened to
provide, so picking a piano got you a piano bass whether you wanted one or not.
`BASS_INSTRUMENTS` is now a separate axis, with `follow` kept as an option for
when a piano should play its own left hand.

**Part styles** live in `BASS_STYLES` and `COMP_STYLES` in `groove.js`, in the
same 16-step grid format as the grooves. The `arpeggio` comp style is handled
separately in `arrange.js`, since it walks up and down the voicing one note per step
rather than sounding a block chord.

**Auto parts come from the genre and the mood.** `partsForSong` starts from a
per-genre table (Country strums over root-and-fifth on an upright, Hip-Hop holds
chords over a syncopated synth bass) and lets the mood push it: a *drive* value
moves both parts along a scale from sparse to busy, so *Weary* thins a part out and
*Restless* pushes it. Genres whose identity *is* a part lock it — jazz walks whatever
the mood says, or it isn't jazz. Ballad tempos pull everything back a step. The
Parts row says what Auto resolved to, and **Fit to song** also switches the
instruments to what the genre calls for, since instruments have no Auto of their own.

**Sections have dynamics.** Every section type has an energy level: intros and
outros play *sparse* (hats and chords thinned to the downbeats), choruses play
*full* (hats fill in, the bass doubles up), verses sit between, and a section
labelled *final* or *last* gets a lift. Sections of four bars or more end on a
turnaround — a snare fill and a bass approach note into the next downbeat.

## Exporting audio

A MIDI file has no sound of its own. It plays through whatever synth opens it,
which for most people is a thin General MIDI bank — so an exported song can sound
markedly worse than the browser did. Two things address that.

**Every MIDI track now carries a GM program change.** Without one, each melodic
track defaults to program 0, Acoustic Grand Piano, so the bass, the guitar and the
vocal line all arrive as three pianos stacked on each other. `midi.js` maps the
chosen instruments onto GM programs, and adds channel volume (CC7) and pan (CC10)
so the parts are balanced and spread rather than piled in the middle.

**WAV export renders the real thing.** `render.js` uses `Tone.Offline` to run the
same instruments, groove and voicings through an offline context, faster than real
time, and `wav.js` encodes the result as 16-bit PCM. The audio engine's
`scheduleEvents` is shared by live playback and the renderer, so a rendered file
cannot drift from what you auditioned. Trailing silence is trimmed to a quarter
second after the last audible sample.

MIDI is still the better export for anyone taking the song into a DAW — notes can
be edited, audio cannot. The two answer different questions.

**Why an exported MIDI can sound like a 1990 soundcard.** It is the player, not the
file. Double-click a `.mid` on Windows and it plays through Microsoft GS Wavetable
Synth, a General MIDI bank Microsoft licensed from Roland in the 1990s; QuickTime and most media
players are similar. Opened in GarageBand, Logic, Ableton, FL Studio or Reaper, the
same file plays through whatever instruments you load. VLC or a player with a
modern SoundFont (FluidR3, Musyng Kite) sits in between. The WAV export sidesteps all
of it by carrying the audio itself.

**One trap in offline rendering.** `Tone.Offline` points Tone's global context at the
offline one while your callback runs, then points it back *before* the transport
callbacks fire. Any node created inside a transport callback — the acoustic kit
makes a fresh source per hit — lands in the live context and plays into the speakers
instead of the file. Those nodes have to be given their context explicitly. A WAV of
the acoustic kit was missing its kick, snare and hats until that was found; the
render suite now checks for it.

## Installable app (PWA)

`vite-plugin-pwa` generates the manifest and a Workbox service worker at build time.
The configuration lives in `vite.config.js`.

Three decisions worth knowing:

- **Tone.js is precached**, not left to runtime caching. It is a large lazy chunk, and
  precaching it means playback works on a plane — which is exactly when someone wants
  to tinker with a song.
- **Instrument samples are cached first-hit** (`CacheFirst`, for the Tone.js host and for
  the soundfont). They are immutable, so once an instrument has played it works
  offline. Before that, the sampled guitars, basses and electric piano play their
  synthesized stand-ins.
- **Model API calls are never cached.** They are POSTs, which Workbox leaves alone,
  and a cached generation would be worse than no generation.

Icons are generated by `brand/build.mjs`: 192, 512, a maskable 512 inset to Android's
safe zone, and a 180px apple-touch-icon, since iOS ignores an SVG there. All four are
rendered square on purpose — iOS rounds the touch icon itself and Android masks
adaptive icons, so pre-rounding would double up.

`index.html` opts into `viewport-fit=cover`, and `.safe-top` / `.safe-bottom` /
`.safe-x` in `index.css` keep the sticky header and the toasts clear of the notch and
the home indicator. Those insets are zero in an ordinary browser tab.

## Project structure

```
src/
├── App.jsx                     layout, share-link entry, panel routing
├── components/
│   ├── SongForm.jsx            the brief
│   ├── SongView.jsx            song header, transport, section stack
│   ├── SectionCard.jsx         one section: chart, playback, edit, lock, rewrite
│   ├── LyricSheet.jsx          chords positioned above lyric lines
│   ├── ChordDiagram.jsx        SVG fretboard
│   ├── ArrangementBar.jsx      inline sound / groove / drums / click controls
│   ├── SettingsPanel.jsx       API, model, generation and playback settings
│   ├── HistoryPanel.jsx        version history
│   ├── ExportMenu.jsx          copy / download / share
│   ├── GenerationStatus.jsx    streaming overlay, error panel, empty state
│   ├── ui.jsx                  buttons, fields, modal, badges
│   └── icons.jsx               inline SVG icons
├── hooks/
│   └── useSongGeneration.js    request lifecycle, cancellation, error shaping
├── lib/
│   ├── llmClient.js            OpenAI-compatible fetch + SSE + typed errors
│   ├── songSchema.js           JSON extraction, repair, normalisation
│   ├── musicTheory.js          keys, scales, chord parsing, voice leading
│   ├── groove.js               rhythm patterns, swing, bass roles
│   ├── arrange.js              song + groove -> a flat list of note events
│   ├── audioEngine.js          Tone.js wrapper (lazy-loaded), instruments, kits
│   ├── midi.js                 Standard MIDI File writer, no dependencies
│   ├── guitar.js               chord symbol → fretboard voicing
│   ├── layout.js               chord-to-lyric-line distribution
│   ├── exporters.js            Markdown, text, downloads, clipboard
│   └── share.js                URL-fragment encoding (deflate + base64url)
├── prompts/
│   └── songPrompts.js          every prompt, in one place
└── store/
    ├── useSongStore.js         draft, form, history, status
    ├── useSettingsStore.js     API and playback settings
    └── useToastStore.js        notifications
```

### The schema

The model is asked for exactly this, and `songSchema.js` repairs whatever actually
arrives:

```jsonc
{
  "title": "Half Light",
  "key": "A minor",
  "tempo": 84,
  "genre": "Indie Folk",
  "mood": "Wistful",
  "sections": [
    {
      "type": "Verse",
      "label": "Verse 1",
      "lyrics": "The kettle starts without me\nI let the morning win",
      "chords": ["Am", "F", "C", "G"],        // one symbol per bar
      "melodyContour": ["1", "3", "5", "4"],  // scale degrees in the key
      "performanceNote": "Half voice, close mic."
    }
  ]
}
```

**Why scale degrees instead of note names.** A contour of `1 3 5 5^` stays in key
whatever the model does with pitch spelling, and it transposes for free when you
change the key in the UI. The client resolves degrees to pitches: `b3` and `#4` for
alterations, `^` and `v` for octave shifts, `r` for a rest. Absolute note names
(`Eb5`) are accepted too.

**Why repair instead of reject.** Models drift from a schema in predictable ways, so
the parser handles code fences, prose preambles, lyrics as an array of lines, chords
as a `"C | G | Am"` string, trailing commas, raw newlines inside string literals, and
streams that get cut off mid-object. A truncated response yields a partial song
rather than an error.

### Playback model

4/4 throughout, one chord per bar. A section's melody contour is spread evenly across
the section — the contour describes shape, not rhythm, and spacing it evenly is the
honest reading of that. The same resolution feeds the MIDI exporter, so what you hear
and what you export agree.

**Chords are voice-led.** Voicing each chord from its own root is the main reason
naive playback sounds mechanical: `G → Em → C → D` lurches up and down the keyboard
instead of moving the way a player would. `voiceLeadChord` in `musicTheory.js`
considers every inversion of the chord in a singable register and picks whichever one
moves least from what was just sounding, so common tones stay put:

```
naive:      G3 B3 D4  │  E3 G3 B3  │  C3 E3 G3  │  D3 F#3 A3
voice-led:  G3 B3 D4  │  G3 B3 E4  │  G3 C4 E4  │  F#3 A3 D4
```

The bass is chosen the same way, with a pull toward a home register so a long
progression wanders without steadily climbing. Voice leading carries across section
boundaries, so a whole-song playback moves as one continuous progression.

### Grooves — what makes it sound like a band

A groove is one bar of sixteenth notes, written as readable grids in
`src/lib/groove.js`:

```
step:   0   4   8   12
kick:  'X.......x.......'     X = accent, x = normal, . = rest
snare: '....X.......X...'
hat:   'x.x.x.x.x.x.x.x.'
comp:  'x.......x.......'     when the chord instrument re-attacks
bass:  'R.......R...F...'     R root  T third  F fifth  O octave  A approach
```

The bass grid holds chord-tone *roles* rather than notes, so one pattern works over
any progression. `A` approaches the next chord's root from a semitone below, which is
what gives the jazz groove a walking line instead of four roots in a row.

Nine grooves ship: **none** (sustained, the original behaviour), **pop**, **rock**,
**ballad**, **folk**, **hip-hop**, **four on the floor**, **jazz shuffle** and
**reggae one-drop**. Swing lives on the groove and delays the offbeat eighths, which
is what separates the shuffle from the straight patterns.

Settings → Playback → Groove. **Auto** picks from the song's genre and tempo, and
tempo wins at the extremes — a 58 BPM pop song becomes a ballad whatever the genre
field says. The song header shows which groove is active.

### Instruments, drums and the click

| Instrument | Sound | Best for |
|---|---|---|
| **Piano** | sampled grand (Salamander) | Judging whether a progression actually works. |
| **Electric piano** | sampled | Soul, R&B, lo-fi. Warmer than the grand. |
| **Electric guitar (clean)** | sampled | Reggae, indie, anything that wants space. |
| **Acoustic guitar** | sampled steel-string | Folk and country, strummed. |
| **Electric guitar (crunch)** | sampled overdrive | Rock. Full chords. |
| **Electric guitar (power chords)** | sampled distortion | Punk and metal. Root, fifth, octave. |
| **Synth pad** (default) | synthesized | Instant, offline. Hearing harmony; washes over the rhythm. |

| Bass | Sound | Notes |
|---|---|---|
| **Electric (finger)** (default) | sampled | Round. Right for most things. |
| **Electric (pick)** | sampled | Brighter attack; cuts through rock. |
| **Upright** | sampled | Short and woody; what a walking line wants. |
| **Synth bass** | synthesized, on purpose | Electronic and hip-hop. |
| **Follow the instrument** | — | A piano plays its own left hand. |

| Drums | Needs network | Notes |
|---|---|---|
| **Drum machine** (default) | no | Synthesised. Sounds like a drum machine, because it is one. |
| **Acoustic kit** | first play only | Three samples, under 200 KB. Sounds like a room with a kit in it. |
| **Off** | — | Chords and bass still follow the groove. |

An instrument that sustains (the pad) holds chords for the whole bar and ignores the
comp pattern; a percussive one (piano, guitars, electric piano) plays the rhythm. So **pad +
rock groove** gives you a pad wash over a backbeat, and **piano + rock groove** gives
you a band. Both are legitimate; pick by what you are trying to hear.

The **metronome** is independent of the drums — you can have either, both or neither.
It clicks every beat, accented on the first. There is also a **drum level** slider,
because the right drum balance for writing lyrics is quieter than for checking groove.

The piano and drum samples stream from the Tone.js sample host; guitars, basses and
electric piano from the Musyng Kite soundfont on gleitz.github.io. Both are cached by
the service worker after first use. If they fail to load, the app falls back as
described above and says so rather than going silent.

**Self-hosting the samples.** Copy the `<instrument>-mp3/` folders you use from
gleitz/midi-js-soundfonts into `public/samples/` and set `VITE_SAMPLE_BASE_URL=/samples/`.
For the piano and drums, point `PIANO_BASE_URL` / `DRUM_SAMPLE_BASE` in
`src/lib/audioEngine.js` at your copies. The soundfont samples stay under CC BY-SA 3.0
wherever you host them.

### Prompting

`src/prompts/songPrompts.js` holds everything. The system prompt restates the schema
literally (models follow a written schema far better than a description) and carries
craft constraints — prosody, chorus lift, verses that don't restate each other, a
bridge that changes something. Genre guidance is injected as checkable constraints
(chord vocabulary, line length, rhyme habits) rather than adjectives.

---


## Known limits

- **Chord positions are approximate.** The app knows how many bars a lyric line
  spans, not which syllable each change lands on. Chords are distributed evenly
  across the line.
- **The melody is a contour, not a topline.** It has no rhythm of its own. Treat it
  as a sketch of shape to sing against, not a finished vocal line.
- **Share links have a size ceiling.** The song travels in the URL; past roughly
  8,000 characters the app tells you to download the JSON instead.
- **Playback is a sketch, not a production.** The instruments are recorded now, and
  parts follow the genre, the mood and the section, but it is still patterns: a
  session band reading a chart, not players responding to each other. One velocity
  layer per instrument, no slides or palm mutes, and the bars within a section repeat
  until its last one turns around. Good enough to judge a progression and a feel;
  for anything you would play to someone else, export the MIDI and use real
  instruments.
- **The sampled instruments need one online play.** Until an instrument's samples
  have been fetched once, it plays its synthesized stand-in.
- **Melody notes can sit high.** The contour maps degree 1 to the tonic in octave 4,
  so `5^` in a high key lands well above a comfortable vocal range. Transpose when you
  move it into a DAW, or lower `baseOctave` in the `contourToNotes` calls.
- **Quality tracks the model.** `gpt-4o-mini` drafts well; free and small local
  models produce weaker lyrics and less reliable JSON. The app recovers from the
  unreliable JSON automatically — it cannot do anything about the weaker lyrics.
- **Output is a draft.** Rewrite it. The point of the locks and section rewrites is
  that the first result is a starting position.


## Where the controls live

The arrangement controls — **sound**, **groove**, **drums**, **click** — sit inline
above the song, not in Settings, because they are what you change while listening.
Settings keeps the things you set once: API connection, model, temperature, levels,
and what-to-play.

```
tools/
└── cors-proxy.mjs    for providers that refuse browser requests (npm run proxy)
```


## Testing

```bash
npm run smoke
```

146 checks run headlessly in under a minute: the real app mounted in jsdom, and
the real network client driven against a mock OpenAI-compatible server
(`.smoke/mockServer.mjs`). It covers rendering, store mutations, exports, share-link
round trips, SSE streaming, malformed-JSON repair, every HTTP error path,
cancellation, voice leading, groove arrangement, and the lock-survives-regenerate
behaviour.

The CORS proxy is covered by real child processes and real sockets — preflight
headers, path rewriting, key injection, a readable 502, and that a slow stream is
relayed live rather than buffered (first chunk inside 30 ms of a 1.8 s stream).

Audio is covered too. jsdom has no Web Audio, so the suite aliases Tone.js to a
recording stub (`.smoke/toneStub.js`) and asserts on what the engine *asks* for —
note times, durations, velocities, swing offsets, strum spread, drum placement and
the playhead. That caught a real bug: the end-of-playback callback was discarding
itself, so the Play button stayed on "Stop" after a song finished.

The sampled-instrument paths are covered both ways: against the stub (each
instrument plays its own soundfont, a failed fetch degrades to the stand-in and
retries later, one instrument's failure doesn't fail another, samples are fetched
once), and in real Chromium, where every sample request is answered with a
generated tone at a realistic level so no check depends on a CDN — a sampled
render, a stand-in render, and the acoustic kit actually making it into the file.

What the suite cannot tell you is whether it *sounds* right. It can measure level,
clipping and silence; it cannot hear. Listening is still on you.

---
