import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

const ADMIN_EMAIL = 'admin@inside.test';

const signInAs = async (
  page: Page,
  email: string,
  role: 'buyer' | 'designer' = 'buyer',
) => {
  await page.goto('/login');
  await waitForApp(page);
  await signIn(page, email, role);
};

/** A 1x1 PNG, small enough to inline and real enough for the decoder. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function fillProfile(page: Page, studioName: string) {
  await page.goto('/me/profile');
  await expect(page.getByTestId('field-studioName')).toBeVisible();

  await page.getByTestId('field-studioName').fill(studioName);
  await page.getByTestId('field-headline').fill('Quiet rooms, honest budgets');
  await page.getByTestId('field-bio').fill('We do kitchens and extensions.');
  await page.getByTestId('profile-next').click();

  await expect(page.getByTestId('field-location')).toBeVisible();
  await page.getByTestId('field-location').fill('Sheffield');
  await page.getByTestId('profile-next').click();

  await expect(page.getByTestId('profile-review')).toBeVisible();
}

test.describe('designer onboarding', () => {
  test('an empty studio can be taken all the way to submitted', async ({
    page,
  }) => {
    const email = uniqueEmail('onboard');
    const studioName = `Onboard E2E ${Date.now()}`;
    await signInAs(page, email, 'designer');

    // Nothing yet — an invitation, not an error.
    await page.goto('/me');
    await expect(page.getByTestId('start-profile')).toBeVisible();

    await fillProfile(page, studioName);
    await page.getByTestId('profile-submit').click();

    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByTestId('profile-status')).toHaveText(/in review/i);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      studioName,
    );
  });

  test('a studio name is required before anything is saved', async ({
    page,
  }) => {
    await signInAs(page, uniqueEmail('onboard-valid'), 'designer');
    await page.goto('/me/profile');
    await expect(page.getByTestId('field-studioName')).toBeVisible();

    await page.getByTestId('profile-next').click();
    await expect(page.getByTestId('profile-error')).toBeVisible();
    // Still on step one — a failed save must not advance the stepper.
    await expect(page.getByTestId('field-studioName')).toBeVisible();
  });

  test('work in progress survives a refresh mid-edit', async ({ page }) => {
    await signInAs(page, uniqueEmail('onboard-draft'), 'designer');
    await page.goto('/me/profile');
    await expect(page.getByTestId('field-studioName')).toBeVisible();

    // Typed but never saved: the whole point is that this is not on the server.
    await page.getByTestId('field-bio').fill('Half a thought about our work.');
    await page.reload();

    await expect(page.getByTestId('field-bio')).toHaveValue(
      'Half a thought about our work.',
    );
  });

  test('a piece can be created, given an image, and published', async ({
    page,
  }) => {
    await signInAs(page, uniqueEmail('onboard-piece'), 'designer');
    await fillProfile(page, `Piece E2E ${Date.now()}`);

    await page.goto('/me/portfolio');
    await page.getByTestId('add-piece').click();
    await expect(page).toHaveURL(/\/me\/portfolio\/\d+$/);

    await page.getByTestId('piece-title').fill('Walkley Loft');
    await page.getByTestId('piece-save').click();

    await page.getByTestId('image-input').setInputFiles({
      name: 'loft.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('project-image')).toHaveCount(1);

    await page.getByTestId('piece-publish').click();
    await expect(page.getByTestId('piece-publish')).toHaveText(/unpublish/i);

    await page.goto('/me/portfolio');
    await expect(page.getByText('Walkley Loft')).toBeVisible();
  });

  test('a rejected upload says what was wrong with the file', async ({
    page,
  }) => {
    await signInAs(page, uniqueEmail('onboard-reject'), 'designer');
    await fillProfile(page, `Reject E2E ${Date.now()}`);

    await page.goto('/me/portfolio');
    await page.getByTestId('add-piece').click();
    await expect(page).toHaveURL(/\/me\/portfolio\/\d+$/);

    // Not an image at all. The message must come from the server's own
    // wording, not a generic "upload failed".
    await page.getByTestId('image-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a photograph'),
    });

    const error = page.getByTestId('project-error');
    await expect(error).toBeVisible();
    await expect(error).not.toHaveText(/^Something went wrong/);
  });

  test('a rejected designer sees the reason and can resubmit', async ({
    page,
  }) => {
    const email = uniqueEmail('onboard-rejected');
    const studioName = `Rejected E2E ${Date.now()}`;
    await signInAs(page, email, 'designer');
    await fillProfile(page, studioName);
    await page.getByTestId('profile-submit').click();
    await expect(page.getByTestId('profile-status')).toHaveText(/in review/i);

    const profileId = await page.evaluate(async () => {
      const res = await fetch('http://localhost:4161/api/me/profile', {
        credentials: 'include',
      });
      return (await res.json()).profile.id as number;
    });

    await signInAs(page, ADMIN_EMAIL);
    await page.goto(`/admin/designers/${profileId}`);
    await page
      .getByRole('textbox', { name: /note to the designer/i })
      .fill('Please add at least one completed project.');
    await page.getByRole('button', { name: /^reject$/i }).click();
    await expect(page.getByTestId('review-status')).toHaveText(/rejected/i);

    // Back as the designer: the note has to be unmissable, or the rejection is
    // a dead end they cannot act on.
    await signInAs(page, email, 'designer');
    await page.goto('/me');
    await expect(page.getByTestId('profile-status')).toHaveText(
      /changes needed/i,
    );
    await expect(page.getByTestId('review-note')).toHaveText(
      /at least one completed project/i,
    );

    await page.goto('/me/profile');
    await page.getByTestId('profile-next').click();
    await page.getByTestId('profile-next').click();
    await page.getByTestId('profile-submit').click();

    await expect(page.getByTestId('profile-status')).toHaveText(/in review/i);
  });
});
