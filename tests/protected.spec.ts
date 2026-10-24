import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

// Public fake credentials for a fresh, temporary test database only.
const username = 'cap-owner';
const password = 'Only-a-fake-test-password-2026';
const changedPassword = 'Another-fake-test-password-2026';
const setupCode = 'cap-e2e-setup-code-not-secret';

async function openSection(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
}

async function login(page: Page, currentPassword = password) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Content de vous retrouver.' })).toBeVisible();
  await page.getByLabel('Identifiant', { exact: true }).fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(currentPassword);
  await page.getByRole('button', { name: 'Entrer dans mon espace' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sync-banner')).toContainText('sauvegardé sur le serveur');
}

async function remoteWorkspace(page: Page) {
  const response = await page.request.get('/api/workspace');
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('private account and server synchronization', () => {
  test.describe.configure({ mode: 'serial' });
  // The ordinary localhost suite can discover this file without starting an
  // authenticated server. Run this group with playwright.protected.config.ts.
  test.skip(({ baseURL }) => baseURL !== 'http://127.0.0.1:3002', 'Requires the isolated protected-server configuration.');

  test('initial setup protects the dashboard and creates the owner through the real form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Créons votre espace privé.' })).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Votre vie, en un regard' })).toHaveCount(0);
    await page.getByLabel('Identifiant', { exact: true }).fill(username);
    await page.getByLabel('Mot de passe', { exact: true }).fill(password);
    await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(`${password}-different`);
    await page.getByLabel('Code de configuration privé', { exact: true }).fill(setupCode);
    await page.getByRole('button', { name: 'Créer mon compte privé' }).click();
    await expect(page.getByRole('alert')).toContainText('ne correspondent pas');
    await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Créer mon compte privé' }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.demo-banner')).toHaveCount(0);
    const session = await (await page.request.get('/api/auth/session')).json();
    expect(session.authenticated).toBe(true);
    expect(session.user.username).toBe(username);
    const cookie = (await page.context().cookies()).find(item => item.name.startsWith('cap_'));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    const secondSetup = await page.request.post('/api/auth/setup', { data: { username: 'second-owner', password, setupCode } });
    expect(secondSetup.status()).toBe(409);
  });

  test('unauthenticated clients cannot read or replace the workspace or use chat', async ({ request }) => {
    const session = await (await request.get('/api/auth/session')).json();
    expect(session.authenticated).toBe(false);
    expect(session.authRequired).toBe(true);
    expect(session).not.toHaveProperty('user');
    expect((await request.get('/api/workspace')).status()).toBe(401);
    expect((await request.put('/api/workspace', { data: { expectedRevision: 0, workspace: {} } })).status()).toBe(401);
    expect((await request.post('/api/chat', { data: { messages: [{ role: 'user', content: 'Quel est mon budget ?' }] } })).status()).toBe(401);
  });

  test('profile, budget and goals persist on the server and load in a second clean browser', async ({ page, browser }) => {
    await page.goto('/');
    await page.getByLabel('Identifiant', { exact: true }).fill(username);
    await page.getByLabel('Mot de passe', { exact: true }).fill('Wrong-fake-password-2026');
    await page.getByRole('button', { name: 'Entrer dans mon espace' }).click();
    await expect(page.getByRole('alert')).toContainText('incorrect');
    await page.getByLabel('Mot de passe', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrer dans mon espace' }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
    await openSection(page, 'Mes préférences');
    await page.getByLabel('Votre prénom', { exact: true }).fill('Camille serveur');
    await openSection(page, 'Mes finances');
    await page.getByLabel('Revenus nets mensuels (€)').fill('3000');
    await page.getByLabel('Nom de la dépense').fill('Formation expérience patient');
    await page.getByLabel('Montant mensuel (€)', { exact: true }).fill('129.90');
    await page.locator('.wv-expense-form').getByRole('button', { name: 'Ajouter', exact: true }).click();
    await openSection(page, 'Mes objectifs');
    await page.getByLabel('Une action concrète', { exact: true }).fill('Préparer mon entretien expérience patient');
    await page.locator('.wv-goal-form').getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.locator('.sync-banner')).toContainText('sauvegardé sur le serveur');
    const saved = await remoteWorkspace(page);
    expect(saved.workspace.data.profile.firstName).toBe('Camille serveur');
    expect(saved.workspace.data.finance.expenses).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Formation expérience patient', amount: 129.9 })]));
    expect(saved.workspace.data.goals).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Préparer mon entretien expérience patient' })]));
    const another = await browser.newContext({ baseURL: 'http://127.0.0.1:3002' });
    try {
      const poisonedLocal = structuredClone(saved.workspace);
      poisonedLocal.data.profile.firstName = 'LOCAL-NE-DOIT-PAS-ETRE-IMPORTE';
      await another.addInitScript(value => localStorage.setItem('cap.workspace.v1', JSON.stringify(value)), poisonedLocal);
      const secondPage = await another.newPage();
      await login(secondPage);
      await expect(secondPage.getByRole('heading', { level: 1 })).toContainText('Camille serveur');
      await expect(secondPage.getByRole('heading', { level: 1 })).not.toContainText('LOCAL-NE-DOIT-PAS-ETRE-IMPORTE');
      await openSection(secondPage, 'Mes finances');
      await expect(secondPage.getByLabel('Revenus nets mensuels (€)')).toHaveValue('3000');
      await expect(secondPage.getByText('Formation expérience patient', { exact: true })).toBeVisible();
      await openSection(secondPage, 'Mes objectifs');
      await expect(secondPage.getByText('Préparer mon entretien expérience patient', { exact: true })).toBeVisible();
      expect((await remoteWorkspace(secondPage)).workspace.data.profile.firstName).toBe('Camille serveur');
    } finally { await another.close(); }
  });

  test('logout flushes an edit before the automatic-save debounce expires', async ({ page }) => {
    await login(page);
    await openSection(page, 'Mes préférences');
    await page.getByLabel('Votre prénom', { exact: true }).fill('Sauvegardé avant déconnexion');
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Content de vous retrouver.' })).toBeVisible();
    expect((await page.request.get('/api/workspace')).status()).toBe(401);
    await login(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sauvegardé avant déconnexion');
    expect((await remoteWorkspace(page)).workspace.data.profile.firstName).toBe('Sauvegardé avant déconnexion');
  });

  test('two devices detect a save conflict, preserve the server copy and allow export and reload', async ({ page, browser }) => {
    await login(page);
    const another = await browser.newContext({ baseURL: 'http://127.0.0.1:3002' });
    try {
      const secondPage = await another.newPage();
      await login(secondPage);
      await openSection(page, 'Mes préférences');
      await openSection(secondPage, 'Mes préférences');
      await page.getByLabel('Votre prénom', { exact: true }).fill('Version appareil A');
      await expect(page.locator('.sync-banner')).toContainText('sauvegardé sur le serveur');
      await secondPage.getByLabel('Votre prénom', { exact: true }).fill('Version appareil B non sauvegardée');
      await expect(secondPage.locator('.sync-banner')).toContainText('modifié sur un autre appareil');
      expect((await remoteWorkspace(page)).workspace.data.profile.firstName).toBe('Version appareil A');
      const downloadEvent = secondPage.waitForEvent('download');
      await secondPage.locator('.sync-banner').getByRole('button', { name: 'Exporter', exact: true }).click();
      const download = await downloadEvent;
      const exportedPath = await download.path();
      expect(exportedPath).not.toBeNull();
      const exported = JSON.parse(await readFile(exportedPath!, 'utf8'));
      expect(exported.data.profile.firstName).toBe('Version appareil B non sauvegardée');
      expect(JSON.stringify(exported)).not.toContain(password);
      secondPage.once('dialog', dialog => dialog.accept());
      await secondPage.locator('.sync-banner').getByRole('button', { name: 'Recharger', exact: true }).click();
      await expect(secondPage.locator('.sync-banner')).toContainText('sauvegardé sur le serveur');
      await openSection(secondPage, 'Mes préférences');
      await expect(secondPage.getByLabel('Votre prénom', { exact: true })).toHaveValue('Version appareil A');
      expect((await remoteWorkspace(secondPage)).workspace.data.profile.firstName).toBe('Version appareil A');
    } finally { await another.close(); }
  });

  test('an iPhone-sized protected session offers Safari installation instructions without overflow', async ({ browser }) => {
    const mobile = await browser.newContext({
      baseURL: 'http://127.0.0.1:3002', viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Asia/Dubai',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      serviceWorkers: 'block',
    });
    try {
      const page = await mobile.newPage();
      await login(page);
      await openSection(page, 'Mes préférences');
      await expect(page.getByRole('heading', { name: 'CAP, sur votre téléphone' })).toBeVisible();
      await expect(page.getByText('Dans Safari, ouvrez le menu Partager.')).toBeVisible();
      await expect(page.getByText('Choisissez « Sur l’écran d’accueil », puis « Ajouter ».')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: '/tmp/cap-protected-mobile.png', fullPage: true, animations: 'disabled' });
    } finally { await mobile.close(); }
  });

  test('changing the password rejects the old password and revokes the other sessions', async ({ page, browser }) => {
    await login(page);
    const otherSession = await browser.newContext({ baseURL: 'http://127.0.0.1:3002' });
    try {
      const otherLogin = await otherSession.request.post('/api/auth/login', { data: { username, password } });
      expect(otherLogin.status()).toBe(200);
      await openSection(page, 'Mes préférences');
      await page.getByLabel('Mot de passe actuel', { exact: true }).fill('Wrong-current-fake-password-2026');
      await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(changedPassword);
      await page.getByLabel('Confirmer le nouveau mot de passe', { exact: true }).fill(changedPassword);
      await page.locator('.password-settings').getByRole('button', { name: /Modifier|Changer|Enregistrer/ }).click();
      await expect(page.locator('.password-settings').getByRole('alert')).toContainText('incorrect');
      await page.getByLabel('Mot de passe actuel', { exact: true }).fill(password);
      await page.locator('.password-settings').getByRole('button', { name: /Modifier|Changer|Enregistrer/ }).click();
      await expect(page.locator('.password-settings').getByRole('status')).toContainText('Mot de passe modifié');
      expect((await otherSession.request.get('/api/workspace')).status()).toBe(401);
      expect((await page.request.get('/api/workspace')).status()).toBe(200);
      await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Content de vous retrouver.' })).toBeVisible();
      await page.getByLabel('Identifiant', { exact: true }).fill(username);
      await page.getByLabel('Mot de passe', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Entrer dans mon espace' }).click();
      await expect(page.getByRole('alert')).toContainText('incorrect');
      await page.getByLabel('Mot de passe', { exact: true }).fill(changedPassword);
      await page.getByRole('button', { name: 'Entrer dans mon espace' }).click();
      await expect(page.locator('.sidebar')).toBeVisible();
    } finally { await otherSession.close(); }
  });
});
