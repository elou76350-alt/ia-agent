import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'cap_session';
const MAX_WORKSPACE_BYTES = 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest();
const validString = (value, max = 2000) => typeof value === 'string' && value.length <= max;
const validId = value => validString(value, 128) && value.length > 0;
const validMoney = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const validDate = value => validString(value, 80) && Number.isFinite(Date.parse(value));

/** Only the public, versioned workspace schema can be persisted, never credentials. */
export function validateWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.isDemo !== 'boolean') return false;
  const { data, messages, habitDate } = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(habitDate) || !validDate(habitDate)) return false;
  if (!data || typeof data !== 'object' || !data.profile || !data.finance) return false;
  if (!validString(data.profile.firstName, 80) || !validString(data.profile.profession, 120) || !validString(data.profile.country, 80)) return false;
  if (!validMoney(data.finance.monthlyIncome) || !validMoney(data.finance.savings)) return false;
  if (!Array.isArray(data.finance.expenses) || data.finance.expenses.length > 1000 || !data.finance.expenses.every(e => e && validId(e.id) && validString(e.label, 80) && validMoney(e.amount) && ['Essentiel', 'Loisir', 'Projet'].includes(e.category))) return false;
  if (!Array.isArray(data.goals) || data.goals.length > 1000 || !data.goals.every(g => g && validId(g.id) && validString(g.title, 200) && ['Finances', 'Carrière', 'Bien-être', 'Personnel'].includes(g.category) && typeof g.done === 'boolean')) return false;
  if (!Array.isArray(data.habits) || data.habits.length > 100 || !data.habits.every(h => h && validId(h.id) && validString(h.label, 200) && typeof h.done === 'boolean')) return false;
  if (!Array.isArray(data.checkins) || data.checkins.length > 2000 || !data.checkins.every(c => c && validId(c.id) && validDate(c.date) && Number.isInteger(c.mood) && c.mood >= 1 && c.mood <= 5 && validString(c.note, 2000))) return false;
  if (!Array.isArray(messages) || messages.length > 60 || !messages.every(m => m && validId(m.id) && ['user', 'assistant'].includes(m.role) && validString(m.content, m.role === 'user' ? 4000 : 12000) && (m.mode === undefined || ['discovery', 'connected'].includes(m.mode)))) return false;
  try { return Buffer.byteLength(JSON.stringify(value)) <= MAX_WORKSPACE_BYTES; } catch { return false; }
}

function canonicalWorkspace(value) {
  const { data } = value;
  return {
    version: 1,
    isDemo: value.isDemo,
    habitDate: value.habitDate,
    data: {
      profile: { firstName: data.profile.firstName, profession: data.profile.profession, country: data.profile.country },
      finance: { monthlyIncome: data.finance.monthlyIncome, savings: data.finance.savings, expenses: data.finance.expenses.map(({ id, label, amount, category }) => ({ id, label, amount, category })) },
      goals: data.goals.map(({ id, title, category, done }) => ({ id, title, category, done })),
      habits: data.habits.map(({ id, label, done }) => ({ id, label, done })),
      checkins: data.checkins.map(({ id, date, mood, note }) => ({ id, date, mood, note })),
    },
    messages: value.messages.map(({ id, role, content, mode }) => ({ id, role, content, ...(mode ? { mode } : {}) })),
  };
}

function credentials(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const username = typeof body.username === 'string' ? body.username.trim().normalize('NFC') : '';
  if (!/^[\p{L}\p{N}_.@-]{3,80}$/u.test(username) || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) return null;
  return { username, normalized: username.toLocaleLowerCase('fr-FR'), password: body.password };
}

