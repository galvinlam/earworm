/**
 * llmClient.js
 * ---------------------------------------------------------------------------
 * Thin client for any OpenAI-compatible /chat/completions endpoint.
 *
 * Works unchanged against OpenAI, OpenRouter, Groq, Together, Ollama and
 * LM Studio. Nothing here is server-side: the key comes from the user's own
 * localStorage and the request goes straight from their browser.
 *
 * Responsibilities:
 *   - build and send the request (streaming or not)
 *   - surface a typed, human-readable error for every failure mode
 *   - hand back raw assistant text; parsing lives in songSchema.js
 */

/** Error with a `kind` the UI can switch on, plus advice for the user. */
export class LLMError extends Error {
  constructor(kind, message, { status, advice, cause } = {}) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind; // 'auth' | 'rate-limit' | 'network' | 'server' | 'bad-request' | 'parse' | 'aborted' | 'config'
    this.status = status;
    this.advice = advice;
    this.cause = cause;
  }
}

/**
 * OpenRouter asks browser apps to identify themselves, and uses these to rank
 * apps on its public leaderboard. Harmless everywhere else, so only sent where
 * they are expected.
 */
function attributionHeaders(base) {
  if (!/openrouter\.ai/i.test(base)) return {};
  const referer = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'https://localhost';
  return { 'HTTP-Referer': referer, 'X-Title': 'Earworm' };
}

/** Normalise a base URL: strip trailing slashes, tolerate a missing /v1. */
export function normaliseBaseUrl(raw) {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  // Allow pasting the full completions path by mistake.
  url = url.replace(/\/chat\/completions$/, '');
  return url;
}

/**
 * Does this rejection mean the model simply has no JSON mode?
 *
 * Free and local models very often reject response_format outright. The wording
 * varies by provider, so match on the shape of the complaint rather than an
 * exact string.
 */
function looksLikeJsonModeRejection(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const mentionsFormat = t.includes('response_format')
    || t.includes('response format')
    || t.includes('json_object')
    || t.includes('json mode');
  const mentionsRefusal = t.includes('not support')
    || t.includes('unsupported')
    || t.includes('unrecognized')
    || t.includes('unknown')
    || t.includes('invalid')
    || t.includes('cannot');
  return mentionsFormat && (mentionsRefusal || t.includes('response_format'));
}

/**
 * Does this rejection mean the model id is no longer served?
 *
 * Free model line-ups churn constantly — a slug that worked last month is
 * retired without warning — so this is a routine condition to recover from,
 * not a user error to report.
 */
function looksLikeModelUnavailable(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('unavailable')
    || t.includes('no longer available')
    || t.includes('not found')
    || t.includes('no endpoints found')
    || t.includes('use this slug instead')
    || t.includes('invalid model');
}

/**
 * Providers sometimes name a replacement ("use this slug instead: x/y").
 * Worth capturing so the user can see it, but never worth switching to
 * automatically: the replacement is usually the paid variant.
 */
function extractSuggestedSlug(text) {
  const m = /use this slug instead:\s*([\w./:-]+)/i.exec(String(text || ''));
  return m ? m[1].replace(/[.,]$/, '') : null;
}

/** Map an HTTP status onto a typed LLMError with actionable advice. */
function errorForStatus(status, bodyText) {
  const detail = extractApiMessage(bodyText);
  switch (true) {
    case status === 401 || status === 403:
      return new LLMError('auth', detail || 'Your API key was rejected.', {
        status,
        advice: 'Open Settings and check the key. Make sure it matches the base URL you are pointing at.',
      });
    case status === 429:
      return new LLMError('rate-limit', detail || 'Rate limit or quota reached.', {
        status,
        advice: 'Free tiers are usually a few requests a minute and a few dozen a day. Wait a moment and retry, or switch to another free model — the daily count is normally per model, not per key.',
      });
    case status === 404: {
      const err = new LLMError('bad-request', detail || 'The model or endpoint was not found.', {
        status,
        advice: 'Check the model id and base URL in Settings — a typo in either produces this.',
      });
      err.modelUnavailable = looksLikeModelUnavailable(bodyText);
      err.suggestedSlug = extractSuggestedSlug(bodyText);
      return err;
    }
    case status === 400 || status === 422: {
      const err = new LLMError('bad-request', detail || 'The provider rejected the request.', {
        status,
        advice: 'Some models do not support JSON response format. Turn off "Force JSON mode" in Settings and retry.',
      });
      // The caller retries this one itself rather than bothering the user.
      err.jsonModeUnsupported = looksLikeJsonModeRejection(bodyText);
      err.modelUnavailable = looksLikeModelUnavailable(bodyText);
      err.suggestedSlug = extractSuggestedSlug(bodyText);
      return err;
    }
    case status >= 500:
      return new LLMError('server', detail || `The provider returned ${status}.`, {
        status,
        advice: 'This is on the provider\'s side. Retry in a moment.',
      });
    default:
      return new LLMError('server', detail || `Request failed with status ${status}.`, { status });
  }
}

