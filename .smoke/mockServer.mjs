/**
 * A stand-in for an OpenAI-compatible endpoint, so the smoke tests exercise
 * the real fetch/SSE/parse path instead of a stubbed client.
 *
 * Routes (all under /<name>/v1/chat/completions):
 *   ok       — clean streamed JSON song
 *   messy    — streamed prose + code fence + raw newlines inside strings
 *   section  — a single-section JSON object
 *   nostream — a normal non-streamed JSON body
 *   e401 / e429 / e500 — error statuses with OpenAI-shaped error bodies
 *   slow     — streams slowly, for testing cancellation
 *
 * Two routes imitate how weaker free models actually fail, and are driven by
 * the request itself rather than by server state, so they behave the same on
 * every attempt:
 *   nojsonmode — 400s whenever response_format is present, succeeds without it
 *   prosefirst — answers in prose until it is sent a corrective turn
 */
import { createServer } from 'node:http';

const SONG = {
  title: 'Half Light',
  key: 'A minor',
  tempo: 84,
  genre: 'Indie Folk',
  mood: 'Wistful',
  sections: [
    { type: 'Verse', label: 'Verse 1', lyrics: 'The kettle starts without me\nI let the morning win', chords: ['Am', 'F', 'C', 'G'], melodyContour: ['1', '3', '5', '4'], performanceNote: 'Half voice.' },
    { type: 'Chorus', label: 'Chorus', lyrics: 'Half light, half mine\nI am learning how to stay', chords: ['F', 'C', 'G', 'Am'], melodyContour: ['5', '6', '5', '3'], performanceNote: 'Open it up.' },
  ],
};

const SECTION = {
  type: 'Chorus',
  label: 'Chorus',
  lyrics: 'Burn it brighter, burn it down\nWe were never going home',
  chords: ['F', 'C', 'G', 'G'],
  melodyContour: ['5', '5^', '5', '3'],
  performanceNote: 'Anthemic, full band.',
};

function sse(res, text, { delayMs = 0 } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // Split into small pieces so the client's buffering logic is actually used,
  // including splits in the middle of multi-byte and escaped sequences.
  const pieces = [];
  for (let i = 0; i < text.length; i += 17) pieces.push(text.slice(i, i + 17));

  let i = 0;
  const tick = () => {
    if (i >= pieces.length) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const chunk = JSON.stringify({ choices: [{ delta: { content: pieces[i] } }] });
    res.write(`data: ${chunk}\n\n`);
    i += 1;
    if (delayMs) setTimeout(tick, delayMs);
    else setImmediate(tick);
  };
  tick();
}

function errorBody(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'invalid_request_error' } }));
}

export function startMockServer() {
  const server = createServer(async (req, res) => {
    const [, route] = req.url.split('/');

    // Routes below need to inspect what was asked for.
    let payload = null;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { payload = null; }
    }

    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'mock-small' },
          { id: 'mock-large' },
          { id: 'mock-free-a:free' },
          { id: 'mock-free-b:free' },
        ],
      }));
      return;
    }

    switch (route) {
      case 'ok':
        return sse(res, JSON.stringify(SONG));
      case 'messy':
        // Prose preamble, a code fence, raw newlines inside a string, and a
        // trailing comma — all things real models actually emit.
        return sse(
          res,
          'Sure! Here is your song:\n```json\n' +
            JSON.stringify(SONG, null, 1).replace('"The kettle starts without me\\nI let the morning win"', '"The kettle starts without me\nI let the morning win"').replace(/\}\n\s*\]/, '},\n ]') +
            '\n```',
        );
      case 'truncated':
        return sse(res, JSON.stringify(SONG).slice(0, 180));
      case 'section':
        return sse(res, JSON.stringify(SECTION));
      case 'notjson':
        return sse(res, 'I am afraid I cannot write a song about that.');
      case 'nostream': {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(SONG) } }] }));
        return;
      }
      case 'slow':
        return sse(res, JSON.stringify(SONG), { delayMs: 60 });

      case 'nojsonmode':
        // A model with no JSON mode: rejects response_format, works without it.
        if (payload?.response_format) {
          return errorBody(res, 400, "This model does not support 'response_format'.");
        }
        return sse(res, JSON.stringify(SONG));

      case 'prosefirst': {
        // Answers in prose until told its reply was unparseable, then complies.
        const wasCorrected = (payload?.messages || []).some(
          (m) => typeof m?.content === 'string' && m.content.includes('could not be parsed as JSON'),
        );
        return sse(
          res,
          wasCorrected
            ? JSON.stringify(SONG)
            : 'Sure! Here is a lovely song about half light. I hope you enjoy it.',
        );
      }

      case 'retired': {
        // Reproduces OpenRouter retiring a free variant: the exact wording it
        // returns, including the paid slug it suggests instead.
        const asked = payload?.model || '';
        // Only this one slug is retired; anything else the provider still
        // serves. A route that rejected every free model would make the
        // recovery untestable.
        if (asked.startsWith('deepseek/') || asked.startsWith('gone/')) {
          return errorBody(
            res,
            404,
            'This model is unavailable for free. The paid version is available now - use this slug instead: deepseek/deepseek-chat',
          );
        }
        return sse(res, JSON.stringify(SONG));
      }

      case 'echo': {
        // Reflects what the client actually sent, so request-shaping can be
        // asserted rather than assumed.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '{}' } }],
          received: { body: payload, headers: req.headers },
        }));
        return;
      }

      case 'alwaysprose':
        // Never complies — the give-up path.
        return sse(res, 'I would rather describe the song in words, if that is alright.');
      case 'e401':
        return errorBody(res, 401, 'Incorrect API key provided.');
      case 'e429':
        return errorBody(res, 429, 'Rate limit reached for requests.');
      case 'e500':
        return errorBody(res, 500, 'The server had an error.');
      default:
        return errorBody(res, 404, 'Unknown route');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: (route) => `http://127.0.0.1:${port}/${route}/v1` });
    });
  });
}
