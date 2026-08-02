import type { Locator, Page } from '@playwright/test';
import { expect, openApp, seedGeneration, test } from '../fixtures.js';

/**
 * The stat tiles carry no testid, so they are found by their label. The labels render above
 * the results grid, which is why `.first()` stays unambiguous even when a status pill lower
 * down shares the wording ("Ready" is both dashboard.completed and status.completed).
 */
function statTile(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).first().locator('xpath=..');
}

/** A card is a prompt paragraph plus the thumbnail button that opens it. */
function cardFor(page: Page, prompt: string): Locator {
  return page.getByText(prompt).locator('xpath=..');
}

test.describe('dashboard', () => {
  test('an untouched account shows the empty state and zeroed tiles', async ({ signedInPage }) => {
    await openApp(signedInPage, '/dashboard');

    await expect(signedInPage.getByRole('heading', { name: 'My videos' })).toBeVisible();
    await expect(signedInPage.getByText('Nothing generated yet')).toBeVisible();

    await expect(statTile(signedInPage, 'Total')).toContainText('0');
    await expect(statTile(signedInPage, 'Ready')).toContainText('0');
    await expect(statTile(signedInPage, 'In progress')).toContainText('0');
    await expect(statTile(signedInPage, 'Failed')).toContainText('0');

    // The empty state's call to action is the only way out of an empty account.
    await signedInPage.getByRole('button', { name: 'New video' }).last().click();
    await expect(signedInPage).toHaveURL(/\/studio/);
  });

  test('seeded generations drive both the tiles and the grid', async ({ signedInPage, api }) => {
    const firstDone = 'a lighthouse in fog';
    const secondDone = 'a neon alley after rain';
    const stillRunning = 'a rooftop at golden hour';

    await seedGeneration(api, { prompt: firstDone, complete: true });
    await seedGeneration(api, { prompt: secondDone, complete: true });
    const running = await seedGeneration(api, { prompt: stillRunning });
    expect(running.status).toBe('processing');

    await openApp(signedInPage, '/dashboard');

    await expect(statTile(signedInPage, 'Total')).toContainText('3');
    await expect(statTile(signedInPage, 'Ready')).toContainText('2');
    await expect(statTile(signedInPage, 'In progress')).toContainText('1');
    await expect(statTile(signedInPage, 'Failed')).toContainText('0');

    for (const prompt of [firstDone, secondDone, stillRunning]) {
      await expect(signedInPage.getByText(prompt)).toBeVisible();
    }

    // Opening a card hands the generation to the studio through the query string.
    await cardFor(signedInPage, firstDone).getByRole('button').first().click();
    await expect(signedInPage).toHaveURL(/\/studio\?generation=/);
  });
});
