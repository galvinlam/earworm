/**
 * Smoke-test runner: boots jsdom, mounts the real app, and runs both suites.
 */
import { JSDOM } from 'jsdom';
import { startMockServer } from './mockServer.mjs';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://example.test/earworm/',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const { server, base } = await startMockServer();

const { run } = await import('./out/entry.js');
const { runNetwork } = await import('./out/network.js');
const { runAudio } = await import('./out/audio.js');
const { runProxy } = await import('./proxy.mjs');
const { runPwa } = await import('./pwa.mjs');
const { runRender } = await import('./render.mjs');

const uiResults = await run().then((r) => r.results);
const netResults = await runNetwork(base);
const audioResults = await runAudio();
const proxyResults = await runProxy();
const pwaResults = await runPwa();
const renderResults = await runRender();

server.close();

const print = (title, rows) => {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  for (const [state, name, detail] of rows) {
    const mark = state === 'PASS' ? ' ok ' : state === 'SKIP' ? 'skip' : 'FAIL';
    console.log(`${mark}  ${name}${detail ? '  — ' + detail : ''}`);
  }
};

print('UI and state', uiResults);
print('Network and generation', netResults);
print('Audio scheduling', audioResults);
print('CORS proxy', proxyResults);
print('Installable app (PWA)', pwaResults);
print('Offline audio render', renderResults);

const all = [...uiResults, ...netResults, ...audioResults, ...proxyResults, ...pwaResults, ...renderResults];
const failed = all.filter(([s]) => s === 'FAIL').length;
const skipped = all.filter(([s]) => s === 'SKIP').length;
console.log(
  `\n${all.length - failed - skipped}/${all.length - skipped} passing`
  + (skipped ? ` (${skipped} skipped)` : ''),
);
process.exit(failed ? 1 : 0);
