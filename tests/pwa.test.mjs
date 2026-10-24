import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { buildPwa } from '../scripts/build-pwa.mjs';

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'cap-pwa-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, 'assets'));
  await mkdir(resolve(directory, 'icons'));
  for (const [path, content] of Object.entries({
    'index.html': '<html><head></head><body>CAP public shell</body></html>',
    'manifest.webmanifest': '{}', 'favicon.svg': '<svg/>',
    'icons/cap-192.png': 'png192', 'icons/cap-512.png': 'png512',
    'icons/cap-maskable-512.png': 'maskable', 'icons/apple-touch-icon.png': 'apple',
    'assets/index-abc.js': 'console.log("shell")', 'assets/index-def.css': 'body{}',
    'private.json': 'must not be cached',
  })) await writeFile(resolve(directory, path), content);
  return directory;
}

function worker(script, { cacheEntries = new Map(), cacheKeys = [], offline = false } = {}) {
  const handlers = new Map();
  const events = { opened: [], added: [], deleted: [], skipped: 0, claimed: 0, fetched: [] };
  const cache = {
    addAll: async requests => { events.added.push(...requests); },
    match: async key => cacheEntries.get(typeof key === 'string' ? key : new URL(key.url).pathname)?.clone(),
  };
  const context = {
    self: { location: { origin: 'https://cap.example' }, addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: () => { events.skipped += 1; }, clients: { claim: async () => { events.claimed += 1; } } },
    caches: { open: async key => { events.opened.push(key); return cache; }, keys: async () => cacheKeys, delete: async key => { events.deleted.push(key); return true; } },
    URL, Response,
    Request: class extends Request { constructor(input, options) { super(new URL(input, 'https://cap.example'), options); } },
    fetch: async request => { events.fetched.push(request); if (offline) throw Error('offline'); return new Response('network', { status: 200 }); },
    Set,
  };
  vm.runInNewContext(script, context);
  return {
    events,
    async lifecycle(type) { let pending; handlers.get(type)({ waitUntil: promise => { pending = promise; } }); await pending; },
    message(data) { handlers.get('message')({ data }); },
    async request(path, { method = 'GET', mode = 'cors' } = {}) {
      let pending;
      const request = { method, mode, url: new URL(path, 'https://cap.example').href };
      handlers.get('fetch')({ request, respondWith: promise => { pending = promise; } });
      return pending ? await pending : null;
    },
  };
}

test('PWA cache version follows complete public build and excludes non-shell data', async t => {
  const directory = await fixture(t);
  const first = await buildPwa({ distDirectory: directory });
  const second = await buildPwa({ distDirectory: directory });
  assert.equal(first.cacheName, second.cacheName);
  assert.ok(first.paths.includes('/index.html'));
  assert.ok(first.paths.includes('/icons/apple-touch-icon.png'));
  assert.ok(!first.paths.includes('/private.json'));
  assert.ok(!first.paths.some(path => path.startsWith('/api')));
  await writeFile(resolve(directory, 'assets/index-abc.js'), 'console.log("new shell")');
  const changed = await buildPwa({ distDirectory: directory });
  assert.notEqual(first.cacheName, changed.cacheName);
});

test('PWA build rejects assets linked outside the public build', async t => {
  const directory = await fixture(t);
  await symlink(resolve(directory, 'private.json'), resolve(directory, 'assets/leak.js'));
  await assert.rejects(buildPwa({ distDirectory: directory }), /symbolic links/);
});

test('service worker installation caches public shell without cookies and waits for consent to update', async t => {
  const directory = await fixture(t);
  const { cacheName, paths } = await buildPwa({ distDirectory: directory });
  const script = await readFile(resolve(directory, 'sw.js'), 'utf8');
  const loaded = worker(script, { cacheKeys: ['cap-static-old', cacheName, 'another-app-cache'] });
  await loaded.lifecycle('install');
  assert.equal(loaded.events.added.length, paths.length);
  assert.ok(loaded.events.added.every(request => request.credentials === 'omit' && request.cache === 'reload'));
  assert.equal(loaded.events.skipped, 0);
  await loaded.lifecycle('activate');
  assert.deepEqual(loaded.events.deleted, ['cap-static-old']);
  assert.equal(loaded.events.claimed, 1);
  loaded.message({ type: 'SOMETHING_ELSE' });
  assert.equal(loaded.events.skipped, 0);
  loaded.message({ type: 'CAP_ACTIVATE_UPDATE' });
  assert.equal(loaded.events.skipped, 1);
});

test('service worker never intercepts API, private data, third parties or writes', async t => {
  const directory = await fixture(t);
  await buildPwa({ distDirectory: directory });
  const loaded = worker(await readFile(resolve(directory, 'sw.js'), 'utf8'));
  for (const [path, options] of [
    ['/api/status', {}], ['/api/auth/session', {}], ['/api/workspace', {}],
    ['/api/chat', { method: 'POST' }], ['/index.html', { method: 'POST' }],
    ['/private.json', {}], ['https://example.org/assets/index-abc.js', {}],
    ['/assets/index-abc.js?private=1', {}], ['/auth/logout', {}],
  ]) assert.equal(await loaded.request(path, options), null, path);
  assert.equal(loaded.events.opened.length, 0);
  assert.equal(loaded.events.fetched.length, 0);
});

test('offline navigation uses its own precached shell and assets without caching network responses', async t => {
  const directory = await fixture(t);
  await buildPwa({ distDirectory: directory });
  const entries = new Map([['/index.html', new Response('same-build-index')], ['/assets/index-abc.js', new Response('same-build-script')]]);
  const offline = worker(await readFile(resolve(directory, 'sw.js'), 'utf8'), { cacheEntries: entries, offline: true });
  assert.equal(await (await offline.request('/', { mode: 'navigate' })).text(), 'same-build-index');
  assert.equal(await (await offline.request('/assets/index-abc.js')).text(), 'same-build-script');
  assert.equal(offline.events.fetched.length, 1);
  assert.equal(await offline.request('/unknown-route', { mode: 'navigate' }), null);
  const online = worker(await readFile(resolve(directory, 'sw.js'), 'utf8'), { cacheEntries: entries });
  assert.equal(await (await online.request('/', { mode: 'navigate' })).text(), 'network');
  assert.equal(online.events.added.length, 0);
});

test('public app manifest describes an iPhone-compatible standalone app and real PNG icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.lang, 'fr');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512', '512x512']);
  for (const icon of manifest.icons) {
    const bytes = await readFile(new URL('../public' + icon.src, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  }
  const apple = await readFile(new URL('../public/icons/apple-touch-icon.png', import.meta.url));
  assert.equal(apple.readUInt32BE(16), 180);
});