/** Pull the useful sentence out of an OpenAI-style error body. */
function extractApiMessage(bodyText) {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText);
    return parsed?.error?.message || parsed?.message || '';
  } catch {
    return String(bodyText).slice(0, 300);
  }
}

/**
 * Call a chat-completions endpoint.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl        e.g. https://api.openai.com/v1
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array}  opts.messages       [{role, content}]
 * @param {number} [opts.temperature]
 * @param {boolean}[opts.jsonMode]     send response_format: json_object
 * @param {boolean}[opts.stream]
 * @param {(chunk:string, full:string)=>void} [opts.onToken] streaming callback
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} the assistant message content
 */
export async function chatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.9,
  jsonMode = true,
  stream = true,
  maxTokens = 0,
  onToken,
  signal,
}) {
  const base = normaliseBaseUrl(baseUrl);
  if (!base) {
    throw new LLMError('config', 'No API base URL is set.', {
      advice: 'Open Settings and enter an OpenAI-compatible base URL.',
    });
  }
  if (!model) {
    throw new LLMError('config', 'No model is selected.', { advice: 'Pick a model in Settings.' });
  }
  // Local runtimes (Ollama, LM Studio) accept any key, so an empty key is only
  // a hard error for remote hosts.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(base);
  if (!apiKey && !isLocal) {
    throw new LLMError('config', 'No API key is set.', {
      advice: 'Open Settings and paste an API key. It is stored only in this browser.',
    });
  }

  const body = {
    model,
    messages,
    temperature,
    stream,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  // Several providers cap completions low by default, which truncates a song
  // mid-section. Asking for headroom costs nothing when the model is generous.
  if (maxTokens > 0) body.max_tokens = maxTokens;

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...attributionHeaders(base),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new LLMError('aborted', 'Generation cancelled.');

    // A thrown fetch (rather than an error status) means the request never
    // completed. In a browser-only app the overwhelmingly common cause is the
    // provider refusing cross-origin requests, which looks identical to being
    // offline from here — so name both and lead with the fix.
    throw new LLMError('network', 'The request never reached the API.', {
      advice: isLocal
        ? 'The server is not answering, or it is not allowing this page to call it. Ollama needs OLLAMA_ORIGINS=* when you start it; LM Studio has a CORS switch in its server settings.'
        : 'Either you are offline, the base URL is wrong, or the provider blocks browser requests (CORS). Some providers — NVIDIA NIM among them — refuse browsers outright whatever key you use. For those, run the bundled proxy: `node tools/cors-proxy.mjs`, then set the base URL to http://localhost:8787/v1.',
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw errorForStatus(res.status, text);
  }

  if (!stream) {
    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new LLMError('parse', 'The response did not contain a message.', {
        advice: 'Try a different model — some endpoints return a non-standard shape.',
      });
    }
    onToken?.(content, content);
    return content;
  }

  return readStream(res, onToken, signal);
}

/** Consume an SSE stream of chat completion deltas. */
async function readStream(res, onToken, signal) {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new LLMError('parse', 'Streaming is not supported by this response.', {
      advice: 'Turn off streaming in Settings and try again.',
    });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            // Some providers stream a full message instead of a delta.
            const alt = json?.choices?.[0]?.message?.content;
            const piece = typeof delta === 'string' ? delta : typeof alt === 'string' ? alt : '';
            if (piece) {
              full += piece;
              onToken?.(piece, full);
            }
          } catch {
            // A partial JSON chunk — it will arrive complete in the next read.
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      throw new LLMError('aborted', 'Generation cancelled.');
    }
    throw new LLMError('network', 'The stream was interrupted.', { cause: err });
  }

  if (!full.trim()) {
    throw new LLMError('parse', 'The model returned an empty response.', {
      advice: 'Retry, or lower the temperature in Settings.',
    });
  }
  return full;
}

/**
 * Ask the endpoint which models it serves. Used by the Settings panel.
 * Failure is non-fatal — the UI falls back to a curated list.
 */
export async function listModels({ baseUrl, apiKey, signal }) {
  const base = normaliseBaseUrl(baseUrl);
  if (!base) return [];
  const res = await fetch(`${base}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw errorForStatus(res.status, text);
  }
  const data = await res.json().catch(() => null);
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .map((m) => m?.id)
    .filter((id) => typeof id === 'string')
    .sort();
}

/**
 * Is this model id free to call?
 *
 * OpenRouter marks free variants with a ":free" suffix, which is the only
 * machine-readable signal any provider offers. Everything else is a guess, so
 * this deliberately does not try to infer it from the name.
 */
export function isFreeModelId(id) {
  const s = String(id || '');
  // OpenRouter marks free variants with a ":free" suffix, and also serves a
  // router slug that always points at something free.
  return /:free$/i.test(s) || s === 'openrouter/free';
}
