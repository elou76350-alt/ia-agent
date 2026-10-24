import { test, expect, type Page } from '@playwright/test';

const nav = (page: Page, name: string) => page.locator('.sidebar').getByRole('button', { name: name === 'Mon assistant' ? /^Mon assistant(?: IA)?$/ : name, exact: true });

async function openSection(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await nav(page, name).click();
}

async function clearWorkspace(page: Page) {
  await openSection(page, 'Mes préférences');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Effacer mes données locales' }).click();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
}

test.beforeEach(async ({ page, request }) => {
  await expect.poll(async () => (await request.get('/api/health')).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('budget calculates cents correctly, persists and supports deleting an expense', async ({ page }) => {
  await clearWorkspace(page);
  await openSection(page, 'Mes finances');
  await page.getByLabel('Revenus nets mensuels (€)').fill('2500');
  await page.getByLabel('Épargne déjà disponible (€)').fill('1000');
  await page.getByLabel('Nom de la dépense').fill('Formation expérience patient');
  await page.getByLabel('Montant mensuel (€)', { exact: true }).fill('125.50');
  await page.getByRole('combobox', { name: 'Catégorie', exact: true }).selectOption('Projet');
  await page.locator('.wv-expense-form').getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.locator('.wv-stats .wv-stat').nth(1)).toContainText('125,5');
  await expect(page.locator('.wv-stats .wv-stat').nth(2)).toContainText(/2\s?374,5/);
  await page.reload();
  await openSection(page, 'Mes finances');
  await expect(page.getByLabel('Revenus nets mensuels (€)')).toHaveValue('2500');
  await expect(page.getByLabel('Épargne déjà disponible (€)')).toHaveValue('1000');
  await expect(page.getByText('Formation expérience patient', { exact: true })).toBeVisible();
  await expect(page.locator('.wv-stats .wv-stat').nth(2)).toContainText(/2\s?374,5/);
  await page.getByRole('button', { name: 'Supprimer la dépense Formation expérience patient' }).click();
  await expect(page.getByText('Formation expérience patient', { exact: true })).toHaveCount(0);
  await expect(page.locator('.wv-stats .wv-stat').nth(2)).toContainText(/2\s?500/);
});

test('goals can be added, completed, restored and removed', async ({ page }) => {
  await clearWorkspace(page);
  await openSection(page, 'Mes objectifs');
  await page.getByLabel('Une action concrète', { exact: true }).fill('Préparer un exemple de parcours patient');
  await page.getByRole('combobox', { name: 'Domaine', exact: true }).selectOption('Carrière');
  await page.locator('.wv-goal-form').getByRole('button', { name: 'Ajouter', exact: true }).click();
  const goal = page.locator('.wv-goal-row').filter({ hasText: 'Préparer un exemple de parcours patient' });
  await expect(goal).toBeVisible();
  await goal.getByRole('checkbox').check();
  await expect(page.locator('.wv-stat').nth(2)).toContainText('100 %');
  await page.reload();
  await openSection(page, 'Mes objectifs');
  await expect(goal.getByRole('checkbox')).toBeChecked();
  await goal.getByRole('button', { name: /Supprimer l’objectif/ }).click();
  await expect(goal).toHaveCount(0);
  await expect(page.locator('.wv-stat').first()).toContainText('0');
});

test('dashboard uses the newest wellbeing check-in and preserves the journal locally', async ({ page }) => {
  await clearWorkspace(page);
  await openSection(page, 'Mon bien-être');
  await page.getByRole('radio', { name: 'Difficile', exact: true }).check();
  await page.getByLabel(/Ce que .* sur le cœur/).fill('Première note privée de test');
  await page.getByRole('button', { name: 'Enregistrer mon point' }).click();
  await page.getByRole('radio', { name: 'Très bien', exact: true }).check();
  await page.getByLabel(/Ce que .* sur le cœur/).fill('Deuxième note privée de test');
  await page.getByRole('button', { name: 'Enregistrer mon point' }).click();
  await openSection(page, 'Vue d’ensemble');
  await expect(page.locator('.metric-card').filter({ has: page.getByRole('heading', { name: 'Mon bien-être', exact: true }) })).toContainText('Très bien');
  await page.reload();
  await openSection(page, 'Mon bien-être');
  await expect(page.locator('.wv-journal-item').first()).toContainText('Deuxième note privée de test');
  await expect(page.locator('.wv-journal-item').nth(1)).toContainText('Première note privée de test');
});

test('discovery conversation responds and shares budget/profile only after explicit opt-in', async ({ page }) => {
  const sentBodies: Array<Record<string, any>> = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/chat')) sentBodies.push(req.postDataJSON()); });
  await openSection(page, 'Mon assistant');
  await page.getByLabel('Votre message', { exact: true }).fill('Comment mieux organiser mon budget ?');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText(/revenus nets mensuels/);
  expect(sentBodies).toHaveLength(1);
  expect(sentBodies[0]).not.toHaveProperty('profile');
  expect(sentBodies[0]).not.toHaveProperty('context');
  await page.getByRole('checkbox', { name: /Inclure mon profil/ }).check();
  await page.getByLabel('Votre message', { exact: true }).fill('Quel est le solde de mon budget ?');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText(/solde disponible.*1\s?235/);
  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[1].profile.profession).toBe('Patient Experience Specialist');
  expect(sentBodies[1].context.monthlyIncome).toBe(2800);
  expect(sentBodies[1].context.monthlyExpenses).toBe(1565);
  expect(sentBodies[1]).not.toHaveProperty('checkins');
  expect(JSON.stringify(sentBodies[1])).not.toContain('journal');
  await expect(page.locator('.status-pill')).toContainText('Mode découverte');
});

test('a failed chat request keeps the message editable and does not invent a reply', async ({ page }) => {
  await page.route('**/api/chat', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Fournisseur temporairement indisponible.', code: 'PROVIDER_ERROR' }) }));
  await openSection(page, 'Mon assistant');
  const text = 'Je veux préparer ma candidature en expérience patient.';
  await page.getByLabel('Votre message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.getByRole('alert')).toContainText('Fournisseur temporairement indisponible.');
  await expect(page.getByLabel('Votre message', { exact: true })).toHaveValue(text);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.locator('.message.user')).toHaveCount(0);
});

test('clearing the workspace removes private history and resets finances after reload', async ({ page }) => {
  await openSection(page, 'Mes préférences');
  await page.getByLabel('Votre prénom', { exact: true }).fill('Profil privé');
  await clearWorkspace(page);
  await page.reload();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Profil privé');
  await openSection(page, 'Mes finances');
  await expect(page.getByLabel('Revenus nets mensuels (€)')).toHaveValue('');
  await expect(page.locator('.wv-expense-list .wv-list-row')).toHaveCount(0);
  await openSection(page, 'Mes objectifs');
  await expect(page.locator('.wv-goal-row')).toHaveCount(0);
  await openSection(page, 'Mon assistant');
  await expect(page.locator('.message')).toHaveCount(1);
});

test('patient experience career offers relevant exercises and truthful editable applications', async ({ page }) => {
  await openSection(page, 'Ma carrière');
  await expect(page.getByRole('heading', { name: 'Mon métier : l’expérience patient' })).toBeVisible();
  const linkedIn = page.getByRole('link', { name: /LinkedIn/ });
  await expect(linkedIn).toHaveAttribute('href', /keywords=Patient%20Experience%20Specialist/);
  await page.getByRole('button', { name: 'Créer une trame de message' }).click();
  await expect(page.getByLabel(/message, à personnaliser/)).toHaveValue(/Patient Experience Specialist/);
  await expect(page.getByLabel(/message, à personnaliser/)).toHaveValue(/\[résultat concret/);
  await page.getByRole('button', { name: 'Explorer un cas fictif' }).click();
  await expect(page.getByLabel('Votre message', { exact: true })).toHaveValue(/parcours patient fictif/);
});

test('desktop and mobile navigation work without overflow or browser errors', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.screenshot({ path: '/tmp/cap-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/cap-mobile.png', fullPage: true, animations: 'disabled' });
  for (const section of ['Mes finances', 'Ma carrière', 'Mon bien-être', 'Mes objectifs', 'Mon assistant', 'Mes préférences', 'Vue d’ensemble']) {
    await openSection(page, section);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(widths.content, `${section} must fit a mobile screen`).toBeLessThanOrEqual(widths.viewport);
  }
  await page.getByRole('button', { name: 'À propos de CAP' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
