import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { buildApp } from '../index';
import { divOf, postForm, signInAdmin, testApp } from '../test-helpers';
import { DisplayUnit } from './DisplayUnit';
import { Lcd } from './Lcd';

/** The source of the theme. */
const THEME = readFileSync(
  path.join(import.meta.dir, '..', '..', '..', 'crm-fe', 'src', 'theme.css'),
  'utf8',
);

/**
 * Check the rules of REQ-CRM-LCD-002 in the HTML of one glass (an LCD or
 * the glass of a display unit):
 * - No LED is inside the glass.
 * - The glass holds no form control, no heading, and no link out of a menu.
 * - Each menu row starts with its arrow column.
 * Returns the number of status marks.
 */
const checkGlass = (glass: string) => {
  expect(glass).not.toMatch(/class="led/);
  expect(glass).not.toMatch(/<(form|input|button|select|textarea|h1|h2)\b/);
  expect(glass.replace(/<ol class="menu[\s\S]*<\/ol>/, '')).not.toContain(
    '<a ',
  );
  const rows = glass.match(/<li>/g)?.length ?? 0;
  const arrows =
    glass.match(
      /<li><a href="[^"]+" title="[^"]+"><span class="arrow" aria-hidden="true"><\/span><span class="name">/g,
    )?.length ?? 0;
  expect(arrows).toBe(rows);
  return glass.match(/class="(?:line )?mark"/g)?.length ?? 0;
};

describe('the glass (REQ-CRM-LCD-002)', () => {
  test('no LED is inside a glass, and each menu row has the arrow column (REQ-CRM-LCD-002)', () => {
    const lcd = renderToStaticMarkup(
      <Lcd
        alert="Type a note."
        rows={[
          { label: 'Name', value: 'Acme' },
          { label: 'Due', value: '2 days overdue', mark: true },
        ]}
        menu={{
          legend: ['Page', 'Count'],
          empty: 'None.',
          items: [
            { href: '/account/passkeys', name: 'Passkeys', value: '1' },
            { href: '/account/sessions', name: 'Sessions', value: '2' },
          ],
        }}
      />,
    );
    expect(checkGlass(lcd)).toBe(1);
    expect(lcd).toContain('<ol class="menu"');
    // The full text of each row is in its title.
    expect(lcd).toContain('<a href="/account/passkeys" title="Passkeys">');
    // The status in the glass is the mark, never an LED.
    expect(lcd).toContain('<dd class="mark">2 days overdue</dd>');
    expect(lcd).toContain('<p role="alert">Type a note.</p>');

    // The display unit: the glass is a strip of readings, legend over
    // value. The keys are on the plate, out of the glass. The line of a
    // save or an error is always present.
    const unit = renderToStaticMarkup(
      <DisplayUnit
        alert={null}
        readings={[
          {
            label: 'First in list',
            kind: 'name',
            value: 'Acme',
            lines: [{ value: 'Call' }, { value: '2 days overdue', mark: true }],
          },
          { label: 'Overdue', kind: 'count', value: 1 },
        ]}
        keys={[
          { id: 'k-off', label: 'Prev', caption: 'First page', off: true },
          {
            id: 'k-on',
            label: 'Next',
            caption: 'Page 2 of 2',
            href: '/?page=2',
          },
        ]}
      />,
    );
    const glass = divOf(unit, 'glass');
    expect(checkGlass(glass)).toBe(1);
    expect(glass).toContain('<p role="alert" class="status empty"></p>');
    expect(glass).toContain(
      '<dl class="strip"><div class="name"><dt>First in list</dt><dd class="value">Acme</dd><dd class="line">Call</dd><dd class="line mark">2 days overdue</dd></div><div class="count"><dt>Overdue</dt><dd class="value">1</dd></div></dl>',
    );
    expect(divOf(unit, 'plate')).toContain(
      '<a class="key" id="k-on" href="/?page=2" aria-describedby="k-on-caption">Next</a> <span class="caption" id="k-on-caption">Page 2 of 2</span>',
    );
    // An empty line has no mark.
    expect(THEME).toMatch(/\.glass > \.status:not\(\.empty\)::before,/);
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

    test('each page follows the glass rules, and the theme fixes the row height and the arrow column (REQ-CRM-LCD-002)', async () => {
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
      // The home: the first organisation is overdue, so its due line has
      // the mark. The list is in the band, out of the glass.
      const home = await get('/');
      const glass = divOf(home, 'glass');
      expect(checkGlass(glass)).toBe(1);
      expect(glass).not.toContain('Bravo');
      expect(divOf(home, 'lcd')).toBe('');
      checkGlass(divOf(await get('/account'), 'lcd'));
      const org = divOf(await get('/orgs/alpha'), 'lcd');
      expect(checkGlass(org)).toBe(1);

      // Each band row and each menu row has one fixed height. The arrow
      // shows in its own column, only on a hover or a focus, in one rule.
      // The mark does not blink with reduced motion.
      expect(THEME).toMatch(/\.menu li \{[^}]*height: var\(--row\);/);
      expect(THEME).toMatch(/\.chart :is\(th, td\) \{[^}]*height: 2\.2em;/);
      expect(THEME).toMatch(/\.chart tr \{[^}]*height: 3\.4em;/);
      expect(THEME.match(/\\25B6/g)).toHaveLength(1);
      expect(THEME).toMatch(
        /:is\(\s*\.menu a:is\(:hover, :focus-visible\),\s*\.chart tbody tr:is\(:hover, :focus-within\)\s*\)\s*\.arrow::before \{\s*content: "\\25B6";/,
      );
      // The legend of the menu names starts after the arrow column.
      expect(THEME).toMatch(
        /\.menu::before \{[^}]*padding-left: calc\(0\.75rem \+ var\(--arrow\)\);/,
      );
      expect(THEME).toMatch(
        /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.mark::before \{\s*animation: none;/,
      );
    });
  });
});
