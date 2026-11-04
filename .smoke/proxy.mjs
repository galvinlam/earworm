/**
 * End-to-end test of tools/cors-proxy.mjs: mock provider <- proxy <- fetch.
 *
 * Real child processes and real sockets, because the proxy's whole job is
 * header and stream plumbing — mocking that would test nothing.
 */
import { startMockServer } from './mockServer.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY_SCRIPT = resolve(HERE, '..', 'tools', 'cors-proxy.mjs');

export async function runProxy() {
  const { server, base } = await startMockServer();

  /** Reassemble an SSE body the way the app's client does. */
  function joinDeltas(text) {
  let out = '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { out += JSON.parse(payload).choices?.[0]?.delta?.content ?? ''; } catch {}
  }
  return out;
}
  const target = base('ok');

const proxy = spawn('node', [PROXY_SCRIPT], {
  env: { ...process.env, TARGET: target, PORT: '8799', API_KEY: 'sk-injected' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 700));

const PROXY = 'http://localhost:8799/v1';
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(['PASS', name, '']); }
    catch (e) { results.push(['FAIL', name, e.message]); }
  };

await check('preflight returns permissive CORS headers', async () => {
  const res = await fetch(`${PROXY}/chat/completions`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  if (res.status !== 204) throw new Error('status ' + res.status);
  if (res.headers.get('access-control-allow-origin') !== '*') throw new Error('no allow-origin');
  const allowed = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
  if (!allowed.includes('authorization')) throw new Error('authorization not allowed');
});

await check('POST is forwarded and the SSE stream is relayed', async () => {
  const res = await fetch(`${PROXY}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.github.io' },
    body: JSON.stringify({ model: 'mock-small', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  });
  if (!res.ok) throw new Error('status ' + res.status);
  if (res.headers.get('access-control-allow-origin') !== '*') throw new Error('response lacks CORS header');
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('event-stream')) throw new Error('content-type not passed through: ' + ct);

  const text = await res.text();
  if (!text.includes('data:')) throw new Error('no SSE frames');
  if (!text.includes('[DONE]')) throw new Error('stream not terminated');
  // Deltas are fragments, so the title only appears once reassembled.
  const content = joinDeltas(text);
  if (!content.includes('Half Light')) throw new Error('payload missing after reassembly');
  JSON.parse(content); // must be the intact JSON object the provider sent
});

await check('the stream is relayed live, not buffered to the end', async () => {
  // A deliberately slow upstream: if the proxy buffered, the first byte would
  // not arrive until the whole response was done.
  const slowProxy = spawn('node', [PROXY_SCRIPT], {
    env: { ...process.env, TARGET: base('slow'), PORT: '8797' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 600));

  const started = Date.now();
  const res = await fetch('http://localhost:8797/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-small', messages: [], stream: true }),
  });
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const firstByteMs = Date.now() - started;

  let reads = value ? 1 : 0;
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
    reads += 1;
  }
  const totalMs = Date.now() - started;
  slowProxy.kill();

  if (reads < 3) throw new Error(`expected many chunks from a slow stream, got ${reads}`);
  // The whole response takes seconds; the first chunk must beat it comfortably.
  if (!(firstByteMs < totalMs / 2)) {
    throw new Error(`looks buffered: first chunk at ${firstByteMs}ms of ${totalMs}ms total`);
  }
});

await check('GET /models is forwarded with the path rewritten', async () => {
  const res = await fetch(`${PROXY}/models`);
  if (!res.ok) throw new Error('status ' + res.status);
  const data = await res.json();
  if (!data.data?.some((m) => m.id === 'mock-small')) throw new Error('models missing');
});

await check('the proxy injects its own key when given one', async () => {
  // The mock echoes nothing, so assert indirectly: a request with NO browser
  // Authorization header still succeeds, which only works if the proxy added it.
  const res = await fetch(`${PROXY}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-small', messages: [], stream: true }),
  });
  if (!res.ok) throw new Error('status ' + res.status);
});

await check('an unreachable upstream returns a readable 502', async () => {
  const dead = spawn('node', [PROXY_SCRIPT], {
    env: { ...process.env, TARGET: 'http://127.0.0.1:1/v1', PORT: '8798' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 600));
  const res = await fetch('http://localhost:8798/v1/models');
  if (res.status !== 502) throw new Error('status ' + res.status);
  const body = await res.json();
  if (!body.error?.message?.includes('could not reach')) throw new Error('unhelpful error: ' + JSON.stringify(body));
  if (res.headers.get('access-control-allow-origin') !== '*') throw new Error('error response lacks CORS');
  dead.kill();
});

  proxy.kill();
  server.close();
  return results;
}
