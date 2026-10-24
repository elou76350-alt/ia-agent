import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/protected.spec.ts',
  timeout: 40000,
  expect: { timeout: 8000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3002',
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
    timezoneId: 'Asia/Dubai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' },
  },
  webServer: {
    command: 'node tests/protected-server.mjs',
    url: 'http://127.0.0.1:3002/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: { NODE_ENV: 'test', AGENT_API_KEY: '', APP_ORIGIN: 'http://127.0.0.1:3002' },
  },
});
