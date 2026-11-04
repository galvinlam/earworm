/**
 * Network-layer smoke tests: the real llmClient over a real HTTP server,
 * plus the generation hook driving the real store.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { chatCompletion, listModels, LLMError } from '../src/lib/llmClient.js';
import { parseModelJson, normaliseSong } from '../src/lib/songSchema.js';
import { useSongStore } from '../src/store/useSongStore.js';
import { useSettingsStore } from '../src/store/useSettingsStore.js';
import { useSongGeneration } from '../src/hooks/useSongGeneration.js';

const messages = [
  { role: 'system', content: 'test' },
  { role: 'user', content: 'test' },
];

/** Mounts the hook so tests can call its actions against the real store. */
function HookHarness({ apiRef }) {
  apiRef.current = useSongGeneration();
  return null;
}

export async function runNetwork(base) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(['PASS', name, '']); }
    catch (e) { results.push(['FAIL', name, e.message]); }
  };

  const call = (route, extra = {}) =>
    chatCompletion({
      baseUrl: base(route),
      apiKey: 'sk-test',
      model: 'mock-small',
      messages,
      ...extra,
    });

  // ------------------------------------------------------------- transport
  await check('llm: streamed response assembles correctly', async () => {
    let chunks = 0;
    const text = await call('ok', { onToken: () => { chunks += 1; } });
    if (chunks < 5) throw new Error(`expected many chunks, got ${chunks}`);
    const song = normaliseSong(parseModelJson(text), {});
    if (song.title !== 'Half Light') throw new Error('title wrong: ' + song.title);
    if (song.sections.length !== 2) throw new Error('section count wrong');
    if (song.sections[0].chords.join() !== 'Am,F,C,G') throw new Error('chords wrong');
  });

  await check('llm: non-streaming path', async () => {
    const text = await chatCompletion({
      baseUrl: base('nostream'), apiKey: 'sk-test', model: 'mock-small', messages, stream: false,
    });
    const song = normaliseSong(parseModelJson(text), {});
    if (song.title !== 'Half Light') throw new Error('title wrong');
  });

  await check('llm: messy output (fence + raw newlines + trailing comma) is repaired', async () => {
    const text = await call('messy');
    const song = normaliseSong(parseModelJson(text), {});
    if (song.title !== 'Half Light') throw new Error('title wrong');
    if (!song.sections[0].lyrics.includes('let the morning win')) throw new Error('lyrics lost');
    if (song.sections.length !== 2) throw new Error('sections lost: ' + song.sections.length);
  });

  await check('llm: truncated stream still yields a partial song', async () => {
    const text = await call('truncated');
    const song = normaliseSong(parseModelJson(text), {});
    if (song.title !== 'Half Light') throw new Error('title lost');
    if (!song.sections.length) throw new Error('no sections recovered');
  });

  await check('llm: prose-only response raises a parse error', async () => {
    const text = await call('notjson');
    try {
      parseModelJson(text);
      throw new Error('should have thrown');
    } catch (e) {
      if (!(e instanceof LLMError) || e.kind !== 'parse') throw new Error('wrong error: ' + e.message);
    }
  });

  // ---------------------------------------------------------------- errors
  const expectError = async (route, kind, needle) => {
    try {
      await call(route);
      throw new Error('should have thrown');
    } catch (e) {
      if (!(e instanceof LLMError)) throw new Error('not an LLMError: ' + e.message);
      if (e.kind !== kind) throw new Error(`kind was "${e.kind}", expected "${kind}"`);
      if (needle && !e.message.includes(needle)) throw new Error('message was: ' + e.message);
      if (!e.advice) throw new Error('no advice offered');
    }
  };

  await check('llm: 401 maps to an auth error with advice', () => expectError('e401', 'auth', 'Incorrect API key'));
  await check('llm: 429 maps to a rate-limit error', () => expectError('e429', 'rate-limit', 'Rate limit'));
  await check('llm: 500 maps to a server error', () => expectError('e500', 'server'));
  await check('llm: unknown route maps to bad-request', () => expectError('nope', 'bad-request'));

  await check('llm: missing key on a remote host is a config error', async () => {
    try {
      await chatCompletion({ baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'x', messages });
      throw new Error('should have thrown');
    } catch (e) {
      if (e.kind !== 'config') throw new Error('kind was ' + e.kind);
    }
  });

  await check('llm: localhost needs no key', async () => {
    const text = await chatCompletion({ baseUrl: base('ok'), apiKey: '', model: 'mock-small', messages });
    if (!text.includes('Half Light')) throw new Error('call failed without a key');
  });

  await check('llm: abort mid-stream raises an aborted error', async () => {
    const controller = new AbortController();
    const promise = chatCompletion({
      baseUrl: base('slow'), apiKey: 'sk-test', model: 'mock-small', messages, signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 40);
    try {
      await promise;
      throw new Error('should have aborted');
    } catch (e) {
      if (e.kind !== 'aborted') throw new Error('kind was ' + e.kind + ': ' + e.message);
    }
  });

  await check('llm: listModels returns ids', async () => {
    const models = await listModels({ baseUrl: base('ok'), apiKey: 'sk-test' });
    if (!models.includes('mock-small')) throw new Error('models missing: ' + models.join());
  });

  await check('llm: base URL with a trailing slash or /chat/completions is normalised', async () => {
    const text = await chatCompletion({
      baseUrl: `${base('ok')}/chat/completions`, apiKey: 'sk-test', model: 'mock-small', messages,
    });
    if (!text.includes('Half Light')) throw new Error('normalisation failed');
  });

  // --------------------------------------------- free-model failure modes
  await check('free models: a retired model id is replaced with a live free one', async () => {
    // The exact failure OpenRouter produces when it retires a :free variant.
    useSettingsStore.setState({
      baseUrl: base('retired'),
      model: 'deepseek/deepseek-chat:free',
      freeOnly: true,
      jsonMode: false,
      discoveredModels: [],
    });
    useSongStore.setState({ song: null, history: [], status: { state: 'idle', message: '', stage: '', streamText: '', target: null } });

    const c = document.createElement('div');
    document.body.appendChild(c);
    const r = createRoot(c);
    const ref = { current: null };
    await act(async () => { r.render(React.createElement(HookHarness, { apiRef: ref })); });
    await act(async () => { await ref.current.generateSong(); });

    const song = useSongStore.getState();
    if (song.status.state === 'error') {
      throw new Error('surfaced as an error instead of recovering: ' + song.status.message);
    }
    if (!song.song || song.song.title !== 'Half Light') throw new Error('no song after recovery');

    // It must land on a FREE replacement, never the paid slug the provider named.
    const now = useSettingsStore.getState().model;
    if (now === 'deepseek/deepseek-chat:free') throw new Error('model was not switched');
    if (now === 'deepseek/deepseek-chat') throw new Error('switched to the PAID slug the provider suggested');
    if (!/:free$/.test(now)) throw new Error('replacement is not a free model: ' + now);
    await act(async () => { r.unmount(); });
  });

  await check('free models: no free alternative gives advice, not a silent paid switch', async () => {
    // freeOnly off means any model is fair game, so force the no-pool case by
    // pointing at a provider whose listing fails.
    useSettingsStore.setState({
      baseUrl: base('retired'),
      model: 'gone/model:free',
      freeOnly: true,
      discoveredModels: [],
    });
    // Break the listing by pointing it somewhere with no /models route.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/models')) throw new Error('listing unavailable');
      return origFetch(url, init);
    };

    useSongStore.setState({ song: null, history: [], status: { state: 'idle', message: '', stage: '', streamText: '', target: null } });
    const c = document.createElement('div');
    document.body.appendChild(c);
    const r = createRoot(c);
    const ref = { current: null };
    await act(async () => { r.render(React.createElement(HookHarness, { apiRef: ref })); });
    await act(async () => { await ref.current.generateSong(); });
    globalThis.fetch = origFetch;

    const { status } = useSongStore.getState();
    if (status.state !== 'error') throw new Error('should have reported an error');
    if (!/no longer available/i.test(status.message)) throw new Error('message wrong: ' + status.message);
    // The paid slug may be mentioned as an option, but must not have been applied.
    if (useSettingsStore.getState().model === 'deepseek/deepseek-chat') {
      throw new Error('silently switched to a paid model');
    }
    if (!/paid|Test/i.test(status.advice || '')) throw new Error('advice not actionable: ' + status.advice);
    await act(async () => { r.unmount(); });
  });

  await check('free models: a model with no JSON mode is retried automatically', async () => {
    useSettingsStore.setState({ baseUrl: base('nojsonmode'), jsonMode: true, model: 'mock-small' });
    useSongStore.setState({ song: null, history: [], status: { state: 'idle', message: '', stage: '', streamText: '', target: null } });

    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    const ref = { current: null };
    await act(async () => { root2.render(React.createElement(HookHarness, { apiRef: ref })); });

    await act(async () => { await ref.current.generateSong(); });

    const s = useSongStore.getState();
    if (s.status.state === 'error') throw new Error('surfaced as an error instead of retrying: ' + s.status.message);
    if (!s.song) throw new Error('no song produced');
    if (s.song.title !== 'Half Light') throw new Error('wrong song');
    // The setting should now be off, so the next call does not repeat the failure.
    if (useSettingsStore.getState().jsonMode !== false) {
      throw new Error('jsonMode was not turned off after the rejection');
    }
    await act(async () => { root2.unmount(); });
  });

  await check('free models: prose instead of JSON is corrected and retried', async () => {
    useSettingsStore.setState({ baseUrl: base('prosefirst'), jsonMode: false, model: 'mock-small' });
    useSongStore.setState({ song: null, history: [], status: { state: 'idle', message: '', stage: '', streamText: '', target: null } });

    const container3 = document.createElement('div');
    document.body.appendChild(container3);
    const root3 = createRoot(container3);
    const ref = { current: null };
    await act(async () => { root3.render(React.createElement(HookHarness, { apiRef: ref })); });

    await act(async () => { await ref.current.generateSong(); });

    const s = useSongStore.getState();
    if (s.status.state === 'error') throw new Error('gave up instead of retrying: ' + s.status.message);
    if (!s.song || s.song.title !== 'Half Light') throw new Error('the retry did not produce the song');
    await act(async () => { root3.unmount(); });
  });

  await check('free models: a model that never complies fails with useful advice', async () => {
    useSettingsStore.setState({ baseUrl: base('alwaysprose'), jsonMode: false, model: 'mock-small' });
    useSongStore.setState({ song: null, history: [], status: { state: 'idle', message: '', stage: '', streamText: '', target: null } });

    const container4 = document.createElement('div');
    document.body.appendChild(container4);
    const root4 = createRoot(container4);
    const ref = { current: null };
    await act(async () => { root4.render(React.createElement(HookHarness, { apiRef: ref })); });

    await act(async () => { await ref.current.generateSong(); });

    const s = useSongStore.getState();
    if (s.status.state !== 'error') throw new Error('should have failed after two attempts');
    if (!/twice/i.test(s.status.message)) throw new Error('message should say it tried twice: ' + s.status.message);
    if (!s.status.advice || !/free/i.test(s.status.advice)) throw new Error('advice should mention free models');
    if (s.song) throw new Error('a failed generate should not install a song');
    await act(async () => { root4.unmount(); });
  });

  /** Ask the echo route what the client actually put on the wire. */
  const sentRequest = async (overrides = {}) => {
    const res = await fetch(`${base('echo')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    });
    await res.json();
    // Now the real client, so the assertion is about its behaviour.
    let captured = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), init };
      return origFetch(url, init);
    };
    try {
      await chatCompletion({
        baseUrl: base('echo'), apiKey: 'sk-test', model: 'mock-small',
        messages, stream: false, ...overrides,
      });
    } finally {
      globalThis.fetch = origFetch;
    }
    return {
      body: JSON.parse(captured.init.body),
      headers: captured.init.headers,
      url: captured.url,
    };
  };

  await check('free models: max_tokens reaches the provider', async () => {
    const sent = await sentRequest({ maxTokens: 1234 });
    if (sent.body.max_tokens !== 1234) {
      throw new Error('max_tokens missing from the request body: ' + JSON.stringify(sent.body.max_tokens));
    }
    // Zero means "do not constrain", and must not appear at all.
    const none = await sentRequest({ maxTokens: 0 });
    if ('max_tokens' in none.body) throw new Error('max_tokens should be omitted when unset');
  });

  await check('free models: JSON mode is sent only when enabled', async () => {
    const on = await sentRequest({ jsonMode: true });
    if (on.body.response_format?.type !== 'json_object') throw new Error('response_format missing');
    const off = await sentRequest({ jsonMode: false });
    if ('response_format' in off.body) throw new Error('response_format should be omitted when off');
  });

  await check('free models: OpenRouter attribution is sent only to OpenRouter', async () => {
    const other = await sentRequest();
    if ('X-Title' in other.headers) throw new Error('attribution leaked to an unrelated host');

    // The header logic keys off the host, so check it directly.
    let captured = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      captured = init;
      throw new Error('intercepted');
    };
    try {
      await chatCompletion({
        baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test',
        model: 'x', messages, stream: false,
      }).catch(() => {});
    } finally {
      globalThis.fetch = origFetch;
    }
    if (captured?.headers?.['X-Title'] !== 'Earworm') {
      throw new Error('OpenRouter attribution header missing');
    }
    if (!captured?.headers?.['HTTP-Referer']) throw new Error('referer header missing');
  });

  // ------------------------------------------------------------- the hook
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const apiRef = { current: null };

  useSettingsStore.setState({ apiKey: 'sk-test', baseUrl: base('ok'), model: 'mock-small', streaming: true });
  useSongStore.setState({ song: null, history: [], status: { state: 'idle', message: '', stage: '', streamText: '', target: null } });

  await act(async () => { root.render(React.createElement(HookHarness, { apiRef })); });

  await check('hook: generateSong fills the store and clears status', async () => {
    await act(async () => { await apiRef.current.generateSong(); });
    const s = useSongStore.getState();
    if (!s.song) throw new Error('no song stored');
    if (s.song.title !== 'Half Light') throw new Error('title wrong');
    if (s.status.state !== 'idle') throw new Error('status not cleared: ' + s.status.state);
    if (!s.history.length) throw new Error('no history snapshot written');
  });

  await check('hook: regenerateSection replaces only that section', async () => {
    useSettingsStore.setState({ baseUrl: base('section') });
    const before = useSongStore.getState().song;
    const verseId = before.sections[0].id;
    const chorusId = before.sections[1].id;
    await act(async () => { await apiRef.current.regenerateSection(chorusId, 'Make it anthemic'); });
    const after = useSongStore.getState().song;
    if (after.sections[0].lyrics !== before.sections[0].lyrics) throw new Error('verse was modified');
    if (!after.sections[1].lyrics.includes('Burn it brighter')) throw new Error('chorus not replaced');
    if (after.sections[1].id !== chorusId) throw new Error('section id changed');
    if (after.sections[0].id !== verseId) throw new Error('verse id changed');
  });

  await check('hook: a locked section survives a full regenerate', async () => {
    useSettingsStore.setState({ baseUrl: base('ok') });
    const current = useSongStore.getState().song;
    const chorus = current.sections.find((x) => x.label === 'Chorus');
    await act(async () => { useSongStore.getState().toggleLock(chorus.id); });
    const lockedLyrics = useSongStore.getState().song.sections.find((x) => x.id === chorus.id).lyrics;

    await act(async () => { await apiRef.current.regenerateAll(); });

    const after = useSongStore.getState().song;
    const newChorus = after.sections.find((x) => x.label === 'Chorus');
    if (!newChorus) throw new Error('chorus vanished');
    if (newChorus.lyrics !== lockedLyrics) throw new Error('locked chorus was overwritten');
    if (!newChorus.locked) throw new Error('lock flag lost');
  });

  await check('hook: an API error lands in status, not an exception', async () => {
    useSettingsStore.setState({ baseUrl: base('e429') });
    await act(async () => { await apiRef.current.generateSong(); });
    const { status } = useSongStore.getState();
    if (status.state !== 'error') throw new Error('status not error: ' + status.state);
    if (!status.message.includes('Rate limit')) throw new Error('message wrong: ' + status.message);
    if (!status.advice) throw new Error('no advice');
  });

  await check('hook: a failed generate leaves the previous song intact', () => {
    const s = useSongStore.getState();
    if (!s.song) throw new Error('song was wiped by a failed request');
    if (s.song.title !== 'Half Light') throw new Error('song changed');
  });

  await check('hook: cancel stops an in-flight generation', async () => {
    useSettingsStore.setState({ baseUrl: base('slow') });
    await act(async () => {
      const p = apiRef.current.generateSong();
      setTimeout(() => apiRef.current.cancel(), 40);
      await p;
    });
    const { status } = useSongStore.getState();
    if (status.state === 'error') throw new Error('cancel surfaced as an error: ' + status.message);
  });

  await act(async () => { root.unmount(); });
  return results;
}
