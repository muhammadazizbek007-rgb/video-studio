import { expect, openApp, test } from '../fixtures.js';

test.describe('authentication', () => {
  test('an unauthenticated visitor is redirected off a protected route', async ({ page }) => {
    await openApp(page, '/dashboard');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('the sign-in page offers the Google control', async ({ page }) => {
    await openApp(page, '/login');

    await expect(page.getByRole('heading', { name: 'Video Studio' })).toBeVisible();
    const signIn = page.getByRole('button', { name: 'Continue with Google' });
    await expect(signIn).toBeVisible();
    await expect(signIn).toBeEnabled();
  });

  test('a signed-in account sees its own identity', async ({ signedInPage, account }) => {
    // The account identity is rendered on Settings, not in a shell header — see README.
    await openApp(signedInPage, '/settings');

    await expect(signedInPage.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(signedInPage.getByTestId('user-email')).toHaveText(account.email);
    await expect(signedInPage.getByText(account.name)).toBeVisible();
  });

  test('signing out drops the session and re-protects the route', async ({ signedInPage }) => {
    await openApp(signedInPage, '/settings');
    await signedInPage.getByTestId('sign-out').click();

    await expect(signedInPage).toHaveURL(/\/login$/);
    await expect(signedInPage.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    // The cookies are gone server-side too, so a fresh navigation must not slip through.
    await openApp(signedInPage, '/dashboard');
    await expect(signedInPage).toHaveURL(/\/login$/);
  });
});
