#!/usr/bin/env node
/**
 * cors-proxy.mjs
 * ---------------------------------------------------------------------------
 * A tiny local proxy that adds CORS headers to an OpenAI-compatible API.
 *
 * Some providers — NVIDIA NIM among them — do not send CORS headers, so a
 * browser refuses to call them however correct your key is. This forwards
 * requests from the page to the provider and adds the headers back, keeping
 * your key out of the page in the bargain.
 *
 * Usage:
 *
 *   # NVIDIA NIM (Nemotron), key kept here rather than in the browser:
 *   NVIDIA_API_KEY=nvapi-xxxx node tools/cors-proxy.mjs
 *
 *   # Any other OpenAI-compatible provider:
 *   TARGET=https://api.example.com/v1 API_KEY=sk-xxx node tools/cors-proxy.mjs
 *
 * Then in Earworm's Settings set the base URL to:
 *
 *   http://localhost:8787/v1
 *
 * If you set a key here, leave the API key box in the app empty — this adds
 * the Authorization header for you. If you would rather keep the key in the
 * browser, omit it here and the app's own header is passed straight through.
 *
 * This is a development convenience. It allows any origin, so do not expose it
 * to a network you do not control.
 */

import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const TARGET = (process.env.TARGET || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.API_KEY || process.env.NVIDIA_API_KEY || '';
const VERBOSE = process.env.VERBOSE === '1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Title, HTTP-Referer',
  'Access-Control-Max-Age': '86400',
};

/** Read a request body into a Buffer. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Preflight: answer it ourselves, which is the whole point of this process.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // The app is configured with <proxy>/v1, so strip the leading /v1 before
  // appending to a TARGET that already ends in /v1.
  const path = req.url.replace(/^\/v1(?=\/|$)/, '') || '/';
  const upstream = `${TARGET}${path}`;

  const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' };
  // A key set here wins; otherwise pass the browser's own header through.
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  else if (req.headers.authorization) headers.Authorization = req.headers.authorization;

  try {
    const body = req.method === 'GET' ? undefined : await readBody(req);
    if (VERBOSE) console.log(`→ ${req.method} ${upstream}`);

    const upstreamRes = await fetch(upstream, {
      method: req.method,
      headers,
      body: body?.length ? body : undefined,
    });

    // Pass the content type through so the browser treats a stream as a stream.
    const outHeaders = {
      ...CORS_HEADERS,
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
    };
    // Streaming responses must not be buffered by any intermediary.
    if ((upstreamRes.headers.get('content-type') || '').includes('event-stream')) {
      outHeaders['Cache-Control'] = 'no-cache';
      outHeaders.Connection = 'keep-alive';
      outHeaders['X-Accel-Buffering'] = 'no';
    }

    res.writeHead(upstreamRes.status, outHeaders);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    // Relay the stream chunk by chunk, so server-sent events arrive live
    // rather than all at once when the request finishes.
    const reader = upstreamRes.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (VERBOSE) console.error('proxy error:', err);
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: `Proxy could not reach ${upstream}: ${err.message}` },
    }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nEarworm CORS proxy`);
  console.log(`  listening  http://localhost:${PORT}`);
  console.log(`  forwarding to  ${TARGET}`);
  console.log(`  auth  ${API_KEY ? 'injected here (leave the app\'s key box empty)' : 'passed through from the browser'}`);
  console.log(`\nSet Earworm's base URL to  http://localhost:${PORT}/v1\n`);
});
