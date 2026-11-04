# Providers, free models and CORS

Everything about pointing Earworm at a model: which providers work from a
browser, how to use free tiers, and what to do when a provider blocks you.

[← back to the README](../README.md)

## Point it at a provider

Any OpenAI-compatible `/chat/completions` endpoint works, and presets are built in.

**The thing that decides whether a provider works here is CORS, not the key.**
Earworm calls the API straight from the page, so the provider has to allow
cross-origin requests. Plenty of inference APIs do not, and when one refuses, the
failure looks exactly like being offline. Each preset carries a coloured dot for
this, and the **Test** button settles it in a second.

| Provider | Base URL | Free tier | Browser |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | yes, ids ending `:free` | works |
| OpenAI | `https://api.openai.com/v1` | no | works |
| Groq | `https://api.groq.com/openai/v1` | yes | unverified |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | yes | unverified |
| Cerebras | `https://api.cerebras.ai/v1` | yes | unverified |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | yes | **blocked — needs the proxy** |
| Ollama | `http://localhost:11434/v1` | local | needs `OLLAMA_ORIGINS=*` |
| LM Studio | `http://localhost:1234/v1` | local | needs its CORS switch on |

"Unverified" means exactly that: it was not tested from a browser, so press Test.

**Local servers need CORS too.** A page on `localhost:5173` calling
`localhost:11434` is still cross-origin. Start Ollama with `OLLAMA_ORIGINS=*
ollama serve`; LM Studio has a toggle in its server settings.

If a provider rejects the request with a 400, turn off **Force JSON mode** in
Settings — not every model supports `response_format: json_object`. The parser
handles plain-text-wrapped JSON anyway.

## Working with free models

Free models fail in two specific ways, and Earworm handles both without asking
you to fix anything:

**They reject JSON mode.** Many free and local models 400 on
`response_format: json_object`. The app detects that particular rejection, turns the
setting off, remembers it, and retries. You see one line in the status, not an error.

**They answer in prose, or with broken JSON.** Beyond the repair pass (fences, raw
newlines in strings, trailing commas, truncation), if the reply still cannot be
parsed the app sends one short corrective turn — "that was not JSON, start with `{`"
— and tries again. If the model fails twice it stops there rather than burning your
daily quota, and says what to try instead.

Each path retries **at most once**, so a bad request costs two calls rather than
looping. That matters when a free tier is metered per day.

Three other things that help with weak models:

- **Response limit** (Settings) caps `max_tokens`. Some providers default low enough
  to cut a song off mid-section. 4000 is the default; a truncated reply still yields
  a partial song rather than an error.
- **Lower the temperature** to around 0.6. Weak models lose the schema faster when
  they are being creative.
- **Use a shorter structure.** "Verse-Chorus (short)" is four sections instead of
  six, which is a much smaller JSON object to hold together.

What none of this fixes: free models write weaker lyrics. The repair layer makes the
output *parseable*, not *good*. If the words matter more than the cost,
`gpt-4o-mini` is a few cents a song and noticeably better.

Also worth knowing before you paste original work into a free tier: most free
providers, NVIDIA and Google AI Studio included, reserve the right to train on your
prompts and outputs.

## Free providers, including Nemotron

Two routes, because the obvious one does not work directly.

**The easy route — OpenRouter.** Free model ids end in `:free`, and it works from a
browser without any proxy. In Settings, pick the OpenRouter preset, paste an
OpenRouter key, and choose a model such as:

```
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3-ultra-550b-a55b:free
google/gemma-4-31b-it:free
```

Press **Test** to replace the suggestion list with whatever your key can actually
reach. **The free line-up changes constantly** — slugs get retired without notice,
and a model that worked last month returns *"This model is unavailable for free."*

You do not have to manage that. If a saved model id dies, the app asks the provider
what it serves now, switches to a free one, retries, and tells you what it did. It
will not move you onto the paid variant the provider suggests, even when it names
one — spending money is your call, not the app's.

**NVIDIA NIM directly.** NVIDIA's free tier is real and generous, but
`integrate.api.nvidia.com` sends no CORS headers, so a browser cannot call it at all.
NVIDIA staff have confirmed this on their developer forum, noting the endpoints
"aren't intended to be used for production" and that calling them from a front end
would expose your key. So Earworm ships a proxy:

```bash
NVIDIA_API_KEY=nvapi-xxxx npm run proxy
```

Then set the base URL to `http://localhost:8787/v1` and **leave the app's API key box
empty** — the proxy adds the header, so your key stays out of the browser entirely.
Model ids to try:

```
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3.5-lightning-30b-a3b
openai/gpt-oss-20b
```

The proxy works for any provider that blocks browsers:

```bash
TARGET=https://api.example.com/v1 API_KEY=sk-xxx npm run proxy
```

It is a development convenience: it allows every origin, so do not expose it to a
network you do not control. And it means the app is no longer purely static while you
use it — the proxy has to be running. OpenRouter avoids that, which is why it is the
recommendation if you just want free Nemotron with no moving parts.

Rate limits on free tiers run to a few requests a minute and a few dozen a day. The
daily count is normally per model rather than per key, so switching to another free
id is usually faster than waiting.

## Optional: `.env` defaults

Copy `.env.example` to `.env` to pre-fill the Settings panel on first load:

```ini
VITE_DEFAULT_BASE_URL=https://openrouter.ai/api/v1
VITE_DEFAULT_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
VITE_OPENAI_API_KEY=            # local development only
VITE_BASE=/                     # set to /repo-name/ for GitHub Pages
```

> **Never put a real key here for a site you publish.** Vite inlines every
> `VITE_*` variable into the static bundle at build time, so the key would be
> readable by anyone who loads the page. The in-app Settings panel is the safe
> path: each visitor supplies their own key, stored only in their own browser.

## When something does not work

| Symptom | Almost always |
|---|---|
| "The request never reached the API" | CORS, or a typo in the base URL. Press **Test**. |
| 401 / 403 | The key does not match the base URL you are pointed at. |
| 429 | Free tier limit. The daily count is usually per model, so try another free id. |
| 400 mentioning `response_format` | Handled automatically — the app retries without JSON mode. |
| "This model is unavailable for free" | Handled automatically — the slug was retired; the app finds a live free one. Press **Test** if you want to pick yourself. |
| Song cuts off mid-section | Raise **Response limit** in Settings. |
| "would not return usable JSON, twice" | The model is too small for the schema. Try a larger free model or a shorter structure. |

