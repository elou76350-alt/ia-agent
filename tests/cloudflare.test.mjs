import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker, { FREE_MODEL, DAILY_CHAT_LIMIT } from '../cloudflare/worker.mjs';

class LocalD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) {
    const database = this.db;
    const statement = {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return database.prepare(sql).get(...this.values) || null; },
      async run() { const result = database.prepare(sql).run(...this.values); return { success: true, meta: { changes: result.changes } }; },
    };
    return statement;
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function fixture(t) {
  const calls = [];
  const env = {
    DB: new LocalD1(),
    CAP_SETUP_CODE: 'Public-dummy-test-setup-code-2026',
    CAP_DATA_KEY: 'Public-dummy-test-encryption-key-never-use-in-production',
    AI: { run: async (...args) => { calls.push(args); return { response: 'Réponse de test du modèle gratuit.' }; } },
    ASSETS: { fetch: async () => new Response('<html>CAP</html>', { headers: { 'Content-Type': 'text/html' } }) },
  };
  t.after(() => env.DB.db.close());
  const call = (path, method = 'GET', body, cookie, headers = {}) => worker.fetch(new Request('https://cap.example' + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: 'https://cap.example', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const setup = async () => {
    const response = await call('/api/auth/setup', 'POST', { username: 'cap-owner', password: 'Public-only-fake-test-password-2026', setupCode: env.CAP_SETUP_CODE });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { env, calls, call, setup };
}

const sample = () => ({ version: 1, isDemo: false, habitDate: '2026-10-24', data: {
  profile: { firstName: 'Test privé', profession: 'Patient Experience Specialist', country: '' },
  finance: { monthlyIncome: 2000, savings: 100, expenses: [] },
  goals: [{ id: 'goal-test', title: 'Un objectif privé de test', category: 'Carrière', done: false }], habits: [], checkins: [],
}, messages: [] });

test('free Worker initializes D1, protects anonymous APIs and declares the real model and provider', async t => {
  const { call } = fixture(t);
  assert.equal((await call('/')).status, 200);
  assert.deepEqual(await (await call('/api/health')).json(), { ok: true });
  const status = await (await call('/api/status')).json();
  assert.equal(status.provider, 'Cloudflare Workers AI'); assert.equal(status.model, FREE_MODEL);
  assert.equal(status.freePlan, true); assert.equal(status.dailyChatLimit, DAILY_CHAT_LIMIT); assert.equal(status.providerVerified, false);
  const session = await (await call('/api/auth/session')).json();
  assert.equal(session.authRequired, true); assert.equal(session.setupRequired, true); assert.equal(session.setupAvailable, true);
  assert.equal((await call('/api/workspace')).status, 401);
  assert.equal((await call('/api/chat', 'POST', { messages: [{ role: 'user', content: 'Bonjour' }] })).status, 401);
});

test('free Worker requires private bootstrap, uses salted scrypt and issues Secure opaque cookies', async t => {
  const { env, call, setup } = fixture(t);
  const wrong = await call('/api/auth/setup', 'POST', { username: 'cap-owner', password: 'Public-only-fake-test-password-2026', setupCode: 'bad' });
  assert.equal(wrong.status, 401);
  const cookie = await setup();
  assert.match(cookie, /^cap_session=[A-Za-z0-9_-]{43}$/);
  const record = env.DB.db.prepare('SELECT * FROM owner').get();
  assert.notEqual(record.password_hash, 'Public-only-fake-test-password-2026'); assert.equal(record.salt.length, 32);
  assert.equal((await call('/api/auth/setup', 'POST', {})).status, 409);
  assert.equal((await (await call('/api/auth/session', 'GET', undefined, cookie)).json()).user.username, 'cap-owner');
  const login = await call('/api/auth/login', 'POST', { username: 'cap-owner', password: 'Public-only-fake-test-password-2026' });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /Secure/);
  assert.equal((await call('/api/auth/logout', 'POST', {}, cookie)).status, 200);
  assert.equal((await call('/api/workspace', 'GET', undefined, cookie)).status, 401);
});

test('free Worker persists encrypted workspaces, prevents stale updates and keeps deletion revisions', async t => {
  const { env, call, setup } = fixture(t); const cookie = await setup(); const workspace = sample();
  workspace.extraSecret = 'Ignored data';
  const initial = await call('/api/workspace', 'PUT', { workspace, expectedRevision: 0 }, cookie);
  assert.equal(initial.status, 200); assert.equal((await initial.json()).revision, 1);
  const raw = env.DB.db.prepare('SELECT encrypted FROM workspace').get().encrypted;
  assert.ok(!raw.includes('Un objectif privé')); assert.ok(!raw.includes('Test privé')); assert.ok(!raw.includes('Ignored data'));
  const restored = await (await call('/api/workspace', 'GET', undefined, cookie)).json();
  assert.equal(restored.workspace.data.profile.firstName, 'Test privé'); assert.equal(restored.workspace.extraSecret, undefined);
  assert.equal((await call('/api/workspace', 'PUT', { workspace, expectedRevision: 0 }, cookie)).status, 409);
  workspace.data.profile.firstName = 'Version suivante';
  const updated = await call('/api/workspace', 'PUT', { workspace, expectedRevision: 1 }, cookie);
  assert.equal(updated.status, 200); assert.equal((await updated.json()).revision, 2);
  const cleared = await call('/api/workspace', 'DELETE', { expectedRevision: 2 }, cookie);
  assert.equal((await cleared.json()).revision, 3);
  assert.deepEqual(await (await call('/api/workspace', 'GET', undefined, cookie)).json(), { workspace: null, revision: 3 });
  assert.equal((await call('/api/workspace', 'PUT', { workspace, expectedRevision: 0 }, cookie)).status, 409);
  assert.equal((await call('/api/workspace', 'PUT', { workspace, expectedRevision: 3 }, cookie)).status, 200);
});

test('free Worker rotation revokes old sessions and the old password, without losing saved data', async t => {
  const { call, setup } = fixture(t); const cookie = await setup();
  await call('/api/workspace', 'PUT', { workspace: sample(), expectedRevision: 0 }, cookie);
  const wrong = await call('/api/auth/password', 'POST', { currentPassword: 'Wrong-password', newPassword: 'Another-public-fake-password-2026' }, cookie);
  assert.equal(wrong.status, 401); assert.equal((await wrong.json()).code, 'PASSWORD_INVALID');
  const changed = await call('/api/auth/password', 'POST', { currentPassword: 'Public-only-fake-test-password-2026', newPassword: 'Another-public-fake-password-2026' }, cookie);
  assert.equal(changed.status, 200); const next = changed.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/workspace', 'GET', undefined, cookie)).status, 401);
  assert.equal((await call('/api/workspace', 'GET', undefined, next)).status, 200);
  assert.equal((await call('/api/auth/login', 'POST', { username: 'cap-owner', password: 'Public-only-fake-test-password-2026' })).status, 401);
  assert.equal((await call('/api/auth/login', 'POST', { username: 'cap-owner', password: 'Another-public-fake-password-2026' })).status, 200);
});

test('free Worker refuses changed storage keys, malformed payloads and cross-site writes', async t => {
  const { env, call, setup } = fixture(t); const cookie = await setup();
  const cross = await call('/api/workspace', 'PUT', { workspace: sample(), expectedRevision: 0 }, cookie, { Origin: 'https://attacker.example' });
  assert.equal(cross.status, 403);
  assert.equal((await call('/api/chat', 'POST', { messages: [{ role: 'system', content: 'bad' }] }, cookie)).status, 400);
  assert.equal((await call('/api/workspace', 'PUT', { workspace: {}, expectedRevision: 0 }, cookie)).status, 400);
  env.CAP_DATA_KEY = 'Another-fake-key-that-must-never-decrypt-existing-data';
  assert.equal((await call('/api/workspace', 'GET', undefined, cookie)).status, 503);
  assert.equal((await call('/api/auth/session')).status, 503);
});

test('free Worker only calls the free model, preserves opt-in context and has no paid fallback', async t => {
  const { env, call, setup, calls } = fixture(t); const cookie = await setup();
  const input = { messages: [{ role: 'user', content: 'Aide-moi à faire mon budget.' }], context: { monthlyIncome: 2000, monthlyExpenses: 1200 } };
  const answer = await call('/api/chat', 'POST', input, cookie);
  assert.equal(answer.status, 200); assert.equal((await answer.json()).provider, 'Cloudflare Workers AI');
  assert.equal(calls[0][0], FREE_MODEL); assert.equal(calls[0][1].max_tokens, 768);
  assert.equal(calls[0][1].stream, false); assert.match(calls[0][1].messages[0].content, /2000/);
  env.AI.run = async () => { throw new Error('quota unavailable'); };
  const failed = await call('/api/chat', 'POST', input, cookie);
  assert.equal(failed.status, 503); assert.equal((await failed.json()).code, 'FREE_AI_UNAVAILABLE');
  assert.equal(calls.length, 1);
});

test('free Worker reserves the daily allowance before generation and stops without upgrading', async t => {
  const { call, setup, calls } = fixture(t); const cookie = await setup();
  let now = Date.UTC(2026, 9, 24, 12);
  t.mock.method(Date, 'now', () => now);
  for (let i = 0; i < DAILY_CHAT_LIMIT; i++) {
    now += 61000;
    const result = await call('/api/chat', 'POST', { messages: [{ role: 'user', content: 'Un petit objectif ?' }] }, cookie);
    assert.equal(result.status, 200);
  }
  now += 61000;
  const exceeded = await call('/api/chat', 'POST', { messages: [{ role: 'user', content: 'Encore ?' }] }, cookie);
  assert.equal(exceeded.status, 429); assert.ok(Number(exceeded.headers.get('retry-after')) > 0);
  assert.equal(calls.length, DAILY_CHAT_LIMIT);
});
