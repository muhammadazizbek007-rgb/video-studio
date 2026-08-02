import { expect, openApp, seedElement, test } from '../fixtures.js';

const ELEMENT_NAME = 'Neon Cat';
const ELEMENT_HANDLE = '@Neon_Cat';

test.describe('elements', () => {
  test('an element can be created, mentioned and deleted', async ({ signedInPage }) => {
    const page = signedInPage;

    // The library lives on Settings; the studio only consumes it.
    await openApp(page, '/settings');
    await expect(page.getByText('No elements yet')).toBeVisible();

    await page.getByRole('button', { name: 'New element' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('heading', { name: 'Create an element' })).toBeVisible();

    await editor.getByLabel('Name', { exact: true }).fill(ELEMENT_NAME);
    await editor.getByLabel('Description', { exact: true }).fill('a tabby with a neon collar');

    // The handle is derived from the name and previewed before anything is saved.
    await expect(editor.getByText(ELEMENT_HANDLE)).toBeVisible();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(editor).toBeHidden();
    const card = page.getByRole('listitem').filter({ hasText: ELEMENT_HANDLE });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(ELEMENT_NAME)).toBeVisible();

    // The studio resolves @mentions against the same library.
    await openApp(page, '/studio');
    const promptField = page.getByLabel('Prompt');
    await promptField.fill('a slow dolly toward @Neon');

    const suggestions = page.getByRole('listbox', { name: 'Mentioned elements' });
    await expect(suggestions).toBeVisible();
    const option = suggestions.getByRole('option').filter({ hasText: ELEMENT_HANDLE });
    await expect(option).toHaveCount(1);
    await option.click();

    // Picking a suggestion swaps the partial mention for the full handle.
    await expect(promptField).toHaveValue(`a slow dolly toward ${ELEMENT_HANDLE} `);
    await expect(suggestions).toBeHidden();

    await openApp(page, '/settings');
    await page
      .getByRole('listitem')
      .filter({ hasText: ELEMENT_HANDLE })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('heading', { name: 'Delete element' })).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByRole('listitem').filter({ hasText: ELEMENT_HANDLE })).toHaveCount(0);
    await expect(page.getByText('No elements yet')).toBeVisible();
  });

  test('cancelling the confirmation keeps the element', async ({ signedInPage, api }) => {
    const element = await seedElement(api, { name: 'Rusty Van', category: 'prop' });

    await openApp(signedInPage, '/settings');
    const card = signedInPage.getByRole('listitem').filter({ hasText: element.handle });
    await expect(card).toHaveCount(1);

    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await signedInPage.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(signedInPage.getByRole('dialog')).toBeHidden();
    await expect(card).toHaveCount(1);
  });
});
