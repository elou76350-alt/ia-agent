import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/index.mjs';

// These credentials configure an ephemeral test instance, never a user account.
const dataDirectory = await mkdtemp(join(tmpdir(), 'cap-protected-e2e-'));
const app = createApp({
  authEnabled: true,
  dataDirectory,
  setupCode: 'cap-e2e-setup-code-not-secret',
  secureCookies: false,
  apiKey: '',
  distDirectory: resolve('dist'),
});
const server = app.listen(3002, '127.0.0.1', () => console.log('CAP protected test server ready.'));
let stopping = false;
async function cleanup() {
  app.locals.closeAccounts();
  await rm(dataDirectory, { recursive: true, force: true });
}
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => { void cleanup().then(() => process.exit(0), () => process.exit(1)); });
}
server.on('error', () => { void cleanup().then(() => process.exit(1), () => process.exit(1)); });
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
