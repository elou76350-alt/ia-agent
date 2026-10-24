import 'dotenv/config';
import express from 'express';
import { EnvHttpProxyAgent } from 'undici';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createAccountService } from './accounts.mjs';
import {
  buildProviderBody, discoveryReply, extractProviderText, InputError, reasoningForModel, validateChatBody,
} from './coach.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({
  apiKey = process.env.AGENT_API_KEY || '',
  model = process.env.AGENT_MODEL || 'gpt-5.4',
  reasoningEffort = process.env.AGENT_REASONING_EFFORT || 'high',
  fetchImpl = globalThis.fetch,
  timeoutMs = 90000,
  rateLimit = 30,
  rateWindowMs = 60000,
  distDirectory = resolve(projectRoot, 'dist'),
  authEnabled = process.env.CAP_AUTH_ENABLED === '1',
  dataDirectory = process.env.CAP_DATA_DIR || resolve(projectRoot, 'data'),
  setupCode = process.env.CAP_SETUP_CODE || '',
  secureCookies = process.env.NODE_ENV === 'production' || process.env.APP_ORIGIN?.startsWith('https://') || false,
} = {}) {
  if (process.env.NODE_ENV === 'production' && !authEnabled) {
    throw new Error('La production exige CAP_AUTH_ENABLED=1. Configurez un compte privé avant de publier CAP.');
  }
  const app = express();
  const accounts = authEnabled ? createAccountService({ dataDirectory, authEnabled, setupCode, secureCookies }) : null;
  app.locals.closeAccounts = () => accounts?.close();
  const requests = new Map();
  const resolvedReasoningEffort = reasoningForModel(model, reasoningEffort);
  let providerVerified = false;
  const dispatcher = apiKey && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy)
    ? new EnvHttpProxyAgent() : undefined;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    // HTTPS can terminate at a reverse proxy. Compare the actual Host, without
    // trusting client-supplied Forwarded/X-Forwarded-* headers for authorization.
    let sameHost = false;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const requestHost = new URL(`http://${req.get('host')}`).host;
        sameHost = ['http:', 'https:'].includes(originUrl.protocol) &&
          originUrl.host === requestHost && !originUrl.username && !originUrl.password &&
          originUrl.pathname === '/' && !originUrl.search && !originUrl.hash;
      } catch { /* Invalid or opaque origins are rejected below. */ }
    }
    const localDevOrigins = process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
    const configuredOrigin = process.env.APP_ORIGIN;
    const allowedOrigin = origin && configuredOrigin ? origin === configuredOrigin : sameHost;
    if (req.get('sec-fetch-site') === 'cross-site' ||
        (origin && !allowedOrigin && !localDevOrigins.includes(origin))) {
      return res.status(403).json({ error: 'Cette origine ne peut pas envoyer de messages.', code: 'ORIGIN_DENIED' });
    }
    next();
  });
  app.use('/api/workspace', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '128kb' }));
  if (accounts) {
    app.use('/api', accounts.router);
  } else {
    app.get('/api/auth/session', (_req, res) => res.json({ authenticated: true, authRequired: false, setupRequired: false, user: null }));
    app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/status', (_req, res) => res.json({
    mode: apiKey ? 'connected' : 'discovery',
    provider: apiKey ? 'OpenAI' : null,
    model,
    reasoningEffort: resolvedReasoningEffort,
    configured: Boolean(apiKey),
    providerVerified,
  }));

  app.post('/api/chat', (req, res, next) => accounts ? accounts.requireAuth(req, res, next) : next(), async (req, res) => {
    let input;
    try {
      input = validateChatBody(req.body);
    } catch (error) {
      if (error instanceof InputError) {
        return res.status(400).json({ error: error.message, code: 'INVALID_INPUT' });
      }
      return res.status(400).json({ error: 'La demande est invalide.', code: 'INVALID_INPUT' });
    }
    const now = Date.now();
    for (const [key, record] of requests) {
      if (now - record.since >= rateWindowMs) requests.delete(key);
    }
    const key = req.ip || 'unknown';
    const record = requests.get(key) || { since: now, count: 0 };
    record.count += 1;
    requests.set(key, record);
    if (record.count > rateLimit) {
      res.setHeader('Retry-After', String(Math.ceil((rateWindowMs - (now - record.since)) / 1000)));
      return res.status(429).json({ error: 'Trop de messages rapprochés. Réessaie dans une minute.', code: 'RATE_LIMITED' });
    }
    if (!apiKey) return res.json({ message: discoveryReply(input), mode: 'discovery' });
    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildProviderBody(input, model, reasoningEffort)),
        signal: AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (!response.ok) {
        providerVerified = false;
        await response.body?.cancel().catch(() => {});
        const unavailable = response.status === 401 || response.status === 403;
        return res.status(502).json({
          error: unavailable
            ? 'La connexion au fournisseur IA est refusée. Vérifie la configuration côté serveur.'
            : response.status === 429
              ? 'Le fournisseur IA a atteint sa limite de requêtes ou de crédit. Réessaie plus tard.'
              : 'Le fournisseur IA est temporairement indisponible. Réessaie plus tard.',
          code: 'PROVIDER_ERROR',
        });
      }
      const data = await response.json();
      let message = extractProviderText(data);
      if (!message) {
        providerVerified = false;
        return res.status(502).json({ error: "Le fournisseur IA n'a pas renvoyé de texte. Réessaie.", code: 'EMPTY_RESPONSE' });
      }
      if (data.status === 'incomplete') {
        message += '\n\nLa réponse a été interrompue par le fournisseur. Vous pouvez demander de continuer.';
      }
      if (message.length > 12000) {
        message = `${message.slice(0, 11800)}\n\nLa réponse a été abrégée pour sa longueur. Vous pouvez demander de continuer.`;
      }
      providerVerified = true;
      return res.json({ message, mode: 'connected' });
    } catch (error) {
      providerVerified = false;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return res.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? 'La réponse IA a pris trop de temps. Réessaie dans un moment.'
          : 'Impossible de joindre le fournisseur IA. Vérifie la connexion et réessaie.',
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
      });
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route introuvable.', code: 'NOT_FOUND' }));

  if (existsSync(distDirectory)) {
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
      res.sendFile(resolve(distDirectory, 'sw.js'));
    });
    app.use(express.static(distDirectory, { index: false }));
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(distDirectory, 'index.html'));
    });
  }
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Le message est trop volumineux.', code: 'BODY_TOO_LARGE' });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'Le contenu JSON est invalide.', code: 'INVALID_JSON' });
    }
    return res.status(500).json({ error: 'Une erreur serveur est survenue.', code: 'SERVER_ERROR' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  const server = app.listen(port, host, (error) => {
    if (error) {
      console.error(`Cap : démarrage impossible (${error.code || 'SERVER_START_FAILED'}).`);
      process.exitCode = 1;
      return;
    }
    console.log(`Cap : serveur prêt sur ${host}:${port} (${process.env.AGENT_API_KEY ? 'connexion IA configurée' : 'mode découverte'}).`);
  });
  const shutdown = () => server.close(() => { app.locals.closeAccounts(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
