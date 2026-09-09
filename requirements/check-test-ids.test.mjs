#!/usr/bin/env node
/**
 * Tests for requirements/check-test-ids.mjs.
 *
 * `node:test` and `node:assert` are Node stdlib — no new dependency, in
 * keeping with the checker itself. Run with:
 *
 *   node --test requirements/check-test-ids.test.mjs
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDuplicates, checkSource } from './check-test-ids.mjs';

const violationsOf = (source, file = 'fixture.tsx') => {
  const { occurrences, violations } = checkSource(file, source, file);
  return { occurrences, violations };
};

const rulesOf = (violations) => violations.map((v) => v.rule).sort();

test('the #231 shape: isError alone collapses everything into -missing', () => {
  // This is the actual bug from #231 (me/project.tsx) and its live
  // reappearance found while building this check (admin/designer-review.tsx,
  // fixed alongside this file, #234): `isError` with no narrowing on a
  // specific status. A dead backend renders identically to a deleted record.
  const source = `
    const AdminDesignerReview = () => {
      if (review.isError || !review.data) {
        return (
          <Container>
            <Alert severity="info" data-testid="review-missing">
              That profile is no longer available.
            </Alert>
          </Container>
        );
      }
      return <Container />;
    };
  `;

  const { violations } = violationsOf(source);
  assert.ok(
    violations.some((v) => v.rule === 'unnarrowed-missing-empty'),
    'expected an unnarrowed-missing-empty violation for the #231 shape',
  );
});

test('narrowing on a specific status clears the #231 check', () => {
  // The fixed shape: a 404 (checked via `.status`) is the only thing allowed
  // to render `-missing`; everything else falls through to FailureNotice.
  const source = `
    const AdminDesignerReview = () => {
      if (review.isError || !review.data) {
        const missing =
          review.error instanceof ApiError && review.error.status === 404;
        return (
          <Container>
            {missing ? (
              <Alert severity="info" data-testid="review-missing">
                That profile is no longer available.
              </Alert>
            ) : (
              <FailureNotice
                error={review.error}
                notFound={{ title: 'Review', body: 'Gone.' }}
                testId="review-load-failure"
              />
            )}
          </Container>
        );
      }
      return <Container />;
    };
  `;

  const { violations } = violationsOf(source);
  assert.equal(
    violations.filter((v) => v.rule === 'unnarrowed-missing-empty').length,
    0,
    'narrowing on .status should clear the isError-without-narrowing rule',
  );
});

test('an -empty id is held to the same narrowing rule as -missing', () => {
  const source = `
    const Portfolio = () => {
      if (query.isError) {
        return <Typography data-testid="portfolio-empty">Nothing here.</Typography>;
      }
      return <Grid />;
    };
  `;
  const { violations } = violationsOf(source);
  assert.ok(violations.some((v) => v.rule === 'unnarrowed-missing-empty'));
});

test('a genuine empty-list id outside any isError branch is untouched', () => {
  const source = `
    const Portfolio = () => {
      if (query.isPending) return <Skeleton />;
      return query.data.length === 0 ? (
        <Typography data-testid="portfolio-empty">Nothing here.</Typography>
      ) : (
        <Grid data-testid="portfolio-grid" />
      );
    };
  `;
  const { violations } = violationsOf(source);
  assert.equal(violations.length, 0);
});

test('a testId reused across two unrelated surfaces is a duplicate', () => {
  const source = `
    const A = () => <Alert data-testid="thing-failure" />;
    const B = () => <Alert data-testid="thing-failure" />;
  `;
  const { occurrences } = violationsOf(source);
  const violations = checkDuplicates(occurrences);
  assert.ok(violations.some((v) => v.rule === 'duplicate-id'));
});

test('the same id in two mutually exclusive ternary branches is not a duplicate', () => {
  // The real breadcrumbs.tsx shape: a crumb renders as a link OR inert text,
  // never both — one condition, two presentations, not two conditions.
  const source = `
    const Breadcrumbs = () => (
      <nav>
        {crumb.isCurrent || !crumb.exists ? (
          <Typography data-testid="breadcrumb-crumb" />
        ) : (
          <MuiLink data-testid="breadcrumb-crumb" />
        )}
      </nav>
    );
  `;
  const { occurrences } = violationsOf(source);
  const violations = checkDuplicates(occurrences);
  assert.equal(
    violations.length,
    0,
    'mutually exclusive branches of one ternary must not be flagged',
  );
});

test('the same id split across two different files IS a duplicate', () => {
  const a = violationsOf(
    'export const A = () => <Alert data-testid="shared-id-failure" />;',
    'a.tsx',
  );
  const b = violationsOf(
    'export const B = () => <Alert data-testid="shared-id-failure" />;',
    'b.tsx',
  );
  const violations = checkDuplicates([...a.occurrences, ...b.occurrences]);
  assert.ok(violations.some((v) => v.rule === 'duplicate-id'));
});

test('a FailureNotice testId that does not end -failure is flagged', () => {
  const source = `
    const Page = () => (
      <FailureNotice error={e} notFound={n} testId="piece-error" />
    );
  `;
  const { violations } = violationsOf(source);
  assert.ok(
    violations.some((v) => v.rule === 'wrong-suffix-for-failure-component'),
  );
});

test('a FailureAlert testId ending -failure is clean', () => {
  const source = `
    const Page = () => (
      <FailureAlert error={e} fallback={f} testId="piece-action-failure" />
    );
  `;
  const { violations } = violationsOf(source);
  assert.equal(
    rulesOf(violations).includes('wrong-suffix-for-failure-component'),
    false,
  );
});

test('a confusable synonym for a reserved suffix is reported', () => {
  const source = `
    const Page = () => <Alert data-testid="thing-error" />;
  `;
  const { violations } = violationsOf(source);
  assert.ok(violations.some((v) => v.rule === 'confusable-suffix'));
});

test('the escape hatch comment silences a confusable-suffix false positive', () => {
  const source = `
    const Page = () => (
      <>
        {/* test-id-lint-ignore: not a query state, see REQ-FAIL-001 */}
        <Alert data-testid="render-error" />
      </>
    );
  `;
  const { violations } = violationsOf(source);
  assert.equal(violations.length, 0);
});

test('a dynamic (non-literal) test id is skipped rather than guessed at', () => {
  const source = `
    const Row = ({ testId }) => <Alert data-testid={testId} />;
  `;
  const { occurrences, violations } = violationsOf(source);
  assert.equal(occurrences.length, 0);
  assert.equal(violations.length, 0);
});

test('an unrelated named id (not a state surface) is left alone', () => {
  // "portfolio-needs-profile" is a real id from me/portfolio.tsx: an onboarding
  // nudge, not a failure — it correctly has no suffix from the vocabulary and
  // must not be flagged just for appearing inside an isError branch.
  const source = `
    const Portfolio = () => {
      if (query.isError) {
        const noProfileYet = query.error.status === 404;
        if (!noProfileYet) return <FailureNotice testId="portfolio-load-failure" />;
        return <Typography data-testid="portfolio-needs-profile">Start here.</Typography>;
      }
      return <Grid />;
    };
  `;
  const { violations } = violationsOf(source);
  assert.equal(violations.length, 0);
});
