import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runUntil } from '../src/engine.ts';
import { workerSession } from '../src/mcp/worker.ts';
import { call, makeRun, tree } from './helpers.ts';

const SECRET = 'I think the ledger is wrong, but I will not say so.';

describe('private thoughts', () => {
  test('a thought never enters the world, and root cannot find it', async () => {
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [call('think_privately', { thought: SECRET })],
      },
    });
    await runUntil(run, 1);
    const world = tree(join(run.dir, 'world'));
    expect(Object.values(world).some((text) => text.includes(SECRET))).toBe(
      false,
    );
    const state = run.load();
    for (const host of state.vfs.hosts()) {
      for (const { node } of state.vfs.entries(host)) {
        if (node.hash) expect(run.objects.get(node.hash)).not.toContain(SECRET);
      }
    }
    expect(state.thoughts.get('bob@acme.example')).toEqual([
      { label: 'fy1-q1-d1-t1', text: SECRET },
    ]);
  });

  test('the engine writes minds/<seat>.md outside world/', async () => {
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [call('think_privately', { thought: SECRET })],
      },
    });
    await runUntil(run, 1);
    const mind = join(run.dir, 'minds', 'bob@acme.example.md');
    expect(existsSync(mind)).toBe(true);
    expect(readFileSync(mind, 'utf8')).toContain(SECRET);
  });

  test('the next briefing recalls the thought', async () => {
    const run = makeRun({}, 'external-alice');
    const w = workerSession(run, 'alice@acme.example');
    const r = await w.call('think_privately', { thought: SECRET });
    expect(r.ok).toBe(true);
    await runUntil(run, 1);
    const brief = await w.brief();
    expect(brief).toContain('Your recent private thoughts:');
    expect(brief).toContain(SECRET);
  });
});
