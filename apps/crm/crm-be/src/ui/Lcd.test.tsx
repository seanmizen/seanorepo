import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { buildApp } from '../index';
import { divOf, postForm, signInAdmin, testApp } from '../test-helpers';
import { Lcd } from './Lcd';

/** The source of the theme. */
const THEME = readFileSync(
  path.join(import.meta.dir, '..', '..', '..', 'crm-fe', 'src', 'theme.css'),
  'utf8',
);

/**
 * Check the rules of REQ-CRM-LCD-001 in the HTML of one LCD:
 * - Each LED is in the bezel: the last child of a menu row (`<li>`), after
 *   the link. No LED is inside the glass: in a link, the read-out or the
 *   alert.
 * - Each menu row starts with its arrow column.
 * Returns the number of LEDs.
 */
const checkLcd = (lcd: string) => {
  const leds = lcd.match(/class="led/g)?.length ?? 0;
  const inBezel =
    lcd.match(/<\/a><span class="led( on)?" aria-hidden="true"><\/span><\/li>/g)
      ?.length ?? 0;
  expect(inBezel).toBe(leds);
  for (const link of lcd.match(/<a [\s\S]*?<\/a>/g) ?? []) {
    expect(link).not.toContain('led');
  }
  const rows = lcd.match(/<li>/g)?.length ?? 0;
  const arrows =
    lcd.match(
      /<li><a href="[^"]+" title="[^"]+"><span class="arrow" aria-hidden="true"><\/span><span class="name">/g,
    )?.length ?? 0;
  expect(arrows).toBe(rows);
  return leds;
};

describe('the LCD (REQ-CRM-LCD-001)', () => {
  test('no LED is inside the glass, and each menu row has the arrow column and an LED in the bezel (REQ-CRM-LCD-001)', () => {
    const html = renderToStaticMarkup(
      <Lcd
        alert="Type a note."
        rows={[
          { label: 'Name', value: 'Acme' },
          { label: 'Due', value: '2 days overdue', mark: true },
        ]}
        menu={{
          legend: ['Organisation', 'Next action'],
          sublegend: ['Stage', 'Last activity'],
          empty: 'None.',
          items: [
            { href: '/orgs/a', name: 'Alpha', value: 'Due', led: true },
            { href: '/orgs/b', name: 'Bravo', detail: 'Lead', led: false },
            { href: '/orgs/c', name: 'Charlie', title: 'Charlie · Won' },
          ],
        }}
      />,
    );
    // Each row has an LED, lit or not, because one row has one.
    expect(checkLcd(html)).toBe(3);
    expect(html.match(/class="led on"/g)).toHaveLength(1);
    expect(html).toContain('<ol class="menu two-lines leds"');
    // The full text of each row is in its title.
    expect(html).toContain('<a href="/orgs/a" title="Alpha">');
    expect(html).toContain('<a href="/orgs/c" title="Charlie · Won">');
    // The status in the glass is the mark, never an LED.
    expect(html).toContain('<dd class="mark">2 days overdue</dd>');
    expect(html).toContain('<p role="alert">Type a note.</p>');

    // A menu with no LED has no LED column.
    const plain = renderToStaticMarkup(
      <Lcd
        menu={{
          legend: ['Page', 'Count'],
          empty: '',
          items: [{ href: '/account/passkeys', name: 'Passkeys', value: '1' }],
        }}
      />,
    );
    expect(checkLcd(plain)).toBe(0);
    expect(plain).toContain('<ol class="menu"');
  });

  describe('on each page', () => {
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

    test('each page follows the LCD rules, and the theme fixes the row height and the arrow column (REQ-CRM-LCD-001)', async () => {
      for (const name of ['Alpha', 'Bravo']) {
        await postForm(app, '/orgs/new', { name }, cookie);
      }
      await postForm(
        app,
        '/orgs/alpha/stage',
        { stage: 'lead', next_action: 'Call', next_action_on: '2000-01-01' },
        cookie,
      );
      const get = async (url: string) =>
        (await app.inject({ method: 'GET', url, headers: { cookie } })).body;
      const home = divOf(await get('/'), 'lcd');
      expect(checkLcd(home)).toBe(2);
      expect(home.match(/class="led on"/g)).toHaveLength(1);
      checkLcd(divOf(await get('/account'), 'lcd'));
      const org = divOf(await get('/orgs/alpha'), 'lcd');
      checkLcd(org);
      expect(org).toContain('<dd class="mark">');

      // Each menu row has one fixed height. The arrow shows in its own
      // column, only on a hover or a focus. The mark does not blink with
      // reduced motion.
      expect(THEME).toMatch(/\.menu li \{[^}]*height: var\(--row\);/);
      expect(THEME).toMatch(
        /\.menu a:is\(:hover, :focus-visible\) \.arrow::before \{\s*content: "\\25B6";/,
      );
      expect(THEME.match(/\\25B6/g)).toHaveLength(1);
      // The arrow of a name order is in the arrow column of the legend: the
      // legend of the names starts after that column.
      expect(THEME).toMatch(
        /\.menu::before \{[^}]*padding-left: calc\(0\.75rem \+ var\(--arrow\)\);/,
      );
      expect(THEME).toMatch(
        /\.menu\[data-order-name\] > li:first-child::before \{[^}]*left: 0\.75rem;/,
      );
      expect(THEME).toMatch(
        /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.mark::before \{\s*animation: none;/,
      );
    });
  });
});
