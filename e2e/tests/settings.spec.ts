import { expect, test } from '../fixtures.js';

/**
 * These specs deliberately navigate without the ?lang pin the other suites use: the whole
 * point is that the stored preference — not a query parameter — is what survives a reload.
 * The runner's locale is pinned to en-US in playwright.config.ts, so the starting language
 * is English and the starting theme is light.
 */
test.describe('settings', () => {
  test('the language choice changes the copy and outlives a reload', async ({ signedInPage }) => {
    const page = signedInPage;
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

    await page.getByRole('main').getByLabel('Interface language').selectOption('ru');

    await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Внешний вид' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
    await expect(page.getByRole('main').getByLabel('Язык интерфейса')).toHaveValue('ru');
  });

  test('the theme toggle flips the document class and outlives a reload', async ({
    signedInPage,
  }) => {
    const page = signedInPage;
    await page.goto('/settings');

    const html = page.locator('html');
    await expect(html).toHaveClass(/\blight\b/);

    // Located by testid, not by label: the accessible name is translated, so asserting on
    // its copy would make this a test of the dictionary rather than of the toggle.
    const toggle = page.getByTestId('theme-toggle');
    await toggle.click();

    await expect(html).toHaveClass(/\bdark\b/);
    await expect(html).not.toHaveClass(/\blight\b/);

    await page.reload();

    await expect(html).toHaveClass(/\bdark\b/);
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
  });

  test('diagnostics report the API and the model registry', async ({ signedInPage }) => {
    const page = signedInPage;
    await page.goto('/settings');

    await expect(page.getByText('API reachable')).toBeVisible();
    const veo = 'Google Veo 3.1 Fast · veo-3.1-fast-generate-001';
    const imagen = 'Google Imagen 4 · imagen-4.0-generate-001';
    await expect(page.getByText(veo)).toBeVisible();
    await expect(page.getByText(imagen)).toBeVisible();
  });
});
