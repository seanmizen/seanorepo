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
    await expect(page.getByTestId('brief-form-failure')).toBeVisible();
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
    await expect(page.getByTestId('bid-action-failure')).toBeVisible();
    // A designer with no profile is refused for that reason. One awaiting
    // review is refused for approval. What matters to this test is that the
    // refusal ARRIVES and names a cause, not which of the two it is.
    await expect(page.getByTestId('bid-action-failure')).toContainText(
      /profile|approved/i,
    );
  });
});

test.describe('a link shared off-platform', () => {
  test('an unlisted project opens for whoever holds the URL', async ({
    page,
  }) => {
    await signInAs(page, 'link-owner');
    const title = `Unlisted ${Date.now()}`;

    await page.goto('/account/briefs');
    await page.getByTestId('post-a-project').click();
    await page.getByTestId('field-brief-title').fill(title);
    await page.getByTestId('field-brief-description').fill('Sent by email.');
    await page.getByTestId('field-brief-visibility').selectOption('link');
    await page.getByTestId('submit-brief').click();
    await expect(page.getByTestId('my-briefs-list')).toContainText(title);

    await page.getByRole('link', { name: 'Manage' }).first().click();
    await page.getByTestId('publish-brief').click();
    await expect(page.getByTestId('brief-state')).toHaveText('live');

    const href = await page
      .getByTestId('brief-public-link')
      .getAttribute('href');
    expect(href, 'the buyer is never shown a link to send').toBeTruthy();

    /*
     * What `link` is for: the buyer sends the URL to a designer they already
     * know, off-platform. It must open for somebody who was never invited and
     * is not the owner (REQ-BRIEF-005), while staying off the public board.
     */
    await page.context().clearCookies();

    await page.goto('/briefs');
    await expect(page.getByTestId('briefs-list')).not.toContainText(title);

    await page.goto(href as string);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  });
});
