# Contributing

Pull requests welcome. The project is small and has no build ceremony.

```bash
npm install
npm run dev      # http://localhost:5173
npm run smoke    # 146 checks, under a minute
```

**Run `npm run smoke` before opening a PR.** It covers rendering, state, the
network client, the audio scheduler and the CORS proxy, and it catches most
regressions. The same suite runs on every pull request, with Chromium installed
so the PWA and audio-render checks run too. The tests need Node 22; the app
itself builds on Node 20.19 or later.

## Where things live

| You want to change | Look in |
|---|---|
| What the model is asked for | `src/prompts/songPrompts.js` |
| Chords, keys, voice leading | `src/lib/musicTheory.js` |
| Drum and bass patterns | `src/lib/groove.js` |
| What gets played, and when | `src/lib/arrange.js` |
| Sounds and instruments | `src/lib/audioEngine.js` |
| Provider handling and errors | `src/lib/llmClient.js` |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how these fit together.

## A few conventions

- **Arrangement logic goes in `arrange.js`, not in a player.** The audio engine
  and the MIDI exporter both render the same event list; that is what keeps
  playback and export from drifting apart.
- **Comments explain *why*.** The code already says what.
- **New grooves are welcome** — they are 16-character strings in `groove.js`,
  and the test suite checks the shape of every one.
- **No new dependencies without a reason.** The MIDI writer, the chord parser
  and the icons are all hand-rolled deliberately.

## Reporting a bug

Say which provider and model you used — most odd behaviour traces back to a
model that will not hold the JSON schema, and that is useful to know about.
