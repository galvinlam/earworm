/**
 * Verifies the built app really is installable and really works offline:
 * manifest validity, icons that resolve, service-worker activation, and a
 * cold load with the network switched off.
 *
 * Needs a real browser, so it runs through Playwright. Playwright is NOT a
 * project dependency — it is a ~300 MB install and most contributors never
 * touch the PWA layer — so these checks report as skipped when it is absent
 * rather than failing the suite.
 */

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Playwright, from the project or from a global install, or null. */
async function loadPlaywright() {
  for (const specifier of ['playwright', '/opt/npm-tools/node_modules/playwright/index.js']) {
    try {
      const mod = await import(specifier);
      return mod.chromium ?? mod.default?.chromium ?? null;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

export async function runPwa() {
  if (!existsSync(join(DIST, 'index.html'))) {
    return [['SKIP', 'PWA checks (no dist/ — run `npm run build` first)', '']];
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    return [['SKIP', 'PWA checks (Playwright not installed)', 'npm i -D playwright to enable']];
  }

  const results = [];
  const check = (name, ok, detail = '') => results.push([ok ? 'PASS' : 'FAIL', name, ok ? '' : detail]);

  const server = http.createServer((req, res) => {
    let p = join(DIST, decodeURIComponent(req.url.split('?')[0]));
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });

  try {
    const page = await ctx.newPage();
    await page.goto(origin + '/', { waitUntil: 'networkidle' });

    // ---- manifest -------------------------------------------------------
    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    check('pwa: the page links a manifest', !!href);

    const manifest = href ? await page.evaluate(async (h) => (await fetch(h)).json(), href) : {};
    check('pwa: manifest names the app', !!manifest.name && !!manifest.short_name);
    check('pwa: display is standalone', manifest.display === 'standalone', manifest.display);
    check('pwa: has 192px and 512px icons',
      ['192x192', '512x512'].every((s) => (manifest.icons || []).some((i) => i.sizes === s)));
    check('pwa: has a maskable icon for Android',
      (manifest.icons || []).some((i) => i.purpose === 'maskable'));
    check('pwa: theme and background colours are set',
      !!manifest.theme_color && !!manifest.background_color);

    let iconsOk = true;
    for (const icon of manifest.icons || []) {
      const status = await page.evaluate(
        async (u) => (await fetch(u)).status,
        new URL(icon.src, origin + '/').href,
      );
      if (status !== 200) iconsOk = false;
    }
    check('pwa: every manifest icon resolves', iconsOk);

    // ---- iOS ------------------------------------------------------------
    check('pwa: apple-touch-icon is a PNG, which iOS requires',
      ((await page.getAttribute('link[rel="apple-touch-icon"]', 'href')) || '').endsWith('.png'));
    check('pwa: iOS standalone meta is present',
      (await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content')) === 'yes');
    check('pwa: viewport opts into the full screen',
      ((await page.getAttribute('meta[name="viewport"]', 'content')) || '').includes('viewport-fit=cover'));

    // ---- service worker --------------------------------------------------
    const swActive = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active;
    });
    check('pwa: service worker activates', swActive);

    const precached = await page.evaluate(async () => {
      let total = 0;
      for (const n of await caches.keys()) total += (await (await caches.open(n)).keys()).length;
      return total;
    });
    check('pwa: the app shell is precached', precached > 5, `${precached} entries`);

    // ---- the actual point -----------------------------------------------
    await ctx.setOffline(true);
    const offline = await ctx.newPage();
    let loaded = true;
    try {
      await offline.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch {
      loaded = false;
    }
    const heading = loaded ? await offline.textContent('h1').catch(() => '') : '';
    check('pwa: the app loads with the network off', loaded && /EARWORM/i.test(heading || ''));
    const body = loaded ? await offline.textContent('body') : '';
    check('pwa: being offline is surfaced, not silent', /offline/i.test(body || ''));
    await ctx.setOffline(false);
  } finally {
    await browser.close();
    server.close();
  }

  return results;
}
