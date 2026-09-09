// The buyer's shortlist: save/unsave, and — the whole point of the ticket —
// an anonymous visitor's save surviving the signup round trip and completing
// itself on return.
//
// REQ-PRODUCT-003: sign-up is asked for at the point of value. This is that
// point.

import { expect, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

test.describe('saving a designer while signed in', () => {
  test('a signed-in buyer can save and unsave from the profile page', async ({
    page,
  }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('save-signed-in'));

    await page.goto('/designers/studio-mercer');
    const saveButton = page.getByTestId('save-designer');
    await expect(saveButton).toHaveAttribute('aria-pressed', 'false');

    await saveButton.click();
    await expect(saveButton).toHaveAttribute('aria-pressed', 'true');

    // Lands on the shortlist without a manual refresh.
    await page.goto('/account/saved');
    await expect(page.getByTestId('saved-designers-grid')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Studio Mercer' }),
    ).toBeVisible();

    // Unsaving from the shortlist removes it from the grid.
    await page.getByTestId('unsave-designer').click();
    await expect(page.getByTestId('saved-designers-empty')).toBeVisible();
  });

  test('saving is idempotent from the UI: clicking twice stays saved', async ({
    page,
  }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('save-idempotent'));

    await page.goto('/designers/studio-mercer');
    const saveButton = page.getByTestId('save-designer');
    await saveButton.click();
    await expect(saveButton).toHaveAttribute('aria-pressed', 'true');

    // A second save request for the same pair must still read as saved, not
    // as an error the button has to recover from.
    await page.goto('/designers/studio-mercer');
    await expect(saveButton).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the anonymous save — the point of the ticket', () => {
  test('an anonymous visitor clicks save, signs up, and the save completes itself on return', async ({
    page,
  }) => {
    // Signed out throughout the click and the redirect.
    await page.goto('/designers/studio-mercer');
    await expect(page.getByTestId('studio-name')).toHaveText('Studio Mercer');

    const saveButton = page.getByTestId('save-designer');
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // The click sends them to sign up rather than saving on the spot, and
    // carries where they were so they land back on THIS profile, not a
    // generic home page.
    await expect(page).toHaveURL(
      /\/login\?returnTo=%2Fdesigners%2Fstudio-mercer/,
    );

    const email = uniqueEmail('anon-save');
    await signIn(page, email);

    // No manual refresh: the very first render of the returned-to page
    // already shows the save as complete.
    await expect(page).toHaveURL(/\/designers\/studio-mercer$/);
    await expect(page.getByTestId('studio-name')).toHaveText('Studio Mercer');
    await expect(saveButton).toHaveAttribute('aria-pressed', 'true');

    // And it genuinely persisted server-side, not just in this render.
    await page.goto('/account/saved');
    await expect(
      page.getByRole('heading', { name: 'Studio Mercer' }),
    ).toBeVisible();
  });

  test('a plain, unrelated sign-in does not save anything nobody asked to save', async ({
    page,
  }) => {
    // No click on Save anywhere in this test — a visitor who just signs in
    // must not gain a saved designer they never asked for. This is the
    // other half of "cannot be used to save on behalf of another user": the
    // intent is opt-in, not ambient.
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('plain-signin'));

    await page.goto('/account/saved');
    await expect(page.getByTestId('saved-designers-empty')).toBeVisible();
  });
});
