/**
 * Verifies offline audio rendering in a real browser.
 *
 * A WAV export is the one thing that cannot be checked against a stub: it needs
 * an actual Web Audio implementation. So this builds a small harness bundle
 * against real Tone.js, renders a song in headless Chromium, decodes the result
 * and measures it — because a silent or clipped file would pass a header check
 * and be useless.
 *
 * Playwright is not a project dependency, so these report as skipped when it is
 * absent rather than failing the suite.
 */

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, 'out-browser');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/**
 * A stand-in for any downloaded sample: a decaying tone, as a WAV. The
 * decoder sniffs the content, so it doesn't matter that the URL says .mp3 —
 * and serving it means these checks never depend on a CDN being reachable.
 *
 * Levels match the real files, because the mix is balanced for them: the
 * soundfont notes peak around -20 dBFS, the drum one-shots near full scale.
 */
function fakeSample(peak, seconds = 0.6, rate = 44100) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const v = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 6) * peak;
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
}

async function loadPlaywright() {
  for (const spec of ['playwright', '/opt/npm-tools/node_modules/playwright/index.js']) {
    try {
      const mod = await import(spec);
      return mod.chromium ?? mod.default?.chromium ?? null;
    } catch { /* try the next */ }
  }
  return null;
}

export async function runRender() {
  if (!existsSync(join(BUNDLE, 'index.html'))) {
    return [['SKIP', 'audio render (harness not built)', '']];
  }
  const chromium = await loadPlaywright();
  if (!chromium) {
    return [['SKIP', 'audio render (Playwright not installed)', 'npm i -D playwright to enable']];
  }

  const results = [];
  const check = (name, ok, detail = '') => results.push([ok ? 'PASS' : 'FAIL', name, ok ? '' : detail]);

  const server = http.createServer((req, res) => {
    let p = join(BUNDLE, decodeURIComponent(req.url.split('?')[0]));
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(BUNDLE, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();

    // Every outside request is answered here: samples get the fake tone (or
    // fail, when a check wants them to), anything else is refused.
    const NOTE = fakeSample(0.1);
    const HIT = fakeSample(0.9, 0.3);
    let serveSamples = true;
    await page.route((url) => url.origin !== origin, (route) => {
      const { pathname } = new URL(route.request().url());
      if (serveSamples && /\.mp3$/i.test(pathname)) {
        return route.fulfill({
          status: 200,
          body: pathname.includes('/drum-samples/') ? HIT : NOTE,
          headers: { 'content-type': 'audio/wav', 'access-control-allow-origin': '*' },
        });
      }
      return route.abort();
    });

    await page.goto(origin + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

    /** Render in the page and measure the decoded audio. */
    const analyse = (opts) => page.evaluate(async (o) => {
      const { blob, duration, degraded } = await window.__renderSongToWav({
        sections: [{ id: 'a', chords: ['G', 'Em', 'C', 'D'], melodyContour: ['1', '3', '5', '5^'] }],
        key: 'G major',
        tempo: 120,
        // Samples are served by the route above, never fetched for real.
        grooveId: 'rock', instrument: 'guitarClean',
        bassInstrument: 'electric', drumKit: 'machine',
        ...o,
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const ctx = new OfflineAudioContext(2, 1, 44100);
      const decoded = await ctx.decodeAudioData(bytes.slice().buffer);
      const ch = decoded.getChannelData(0);

      let peak = 0, sumSq = 0, audible = 0, clipped = 0;
      for (let i = 0; i < ch.length; i += 1) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
        sumSq += ch[i] * ch[i];
        if (a > 0.001) audible += 1;
        if (a >= 0.999) clipped += 1;
      }

      const buckets = 8, per = Math.floor(ch.length / buckets), energy = [];
      for (let b = 0; b < buckets; b += 1) {
        let e = 0;
        for (let i = b * per; i < (b + 1) * per; i += 1) e += ch[i] * ch[i];
        energy.push(Math.sqrt(e / per));
      }

      return {
        degraded,
        type: blob.type, size: bytes.length, duration,
        header: String.fromCharCode(...bytes.slice(0, 4)) + String.fromCharCode(...bytes.slice(8, 12)),
        sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels,
        decoded: decoded.duration,
        peak, rms: Math.sqrt(sumSq / ch.length),
        audiblePct: 100 * audible / ch.length,
        clipped, energy,
      };
    }, opts);

    const r = await analyse({});

    check('render: produces a valid WAV container', r.header === 'RIFFWAVE' && r.type === 'audio/wav', r.header);
    check('render: stereo at 44.1 kHz', r.channels === 2 && r.sampleRate === 44100,
      `${r.channels}ch @ ${r.sampleRate}`);
    check('render: length matches the arrangement', Math.abs(r.decoded - r.duration) < 0.1,
      `${r.decoded.toFixed(2)}s vs ${r.duration.toFixed(2)}s`);

    // The checks that matter: it has to contain music, not silence or mush.
    check('render: the file is not silent', r.rms > 0.01, `rms ${r.rms.toFixed(4)}`);
    check('render: it does not clip', r.clipped === 0 && r.peak < 0.99, `peak ${r.peak.toFixed(3)}, ${r.clipped} clipped`);
    check('render: level is usable, not a whisper', r.peak > 0.1, `peak ${r.peak.toFixed(3)}`);
    check('render: audio runs throughout, not just at the start',
      r.energy.slice(0, 6).every((e) => e > 0.01), r.energy.map((e) => e.toFixed(3)).join(' '));
    check('render: trailing silence is trimmed', r.audiblePct > 85, `${r.audiblePct.toFixed(1)}% audible`);

    // A different instrument must actually change the audio.
    const pad = await analyse({ instrument: 'pad', drumKit: 'off', mode: 'chords' });
    check('render: instrument choice changes the output',
      Math.abs(pad.rms - r.rms) > 0.005 || Math.abs(pad.peak - r.peak) > 0.02,
      `pad rms ${pad.rms.toFixed(4)} vs guitar ${r.rms.toFixed(4)}`);
    check('render: a chords-only pass still produces audio', pad.rms > 0.005, `rms ${pad.rms.toFixed(4)}`);

    // Sampled instruments: the first render above used them, served.
    check('render: sampled guitar and bass render from their samples', r.degraded === false, 'reported degraded');

    serveSamples = false;
    const standIn = await analyse({ instrument: 'guitarAcoustic', bassInstrument: 'upright', drumKit: 'off', mode: 'chords' });
    serveSamples = true;
    check('render: without samples, a sampled instrument renders on its stand-in',
      standIn.degraded === true && standIn.rms > 0.005,
      `degraded ${standIn.degraded}, rms ${standIn.rms.toFixed(4)}`);

    // Drum hits are made as the transport runs, after Tone has pointed its
    // global context back at the live one — so a kit that doesn't pin its
    // context renders a file with no kick, snare or hats in it.
    const drumsOnly = { sections: [{ id: 'a', chords: ['G', 'C', 'D', 'G'], melodyContour: [] }], mode: 'melody', instrument: 'pad' };
    const machine = await analyse({ ...drumsOnly, drumKit: 'machine' });
    const acoustic = await analyse({ ...drumsOnly, drumKit: 'acoustic' });
    check('render: the sampled kit is in the file, not just the speakers',
      acoustic.rms > machine.rms * 0.25,
      `acoustic rms ${acoustic.rms.toFixed(4)} vs machine ${machine.rms.toFixed(4)}`);
  } catch (err) {
    check('render: completed without throwing', false, err.message.split('\n')[0]);
  } finally {
    await browser.close();
    server.close();
  }

  return results;
}
