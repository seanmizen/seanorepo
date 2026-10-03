import { describe, expect, test } from 'vitest';
import { runUntil } from '../src/engine.ts';
import { exportData, exportHtml } from '../src/export.ts';
import { call, makeRun } from './helpers.ts';

describe('qc export', () => {
  const script = {
    'bob@acme.example': {
      'fy1-q1-d1-t1': [
        call('write_file', { path: 'x.html', content: '</script><b>hi</b>' }),
      ],
    },
  };

  test('the data holds every turn, the actor of each seat, and every file version', async () => {
    const run = makeRun(script);
    await runUntil(run, 2);
    const d = exportData(run);
    expect(d.turns.map((t) => t.label)).toEqual([
      'fy1-q1-d1-t0',
      'fy1-q1-d1-t1',
      'fy1-q1-d1-t2',
    ]);
    expect(d.turns[1].actors).toHaveLength(d.seats.length);
    const writes = d.turns
      .flatMap((t) => t.events)
      .filter((e) => e.type === 'fs.write');
    for (const w of writes)
      if (w.type === 'fs.write') expect(d.objects[w.hash]).toBeDefined();
  });

  test('file content cannot close the data script tag', async () => {
    const run = makeRun(script);
    await runUntil(run, 1);
    const html = exportHtml(run);
    const data = html.slice(
      html.indexOf('id="qc-data">'),
      html.indexOf('</script>', html.indexOf('id="qc-data">')),
    );
    expect(data).not.toContain('</script');
    expect(data).toContain('\\u003c/script>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(exportHtml(run, { fragment: true }).startsWith('<title>')).toBe(
      true,
    );
  });
});
