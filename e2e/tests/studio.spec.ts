import type { Locator, Page } from '@playwright/test';
import { expect, openApp, test, WEB_ORIGIN } from '../fixtures.js';

/** ModelPicker is a radiogroup of cards; each card's text starts with the model name. */
function modelCard(page: Page, name: string): Locator {
  return page.getByRole('radiogroup', { name: 'Model' }).getByRole('radio').filter({
    hasText: name,
  });
}

function durationOptions(page: Page): Locator {
  return page.getByRole('radiogroup', { name: 'Duration' });
}

test.describe('studio', () => {
  test('a prompt becomes a playable video', async ({ signedInPage }) => {
    const page = signedInPage;
    await openApp(page, '/studio');

    await modelCard(page, 'Google Veo 3 Fast').click();
    await expect(page.getByTestId('studio-summary')).toContainText('Google Veo 3 Fast');

    const prompt = 'a paper boat drifting down a rain-slick street at dusk';
    await page.getByLabel('Prompt').fill(prompt);

    const generate = page.getByRole('button', { name: 'Generate' });
    await expect(generate).toBeEnabled();
    await generate.click();

    // FAKE_VERTEX hands back an operation immediately and the SSE poller settles it on its
    // next tick, so the record is genuinely observed in flight before it completes.
    await expect(page.getByText('Generating').first()).toBeVisible();
    await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 60_000 });

    // The player only mounts once the record carries a result URL.
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

    const source = await page.locator('video').first().getAttribute('src');
    expect(source, 'the completed generation must expose a result URL').toBeTruthy();

    // The URL is relative to the web origin, which proxies /media through to the API's
    // static driver — fetching it proves the fake driver really wrote a playable file.
    const media = await page.request.get(new URL(source ?? '', WEB_ORIGIN).toString());
    expect(media.status()).toBe(200);
    expect(media.headers()['content-type'] ?? '').toContain('video/');
    expect((await media.body()).byteLength).toBeGreaterThan(0);
  });

  test('switching models clamps a duration the new model cannot take', async ({ signedInPage }) => {
    const page = signedInPage;
    await openApp(page, '/studio');

    // Veo 3.1 Fast offers 4 / 6 / 8 seconds; Veo 2 offers 5 / 6 / 7 / 8.
    await modelCard(page, 'Google Veo 3.1 Fast').click();
    await durationOptions(page).getByRole('radio', { name: '4s' }).click();
    await expect(page.getByTestId('studio-summary')).toContainText('4s');

    await modelCard(page, 'Google Veo 2').click();

    // 4s is gone, so the selection snaps to the nearest supported value instead of staying
    // on one the API would reject.
    await expect(durationOptions(page).getByRole('radio', { name: '4s' })).toHaveCount(0);
    await expect(page.getByTestId('studio-summary')).toContainText('5s');
    await expect(durationOptions(page).getByRole('radio', { name: '5s' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('an empty prompt cannot be submitted', async ({ signedInPage }) => {
    await openApp(signedInPage, '/studio');

    const generate = signedInPage.getByRole('button', { name: 'Generate' });
    await expect(generate).toBeDisabled();

    await signedInPage.getByLabel('Prompt').fill('   ');
    await expect(generate).toBeDisabled();

    await signedInPage.getByLabel('Prompt').fill('a single tulip in a wind tunnel');
    await expect(generate).toBeEnabled();
  });
});
