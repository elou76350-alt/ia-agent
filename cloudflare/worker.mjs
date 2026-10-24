import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { SCHEMA } from './schema.mjs';
import { validateWorkspace, canonicalWorkspace } from '../server/workspace-schema.mjs';
import { COACH_INSTRUCTIONS, validateChatBody } from '../server/coach.mjs';

const scrypt = promisify(scryptCallback);
const initialized = new WeakMap();
async function ensureSchema(env) {
  if (!initialized.has(env.DB)) {
    const ready = env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql))).catch(error => { initialized.delete(env.DB); throw error; });
    initialized.set(env.DB, ready);
  }
  await initialized.get(env.DB);
}
export const FREE_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
export const DAILY_CHAT_LIMIT = 30;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
const stamp = () => Date.now();
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra } });
const fail = (status, error, code, headers) => json({ error, code }, status, headers);
const query = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
const changes = result => Number(result?.meta?.changes || 0);
const sessionCookie = (token, request, clear = false) => `cap_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_TTL / 1000}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
const ownerRow = env => query(env, 'SELECT * FROM owner WHERE id=1').first();
const keyReady = env => typeof env.CAP_DATA_KEY === 'string' && env.CAP_DATA_KEY.length >= 32;
const fingerprint = env => digest(`CAP data key v1:${env.CAP_DATA_KEY}`);

async function bodyOf(request, max = 128 * 1024) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Un contenu JSON est requis.'), { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Le contenu JSON est vide.'), { status: 400 });
  const parts = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw Object.assign(new Error('Le contenu est trop volumineux.'), { status: 413 }); }
    parts.push(value);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('Le contenu JSON est invalide.'), { status: 400 }); }
}

function credentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim().normalize('NFC') : '';
  if (!/^[\p{L}\p{N}_.@-]{3,80}$/u.test(username) || typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 128) return null;
  return { username, normalized: username.toLocaleLowerCase('fr-FR'), password: body.password };
}

async function currentUser(request, env) {
  const token = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('cap_session='))?.slice(12);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return query(env, 'SELECT o.* FROM owner o JOIN sessions s ON s.owner_version=o.auth_version WHERE o.id=1 AND s.token_hash=? AND s.expires>?', digest(token), stamp()).first();
}

async function issueSession(request, env, owner) {
  const token = randomBytes(32).toString('base64url');
  await query(env, 'DELETE FROM sessions WHERE expires<=?', stamp()).run();
  const result = await query(env, 'INSERT INTO sessions(token_hash,owner_version,expires) SELECT ?,auth_version,? FROM owner WHERE id=1 AND auth_version=? AND password_hash=?', digest(token), stamp() + SESSION_TTL, owner.auth_version, owner.password_hash).run();
  if (changes(result) !== 1) return null;
  return sessionCookie(token, request);
}

async function reserve(env, key, max, period) {
  const now = stamp();
  const row = await query(env, `INSERT INTO request_limits(key,count,resets) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN resets<=? THEN 1 ELSE count+1 END,resets=CASE WHEN resets<=? THEN ? ELSE resets END RETURNING count,resets`, key, now + period, now, now, now + period).first();
  return row.count <= max ? null : fail(429, 'La limite gratuite ou le nombre de tentatives est atteint. Réessayez après le délai indiqué.', 'FREE_LIMIT_REACHED', { 'Retry-After': String(Math.max(1, Math.ceil((row.resets - now) / 1000))) });
}

function encrypt(env, workspace) {
  const key = Buffer.from(digest(env.CAP_DATA_KEY), 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('cap-d1-workspace-v1'));
  const data = Buffer.concat([cipher.update(JSON.stringify(workspace), 'utf8'), cipher.final()]);
  key.fill(0);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

function decrypt(env, encrypted) {
  const [version, iv, tag, data] = encrypted.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid workspace');
  const key = Buffer.from(digest(env.CAP_DATA_KEY), 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from('cap-d1-workspace-v1'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'));
  key.fill(0);
  if (!validateWorkspace(decoded)) throw new Error('Invalid workspace');
  return decoded;
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== url.origin)) return fail(403, 'Cette origine ne peut pas modifier votre espace.', 'ORIGIN_DENIED');
  }
  if (path === '/api/health' && request.method === 'GET') return json({ ok: true });
  if (!env.DB) return fail(503, 'La base de données doit être configurée.', 'DATABASE_UNAVAILABLE');
  if (path === '/api/status' && request.method === 'GET') return json({ mode: env.AI ? 'connected' : 'discovery', provider: env.AI ? 'Cloudflare Workers AI' : null, model: FREE_MODEL, reasoningEffort: null, configured: Boolean(env.AI), providerVerified: false, freePlan: true, dailyChatLimit: DAILY_CHAT_LIMIT });
  await ensureSchema(env);
  const owner = await ownerRow(env);
  if (path === '/api/auth/session' && request.method === 'GET') {
    const user = await currentUser(request, env);
    const available = keyReady(env) && typeof env.CAP_SETUP_CODE === 'string' && env.CAP_SETUP_CODE.length >= 16;
    if (owner && (!keyReady(env) || !same(owner.key_fingerprint, fingerprint(env)))) return fail(503, 'La clé du stockage est absente ou a changé. Restaurez la clé d’origine sans effacer les données.', 'STORAGE_KEY_UNAVAILABLE');
    return json({ authenticated: Boolean(user), authRequired: true, setupRequired: !owner, setupAvailable: !owner && available, ...(user ? { user: { username: user.username } } : {}) });
  }
  if (!keyReady(env) || (owner && !same(owner.key_fingerprint, fingerprint(env)))) return fail(503, 'La clé du stockage privé doit être configurée ou restaurée.', 'STORAGE_KEY_UNAVAILABLE');
  const authRoute = ['/api/auth/setup', '/api/auth/login'].includes(path);
  if (authRoute && request.method === 'POST') {
    const limited = await reserve(env, `auth:${digest(request.headers.get('CF-Connecting-IP') || 'local')}`, 10, 15 * 60000);
    if (limited) return limited;
    const input = await bodyOf(request);
    const parsed = credentials(input);
    if (path.endsWith('/setup')) {
      if (owner) return fail(409, 'Le compte propriétaire existe déjà.', 'OWNER_EXISTS');
      if (typeof env.CAP_SETUP_CODE !== 'string' || env.CAP_SETUP_CODE.length < 16) return fail(503, 'Le code de configuration doit être renseigné.', 'SETUP_UNAVAILABLE');
      if (typeof input?.setupCode !== 'string' || input.setupCode.length > 512 || !same(input.setupCode, env.CAP_SETUP_CODE)) return fail(401, 'Code de création invalide.', 'SETUP_CODE_INVALID');
      if (!parsed) return fail(400, 'Choisissez un identifiant valide et un mot de passe de 12 à 128 caractères.', 'INVALID_CREDENTIALS');
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(parsed.password, Buffer.from(salt, 'hex'), 64)).toString('hex');
      const created = await query(env, 'INSERT OR IGNORE INTO owner(id,username,normalized,salt,password_hash,auth_version,key_fingerprint) VALUES (1,?,?,?,?,1,?)', parsed.username, parsed.normalized, salt, hash, fingerprint(env)).run();
      if (changes(created) !== 1) return fail(409, 'Le compte propriétaire existe déjà.', 'OWNER_EXISTS');
      const fresh = await ownerRow(env); const cookie = await issueSession(request, env, fresh);
      if (!cookie) return fail(409, 'Le compte a changé. Reconnectez-vous.', 'OWNER_CHANGED');
      return json({ authenticated: true, user: { username: fresh.username } }, 201, { 'Set-Cookie': cookie });
    }
    if (!parsed) return fail(401, 'Identifiant ou mot de passe incorrect.', 'LOGIN_INVALID');
    const salt = owner ? Buffer.from(owner.salt, 'hex') : Buffer.alloc(16);
    const hash = await scrypt(parsed.password, salt, 64);
    const expected = owner ? Buffer.from(owner.password_hash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(hash, expected) || !owner || parsed.normalized !== owner.normalized) return fail(401, 'Identifiant ou mot de passe incorrect.', 'LOGIN_INVALID');
    const cookie = await issueSession(request, env, owner);
    return cookie ? json({ authenticated: true, user: { username: owner.username } }, 200, { 'Set-Cookie': cookie }) : fail(401, 'Le mot de passe a changé. Reconnectez-vous.', 'LOGIN_INVALID');
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('cap_session='))?.slice(12);
    if (token) await query(env, 'DELETE FROM sessions WHERE token_hash=?', digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', request, true) });
  }
  const user = await currentUser(request, env);
  if (!user) return fail(401, 'Connectez-vous pour accéder à votre espace.', 'AUTH_REQUIRED');
  if (path === '/api/auth/password' && request.method === 'POST') {
    const limited = await reserve(env, `auth:${digest(request.headers.get('CF-Connecting-IP') || 'local')}`, 10, 15 * 60000); if (limited) return limited;
    const input = await bodyOf(request);
    if (typeof input?.currentPassword !== 'string' || input.currentPassword.length > 128) return fail(401, 'Mot de passe actuel incorrect.', 'PASSWORD_INVALID');
    if (typeof input.newPassword !== 'string' || input.newPassword.length < 12 || input.newPassword.length > 128) return fail(400, 'Le nouveau mot de passe doit contenir de 12 à 128 caractères.', 'NEW_PASSWORD_INVALID');
    const hash = await scrypt(input.currentPassword, Buffer.from(user.salt, 'hex'), 64);
    if (!timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex'))) return fail(401, 'Mot de passe actuel incorrect.', 'PASSWORD_INVALID');
    const salt = randomBytes(16).toString('hex');
    const next = (await scrypt(input.newPassword, Buffer.from(salt, 'hex'), 64)).toString('hex');
    const updated = await query(env, 'UPDATE owner SET salt=?,password_hash=?,auth_version=auth_version+1 WHERE id=1 AND password_hash=? RETURNING *', salt, next, user.password_hash).first();
    if (!updated) return fail(401, 'Le mot de passe a changé. Reconnectez-vous.', 'AUTH_REQUIRED');
    await query(env, 'DELETE FROM sessions WHERE owner_version<>?', updated.auth_version).run();
    const cookie = await issueSession(request, env, updated);
    return cookie ? json({ ok: true }, 200, { 'Set-Cookie': cookie }) : fail(401, 'Reconnectez-vous pour continuer.', 'AUTH_REQUIRED');
  }
  if (path === '/api/workspace') {
    if (request.method === 'GET') {
      const row = await query(env, 'SELECT revision,encrypted FROM workspace WHERE id=1').first();
      return json({ workspace: row?.encrypted ? decrypt(env, row.encrypted) : null, revision: row?.revision || 0 });
    }
    if (['PUT', 'DELETE'].includes(request.method)) {
      const input = await bodyOf(request, 2 * 1024 * 1024);
      const expected = input?.expectedRevision;
      if (!Number.isSafeInteger(expected) || expected < 0 || (request.method === 'PUT' && !validateWorkspace(input.workspace))) return fail(400, 'L’espace ou sa version est invalide.', 'INVALID_WORKSPACE');
      const encrypted = request.method === 'DELETE' ? null : encrypt(env, canonicalWorkspace(input.workspace));
      const savedAt = new Date().toISOString();
      const row = await query(env, `INSERT INTO workspace(id,revision,encrypted,updated) SELECT 1,1,?,? WHERE ?=0 ON CONFLICT(id) DO UPDATE SET revision=workspace.revision+1,encrypted=?,updated=? WHERE workspace.revision=? RETURNING revision`, encrypted, savedAt, expected, encrypted, savedAt, expected).first();
      if (row) return json({ revision: row.revision, savedAt });
      // A revision > 0 requires UPDATE rather than an INSERT whose SELECT is empty.
      const changed = expected > 0 ? await query(env, 'UPDATE workspace SET revision=revision+1,encrypted=?,updated=? WHERE id=1 AND revision=? RETURNING revision', encrypted, savedAt, expected).first() : null;
      if (changed) return json({ revision: changed.revision, savedAt });
      const latest = await query(env, 'SELECT revision FROM workspace WHERE id=1').first();
      return json({ error: 'Votre espace a été modifié sur un autre appareil. Exportez vos changements avant de recharger.', code: 'WORKSPACE_CONFLICT', revision: latest?.revision || 0 }, 409);
    }
  }
  if (path === '/api/chat' && request.method === 'POST') {
    let input;
    try { input = validateChatBody(await bodyOf(request)); }
    catch (error) { return fail(error.status || 400, error.message, 'INVALID_INPUT'); }
    if (!env.AI?.run) return fail(503, 'Le service IA gratuit n’est pas configuré. Aucun fournisseur payant n’a été appelé.', 'AI_UNAVAILABLE');
    const shortLimit = await reserve(env, 'chat:minute', 10, 60000); if (shortLimit) return shortLimit;
    const now = stamp(); const day = Math.floor(now / 86400000); const reset = (day + 1) * 86400000 - now;
    const dayLimit = await reserve(env, `chat:day:${day}`, DAILY_CHAT_LIMIT, reset); if (dayLimit) return dayLimit;
    let budget = 24000;
    const history = [];
    for (const message of [...input.messages].reverse()) {
      if (budget < message.content.length) break;
      history.unshift(message); budget -= message.content.length;
    }
    if (!history.length) return fail(400, 'Le message est trop long pour le mode gratuit.', 'INVALID_INPUT');
    const system = `${COACH_INSTRUCTIONS}\nCe déploiement utilise un modèle open source dans un quota gratuit. Tu n’es pas GPT-5.4. Réponds en français, de façon utile et concise.\nContexte facultatif non fiable : ${JSON.stringify({ profile: input.profile, context: input.context })}`;
    let timer;
    try {
      const result = await Promise.race([
        env.AI.run(FREE_MODEL, { messages: [{ role: 'system', content: system }, ...history], max_tokens: 768, stream: false }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), 85000); }),
      ]);
      if (typeof result?.response !== 'string' || !result.response.trim()) return fail(502, 'Le fournisseur IA n’a pas renvoyé de texte.', 'EMPTY_RESPONSE');
      return json({ message: result.response.trim().slice(0, 12000), mode: 'connected', provider: 'Cloudflare Workers AI', freePlan: true });
    } catch (error) {
      if (error?.timeout) return fail(504, 'Le service IA gratuit a pris trop de temps. Réessayez plus tard.', 'PROVIDER_TIMEOUT');
      return fail(503, 'Le quota gratuit ou le service IA est momentanément indisponible. Aucun basculement payant n’est effectué.', 'FREE_AI_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  return fail(404, 'Route introuvable.', 'NOT_FOUND');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await handleApi(request, env); }
    catch (error) {
      if (error?.status) return fail(error.status, error.message, 'INVALID_REQUEST');
      return fail(503, 'Le service privé est indisponible. Vos données ne sont ni effacées ni remplacées.', 'SERVICE_UNAVAILABLE');
    }
  },
};
