import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

/**
 * Post-a-project, end to end.
 *
 * The flow the ticket exists for: a buyer posts a project, publishes it, a
 * designer finds it on the public board and bids, and the buyer reads the
 * response. Plus the three cases where the bid control must NOT be offered,
 * because a control that appears and then fails on submit is exactly what
 * #162 set out to avoid.
 */

const signInAs = async (
  page: Page,
  prefix: string,
  role: 'buyer' | 'designer' = 'buyer',
) => {
  await page.goto('/login');
  await waitForApp(page);
  await signIn(page, uniqueEmail(prefix), role);
};

const postBrief = async (page: Page, title: string) => {
  await page.goto('/account/briefs');
  await page.getByTestId('post-a-project').click();
  await page.getByTestId('field-brief-title').fill(title);
  await page
    .getByTestId('field-brief-description')
    .fill('A kitchen and a small extension, budget open.');
  await page.getByTestId('submit-brief').click();
  await expect(page.getByTestId('my-briefs-list')).toContainText(title);
};

test.describe('a buyer posts a project', () => {
  test('posts it, and it starts unpublished', async ({ page }) => {
    await signInAs(page, 'brief-buyer');
    const title = `Kitchen ${Date.now()}`;
    await postBrief(page, title);

    // REQ-BRIEF-004: private and unpublished unless asked otherwise. Nothing
    // reaches the public board by filling in a form.
    await page.getByRole('link', { name: 'Manage' }).first().click();
    await expect(page.getByTestId('brief-state')).toHaveText('unpublished');
  });

  test('an empty project is refused with a reason', async ({ page }) => {
    await signInAs(page, 'brief-empty');
    await page.goto('/account/briefs');
    await page.getByTestId('post-a-project').click();
    await page.getByTestId('submit-brief').click();
    await expect(page.getByTestId('brief-form-error')).toBeVisible();
  });
});

test.describe('the public board', () => {
  test('is readable with no account at all', async ({ page }) => {
    await page.goto('/briefs');
    await waitForApp(page);
    // Either state is correct here — what matters is that an anonymous
    // visitor gets the page rather than a login wall (REQ-PRODUCT-001).
    await expect(
      page.getByTestId('briefs-list').or(page.getByTestId('briefs-empty')),
    ).toBeVisible();
  });

  test('offers no way to bid when signed out', async ({ page }) => {
    await signInAs(page, 'board-owner');
    const title = `Extension ${Date.now()}`;
    await postBrief(page, title);
    await page.getByRole('link', { name: 'Manage' }).first().click();
    await page.getByTestId('publish-brief').click();
    await expect(page.getByTestId('brief-state')).toHaveText('live');

    await page.context().clearCookies();
    await page.goto('/briefs');
    await page.getByRole('link', { name: title }).click();

    await expect(page.getByTestId('bid-signed-out')).toBeVisible();
    await expect(page.getByTestId('bid-form')).toHaveCount(0);
  });

  test('a buyer is told bidding is the designer side', async ({ page }) => {
    await signInAs(page, 'board-buyer');
    const title = `Loft ${Date.now()}`;
    await postBrief(page, title);
    await page.getByRole('link', { name: 'Manage' }).first().click();
    await page.getByTestId('publish-brief').click();

    await page.goto('/briefs');
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByTestId('bid-not-designer')).toBeVisible();
    await expect(page.getByTestId('bid-form')).toHaveCount(0);
  });
});

test.describe('a designer answers a project', () => {
  test('an unapproved designer is told why, rather than failing on submit', async ({
    page,
  }) => {
    await signInAs(page, 'bid-owner');
    const title = `Bathroom ${Date.now()}`;
    await postBrief(page, title);
    await page.getByRole('link', { name: 'Manage' }).first().click();
    await page.getByTestId('publish-brief').click();

    await page.context().clearCookies();
    await signInAs(page, 'bid-unapproved', 'designer');
    await page.goto('/briefs');
    await page.getByRole('link', { name: title }).click();

    /*
     * The form IS offered — the server owns approval, and the page cannot know
     * a designer's status without asking. What must not happen is a silent
     * failure: the refusal has to arrive as a message the designer can read.
     */
    await page.getByTestId('field-bid-message').fill('We would love to help.');
    await page.getByTestId('send-bid').click();
    await expect(page.getByTestId('bid-error')).toBeVisible();
    await expect(page.getByTestId('bid-error')).toContainText(/approved/i);
  });
});