/** Mount router at /api after JSON and same-origin middleware. */
export function createAccountService({
  dataDirectory,
  authEnabled = false,
  setupCode = '',
  secureCookies = false,
  sessionTtlMs = 7 * 24 * 60 * 60 * 1000,
  loginLimit = 10,
  loginWindowMs = 15 * 60 * 1000,
  now = Date.now,
} = {}) {
  if (!dataDirectory) throw new Error('CAP_DATA_DIR is required for persistent accounts.');
  const directory = resolve(dataDirectory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, '.workspace-key');
  const databasePath = join(directory, 'workspace.sqlite3');
  for (const path of [keyPath, databasePath]) {
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('Account storage must use regular private files.');
  }
  if (existsSync(databasePath) && !existsSync(keyPath)) throw new Error('Account storage key is missing. Restore the original key before starting.');
  if (!existsSync(keyPath)) {
    try { writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const encryptionKey = readFileSync(keyPath);
  if (encryptionKey.length !== 32) throw new Error('Account encryption key is invalid.');
  chmodSync(keyPath, 0o600);
  const db = new DatabaseSync(databasePath);
  chmodSync(databasePath, 0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id=1), username TEXT NOT NULL, normalized TEXT NOT NULL, salt BLOB NOT NULL, password_hash BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL DEFAULT 0, encrypted TEXT, updated TEXT NOT NULL);
  `);
  const router = express.Router();
  const failures = new Map();
  const owner = () => db.prepare('SELECT * FROM owner WHERE id=1').get();
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/', maxAge: sessionTtlMs };
  const error = (res, status, message, code, extra = {}) => res.status(status).json({ error: message, code, ...extra });
  const requestToken = req => {
    const match = (req.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
    const token = match?.slice(COOKIE_NAME.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  };
  function currentUser(req) {
    if (!authEnabled) return { id: 1, username: 'Espace local' };
    const token = requestToken(req);
    if (!token) return null;
    const row = db.prepare('SELECT owner.id, owner.username FROM sessions JOIN owner ON owner.id=sessions.owner_id WHERE sessions.token_hash=? AND sessions.expires>?').get(digest(token).toString('hex'), now());
    return row ? { id: row.id, username: row.username } : null;
  }
  function requireAuth(req, res, next) {
    const user = currentUser(req);
    if (!user) return error(res, 401, 'Connectez-vous pour accéder à votre espace.', 'AUTH_REQUIRED');
    req.capUser = user;
    next();
  }
  function rateAllowed(req, res) {
    const timestamp = now();
    for (const [ip, record] of failures) if (timestamp - record.since >= loginWindowMs) failures.delete(ip);
    const record = failures.get(req.ip || 'unknown');
    if (record && record.count >= loginLimit) {
      res.setHeader('Retry-After', String(Math.ceil((loginWindowMs - (timestamp - record.since)) / 1000)));
      error(res, 429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'LOGIN_RATE_LIMITED');
      return false;
    }
    return true;
  }
  function failed(req) {
    const ip = req.ip || 'unknown';
    const record = failures.get(ip) || { since: now(), count: 0 };
    record.count++;
    if (failures.size >= 5000 && !failures.has(ip)) failures.delete(failures.keys().next().value);
    failures.set(ip, record);
  }
  function signIn(res) {
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash,owner_id,expires) VALUES (?,1,?)').run(digest(token).toString('hex'), now() + sessionTtlMs);
    res.cookie(COOKIE_NAME, token, cookieOptions);
  }
  function sessionResult(req) {
    const user = currentUser(req);
    const setupRequired = authEnabled && !owner();
    return { authenticated: Boolean(user), authRequired: authEnabled, setupRequired, setupAvailable: Boolean(setupRequired && setupCode.length >= 16), ...(user ? { user: { username: user.username } } : {}) };
  }
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from('cap-workspace-v1:owner'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
  }
  function decrypt(value) {
    const [version, iv, tag, ciphertext] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid encrypted workspace.');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from('cap-workspace-v1:owner'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    const decoded = JSON.parse(plaintext);
    if (!validateWorkspace(decoded)) throw new Error('Invalid stored workspace.');
    return decoded;
  }

  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/auth/session', (req, res) => res.json(sessionResult(req)));
  router.post('/auth/setup', async (req, res) => {
    if (!authEnabled) return error(res, 409, 'La connexion privée n’est pas activée sur ce serveur.', 'AUTH_DISABLED');
    if (owner()) return error(res, 409, 'Le compte propriétaire existe déjà.', 'OWNER_EXISTS');
    if (setupCode.length < 16) return error(res, 503, 'La création du compte doit être activée par la configuration du serveur.', 'SETUP_UNAVAILABLE');
    if (!rateAllowed(req, res)) return;
    if (typeof req.body?.setupCode !== 'string' || req.body.setupCode.length > 512 || !timingSafeEqual(digest(req.body.setupCode), digest(setupCode))) {
      failed(req); return error(res, 401, 'Code de création invalide.', 'SETUP_CODE_INVALID');
    }
    const input = credentials(req.body);
    if (!input) return error(res, 400, 'Choisissez un identifiant de 3 à 80 caractères et un mot de passe de 12 à 128 caractères.', 'INVALID_CREDENTIALS');
    failed(req); // Reserve before async work so concurrent attempts share the limit.
    const salt = randomBytes(16);
    const passwordHash = await scrypt(input.password, salt, 64);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (owner()) { db.exec('ROLLBACK'); return error(res, 409, 'Le compte propriétaire existe déjà.', 'OWNER_EXISTS'); }
      db.prepare('INSERT INTO owner (id,username,normalized,salt,password_hash) VALUES (1,?,?,?,?)').run(input.username, input.normalized, salt, passwordHash);
      db.exec('COMMIT');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
    signIn(res);
    failures.delete(req.ip || 'unknown');
    res.status(201).json({ authenticated: true, authRequired: true, setupRequired: false, setupAvailable: false, user: { username: input.username } });
  });
  router.post('/auth/login', async (req, res) => {
    if (!authEnabled) return res.json(sessionResult(req));
    if (!rateAllowed(req, res)) return;
    const input = credentials(req.body);
    if (!input) { failed(req); return error(res, 401, 'Identifiant ou mot de passe incorrect.', 'LOGIN_INVALID'); }
    failed(req); // Reserve synchronously before scrypt; success clears the record.
    const account = owner();
    const salt = account ? Buffer.from(account.salt) : Buffer.alloc(16);
    const candidate = await scrypt(input.password, salt, 64);
    const expected = account ? Buffer.from(account.password_hash) : Buffer.alloc(64);
    if (!timingSafeEqual(candidate, expected) || !account || account.normalized !== input.normalized) {
      return error(res, 401, 'Identifiant ou mot de passe incorrect.', 'LOGIN_INVALID');
    }
    // A password may have changed while scrypt was running. Recheck under the
    // same write lock that creates the session, so old credentials cannot race
    // session revocation and create a new authenticated session afterwards.
    db.exec('BEGIN IMMEDIATE');
    try {
      const latest = owner();
      if (!latest || !timingSafeEqual(Buffer.from(latest.password_hash), Buffer.from(account.password_hash))) {
        db.exec('ROLLBACK');
        return error(res, 401, 'Identifiant ou mot de passe incorrect.', 'LOGIN_INVALID');
      }
      signIn(res);
      db.exec('COMMIT');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
    failures.delete(req.ip || 'unknown');
    res.json({ authenticated: true, authRequired: true, setupRequired: false, setupAvailable: false, user: { username: account.username } });
  });
  router.post('/auth/logout', (req, res) => {
    const token = requestToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token).toString('hex'));
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' });
    res.json({ ok: true });
  });
  router.post('/auth/password', requireAuth, async (req, res) => {
    if (!authEnabled) return error(res, 409, 'La connexion privée n’est pas activée sur ce serveur.', 'AUTH_DISABLED');
    if (!rateAllowed(req, res)) return;
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) return error(res, 400, 'Le nouveau mot de passe doit contenir de 12 à 128 caractères.', 'NEW_PASSWORD_INVALID');
    if (typeof currentPassword !== 'string' || currentPassword.length < 12 || currentPassword.length > 128) {
      failed(req); return error(res, 401, 'Le mot de passe actuel est incorrect.', 'PASSWORD_INVALID');
    }
    failed(req);
    const account = owner();
    const candidate = await scrypt(currentPassword, Buffer.from(account.salt), 64);
    if (!timingSafeEqual(candidate, Buffer.from(account.password_hash))) return error(res, 401, 'Le mot de passe actuel est incorrect.', 'PASSWORD_INVALID');
    const salt = randomBytes(16);
    const passwordHash = await scrypt(newPassword, salt, 64);
    db.exec('BEGIN IMMEDIATE');
    try {
      const latest = owner();
      if (!timingSafeEqual(Buffer.from(latest.password_hash), Buffer.from(account.password_hash))) {
        db.exec('ROLLBACK');
        return error(res, 409, 'Le mot de passe a déjà été modifié sur un autre appareil. Reconnectez-vous.', 'PASSWORD_CHANGED');
      }
      db.prepare('UPDATE owner SET salt=?, password_hash=? WHERE id=1').run(salt, passwordHash);
      db.prepare('DELETE FROM sessions').run();
      db.exec('COMMIT');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
    signIn(res);
    failures.delete(req.ip || 'unknown');
    res.json({ ok: true });
  });
  router.get('/workspace', requireAuth, (_req, res) => {
    const row = db.prepare('SELECT revision,encrypted FROM workspace WHERE id=1').get();
    res.json({ workspace: row?.encrypted ? decrypt(row.encrypted) : null, revision: row?.revision || 0 });
  });
  function changeWorkspace(req, res, clear) {
    const expected = req.body?.expectedRevision;
    if (!Number.isSafeInteger(expected) || expected < 0 || (!clear && !validateWorkspace(req.body?.workspace))) return error(res, 400, 'L’espace ou sa version est invalide.', 'INVALID_WORKSPACE');
    const encrypted = clear ? null : encrypt(canonicalWorkspace(req.body.workspace));
    db.exec('BEGIN IMMEDIATE');
    try {
      const revision = db.prepare('SELECT revision FROM workspace WHERE id=1').get()?.revision || 0;
      if (revision !== expected) { db.exec('ROLLBACK'); return error(res, 409, 'Votre espace a changé sur un autre appareil. Rechargez-le avant d’enregistrer.', 'WORKSPACE_CONFLICT', { revision }); }
      const nextRevision = revision + 1;
      const savedAt = new Date(now()).toISOString();
      db.prepare('INSERT INTO workspace (id,revision,encrypted,updated) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,encrypted=excluded.encrypted,updated=excluded.updated').run(nextRevision, encrypted, savedAt);
      db.exec('COMMIT');
      res.json({ revision: nextRevision, savedAt });
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
  }
  router.put('/workspace', requireAuth, (req, res) => changeWorkspace(req, res, false));
  router.delete('/workspace', requireAuth, (req, res) => changeWorkspace(req, res, true));
  return { router, requireAuth, close: () => { db.close(); encryptionKey.fill(0); }, validateWorkspace };
}
