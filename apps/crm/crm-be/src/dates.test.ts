import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  dueWords,
  formatDate,
  fullDateTime,
  isoDateTime,
  today,
} from './dates';
import type { buildApp } from './index';
import {
  addOrg,
  bodyText,
  postForm,
  signInAdmin,
  testApp,
} from './test-helpers';

describe('formatDate', () => {
  test('shows a date as YYYY-Mon-DD, with the full year', () => {
    expect(formatDate('2026-11-03')).toBe('2026-Nov-03');
    expect(formatDate('1999-01-09')).toBe('1999-Jan-09');
  });

  test('shows a time as YYYY-Mon-DD HH:MM in London, 24-hour, with no seconds', () => {
    // Winter: London is UTC.
    expect(formatDate('2026-11-03T13:31:05.123Z')).toBe('2026-Nov-03 13:31');
    // Summer: London is UTC+1, so this is the next day.
    expect(formatDate('2026-07-01T23:30:00Z')).toBe('2026-Jul-02 00:30');
    expect(formatDate('2026-07-01T23:30:00Z', { time: false })).toBe(
      '2026-Jul-02',
    );
  });

  test('the full value has seconds and the London offset', () => {
    expect(isoDateTime('2026-11-03T13:31:05.123Z')).toBe(
      '2026-11-03T13:31:05+00:00',
    );
    expect(isoDateTime('2026-07-01T23:30:00Z')).toBe(
      '2026-07-02T00:30:00+01:00',
    );
    expect(isoDateTime('2026-06-01')).toBe('2026-06-01T00:00:00+01:00');
    expect(fullDateTime('2026-11-03T13:31:05Z')).toBe('2026-Nov-03 13:31:05');
  });

  test('the status words of a due date', () => {
    const shift = (days: number) => {
      const date = new Date(`${today()}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    expect(dueWords(shift(0))).toBe('today');
    expect(dueWords(shift(1))).toBe('tomorrow');
    expect(dueWords(shift(3))).toBe('in 3 days');
    expect(dueWords(shift(-1))).toBe('1 day overdue');
    expect(dueWords(shift(-2))).toBe('2 days overdue');
  });
});

describe('the dates on the pages', () => {
  let app: ReturnType<typeof buildApp>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(() => {
    ({ app, close } = testApp());
    cookie = signInAdmin(app);
  });

  afterEach(async () => {
    await close();
  });

  test('every date and time on each page is a <time> with the full value, in the one format (REQ-CRM-DATE-001)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme Plumbing',
      contact_name: 'Ann Smith',
    });
    await postForm(
      app,
      `/orgs/${slug}/stage`,
      { stage: 'lead', next_action: 'Call', next_action_on: '2000-01-01' },
      cookie,
    );
    await postForm(app, `/orgs/${slug}/activity`, { outcome: 'spoke' }, cookie);
    await postForm(
      app,
      `/orgs/${slug}/activity`,
      { outcome: 'note', note: 'A note' },
      cookie,
    );

    const TIME =
      /<time dateTime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d" title="\d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d:\d\d">\d{4}-[A-Z][a-z]{2}-\d\d( \d\d:\d\d)?<\/time>/g;
    let times = 0;
    for (const url of [
      '/',
      '/orgs',
      `/orgs/${slug}`,
      `/orgs/${slug}/edit`,
      '/account',
      '/account/passkeys',
      '/account/sessions',
    ]) {
      const html = (
        await app.inject({ method: 'GET', url, headers: { cookie } })
      ).body;
      // Each <time> has the full value in its attributes.
      const all = html.match(/<time[^>]*>[^<]*<\/time>/g) ?? [];
      const good = html.match(TIME) ?? [];
      expect(all).toEqual(good);
      times += all.length;
      // No date shows outside a <time>, in any other format.
      const text = bodyText(html.replace(TIME, ''));
      expect(text).not.toMatch(/\d{4}-\d\d-\d\d/);
      expect(text).not.toMatch(/\d{4}-[A-Z][a-z]{2}-\d\d/);
      expect(text).not.toMatch(
        /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
      );
    }
    // Today, the orgs menu, the LCD and records of the organisation, and
    // the sessions: each one has a date.
    expect(times).toBeGreaterThanOrEqual(8);
  });
});
