import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/index.mjs';

const testCode = 'test-only-private-setup-code-2026';
const testPassword = 'Test-only-owner-password-2026';
async function protectedServer(check) {
  const directory = await mkdtemp(join(tmpdir(), 'cap-integration-'));
  const app = createApp({ authEnabled: true, dataDirectory: directory, setupCode: testCode, secureCookies: false, apiKey: '', distDirectory: '/no-dist' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await check(base); }
  finally { await new Promise(resolve => server.close(resolve)); app.locals.closeAccounts(); await rm(directory, { recursive: true, force: true }); }
}
const send = (base, path, method, body, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('protected application rejects anonymous chat and storage, and accepts only its private owner', async () => {
  await protectedServer(async base => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const session = await (await fetch(base + '/api/auth/session')).json();
    assert.equal(session.authRequired, true); assert.equal(session.setupRequired, true);
    assert.equal((await send(base, '/api/chat', 'POST', { messages: [{ role: 'user', content: 'Mon budget' }] })).status, 401);
    assert.equal((await fetch(base + '/api/workspace')).status, 401);
    const setup = await send(base, '/api/auth/setup', 'POST', { username: 'owner-test', password: testPassword, setupCode: testCode });
    assert.equal(setup.status, 201);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const response = await send(base, '/api/chat', 'POST', { messages: [{ role: 'user', content: 'Mon budget' }] }, { Cookie: cookie });
    assert.equal(response.status, 200); assert.equal((await response.json()).mode, 'discovery');
    const storage = await fetch(base + '/api/workspace', { headers: { Cookie: cookie } });
    assert.equal(storage.status, 200); assert.equal(storage.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await storage.json(), { workspace: null, revision: 0 });
    await send(base, '/api/auth/logout', 'POST', {}, { Cookie: cookie });
    assert.equal((await fetch(base + '/api/workspace', { headers: { Cookie: cookie } })).status, 401);
  });
});

test('all state-changing account and workspace methods reject cross-site origins before mutation', async () => {
  await protectedServer(async base => {
    const headers = { Origin: 'https://unrelated.example', 'Sec-Fetch-Site': 'cross-site' };
    for (const [path, method, body] of [
      ['/api/auth/setup', 'POST', { username: 'owner-test', password: testPassword, setupCode: testCode }],
      ['/api/auth/login', 'POST', {}], ['/api/auth/logout', 'POST', {}],
      ['/api/auth/password', 'POST', {}], ['/api/workspace', 'PUT', { expectedRevision: 0 }],
      ['/api/workspace', 'DELETE', { expectedRevision: 0 }],
    ]) {
      const response = await send(base, path, method, body, headers);
      assert.equal(response.status, 403); assert.equal((await response.json()).code, 'ORIGIN_DENIED');
    }
    assert.equal((await (await fetch(base + '/api/auth/session')).json()).setupRequired, true);
  });
});

test('production refuses to start an application without authentication', () => {
  const oldMode = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; assert.throws(() => createApp({ authEnabled: false }), /CAP_AUTH_ENABLED=1/); }
  finally { if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode; }
});
