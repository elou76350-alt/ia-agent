import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneHtml, exportStandalone, resolveAsset } from '../scripts/export-standalone.mjs';

async function fixture(t, { script = 'window.first = "</script><div>texte</div>";', css = '.sample { color: green; }', extraHtml = '' } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'cap-standalone-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const dist = join(parent, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'assets', 'first.js'), script);
  await writeFile(join(dist, 'assets', 'second.js'), 'window.second = true;');
  await writeFile(join(dist, 'assets', 'style.css'), css);
  await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><head><link rel="icon" href="/favicon.svg"><script type="module" crossorigin src="/assets/first.js"></script><link rel="stylesheet" href="/assets/style.css"><script type="module" src="/assets/second.js"></script>' + extraHtml + '</head><body><div id="root"></div></body></html>');
  return { parent, dist };
}

test('standalone embeds compiled resources, preserves script order and escapes raw closing tags', async t => {
  const { dist } = await fixture(t, { css: '.sample::before { content: "</style><div>texte</div>"; }' });
  const html = await createStandaloneHtml(dist);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /window\.__CAP_STANDALONE__=true/);
  assert.ok(html.indexOf('__CAP_STANDALONE__') < html.indexOf('window.first'));
  assert.ok(html.indexOf('window.first') < html.indexOf('window.second'));
  assert.ok(html.includes('<\\/script><div>texte</div>'));
  assert.ok(html.includes('\\3c /style><div>texte</div>'));
  assert.doesNotMatch(html, /\ssrc="\/assets|href="\/assets|crossorigin/);
  assert.equal((html.match(/<\/script>/g) || []).length, 3);
  assert.equal((html.match(/<\/style>/g) || []).length, 1);
});

test('standalone embeds relative CSS images and removes unnecessary preload requests', async t => {
  const { dist } = await fixture(t, { css: '.sample { background: url("./image.svg"); mask: url(#shape); }', extraHtml: '<link rel="modulepreload" href="/assets/first.js">' });
  await writeFile(join(dist, 'assets', 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  const html = await createStandaloneHtml(dist);
  assert.match(html, /background: url\("data:image\/svg\+xml;base64,/);
  assert.match(html, /mask: url\(#shape\)/);
  assert.doesNotMatch(html, /modulepreload/);
});

test('standalone resource resolution blocks traversal, encoded traversal and escaping symlinks', async t => {
  const { parent, dist } = await fixture(t);
  await writeFile(join(parent, 'outside.js'), 'never embed this outside file');
  await symlink(join(parent, 'outside.js'), join(dist, 'assets', 'outside.js'));
  for (const path of ['../outside.js', '/%2e%2e/outside.js', 'assets\\..\\outside.js', '/assets/outside.js', 'https://example.com/script.js', '//example.com/script.js']) {
    await assert.rejects(resolveAsset(dist, path), /externe|sort du dossier|fichier du dossier/);
  }
  assert.equal(await resolveAsset(dist, '/assets/first.js?v=1#x'), join(dist, 'assets', 'first.js'));
});

test('standalone fails explicitly when compiled files or a bundle are missing', async t => {
  const { parent, dist } = await fixture(t);
  await assert.rejects(createStandaloneHtml(join(parent, 'absent')), /npm run build/);
  await rm(join(dist, 'assets', 'first.js'));
  await assert.rejects(createStandaloneHtml(dist), /Ressource compilée introuvable/);
});

test('standalone refuses external CSS resources and unresolved JavaScript imports', async t => {
  const { dist } = await fixture(t, { css: '.sample { background: url(https://example.com/image.png); }' });
  await assert.rejects(createStandaloneHtml(dist), /externe/);
  await writeFile(join(dist, 'assets', 'style.css'), '@import "https://example.com/font.css";');
  await assert.rejects(createStandaloneHtml(dist), /@import/);
  await writeFile(join(dist, 'assets', 'style.css'), 'body { color: green; }');
  await writeFile(join(dist, 'assets', 'first.js'), 'import { value } from "./chunk.js";');
  await assert.rejects(createStandaloneHtml(dist), /imports non regroupés/);
});

test('standalone exports repeatably from compiled public assets without adding environment secrets', async t => {
  const { parent, dist } = await fixture(t);
  const outputFile = join(parent, 'outputs', 'CAP.html');
  const before = process.env.AGENT_API_KEY;
  process.env.AGENT_API_KEY = 'private-test-marker-never-export';
  try {
    const first = await exportStandalone({ distDirectory: dist, outputFile });
    const html = await readFile(outputFile, 'utf8');
    const second = await exportStandalone({ distDirectory: dist, outputFile });
    assert.equal(first.bytes, Buffer.byteLength(html));
    assert.deepEqual(first, second);
    assert.equal(await readFile(outputFile, 'utf8'), html);
    assert.doesNotMatch(html, /private-test-marker-never-export/);
  } finally {
    if (before === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = before;
  }
});
