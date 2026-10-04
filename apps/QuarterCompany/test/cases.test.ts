import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, test } from 'vitest';
import { stringify } from 'yaml';
import { scriptCalls } from '../src/brains/index.ts';
import { genesis, runTurn, runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import { Run } from '../src/run.ts';
import { seatOfMember } from '../src/scenario.ts';
import { Session } from '../src/session.ts';
import { DEFAULT_CALENDAR, ordOf } from '../src/time.ts';
import { CASE_TOOLS, parseCase } from '../src/tools/cases.ts';
import { toolsFor } from '../src/tools/index.ts';
import { Directory } from '../src/users.ts';
import { call, makeRun, type Script } from './helpers.ts';

const ACME = 'acme/acme-mf01';
const HERE = dirname(fileURLToPath(import.meta.url));
const QC = join(HERE, '..', 'bin', 'qc.js');
const RECALL = join(
  HERE,
  '..',
  '..',
  '..',
  'projects',
  'agentic-workflows',
  'scenario-recall',
);

const toolCalls = (events: JournalEvent[], tool?: string) =>
  events.filter(
    (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
      e.type === 'tool.call' && (!tool || e.tool === tool),
  );

/**
 * The fixture, with a case system on acme-mf01, a support role mailbox and
 * a small population that writes to support@ in turn 1.
 */
const withCases =
  (p = 1) =>
  (dir: string) => {
    const s = join(dir, 'scenario.yaml');
    writeFileSync(
      s,
      readFileSync(s, 'utf8').replace(
        'orgs: [acme, globex]',
        'orgs: [acme, globex, postbox, owners]',
      ),
    );
    const acme = join(dir, 'orgs', 'acme.yaml');
    writeFileSync(
      acme,
      readFileSync(acme, 'utf8')
        .replace(
          'groups: [finance]',
          'groups: [finance, support]\nmailboxes: [support]',
        )
        .replace(
          'role: finance, title: Accountant, groups: [finance] }',
          'role: finance, title: Accountant, groups: [finance, support] }',
        )
        .replace(
          'files:\n',
          `files:
  - { path: /srv/cases, dir: true, owner: root, group: support, mode: "770" }
  - { path: /srv/cases/open, dir: true, owner: root, group: support, mode: "770" }
  - { path: /srv/cases/closed, dir: true, owner: root, group: support, mode: "770" }
  - { path: /srv/cases/config, owner: root, group: support, mode: "640", content: "intake: support\\n" }
`,
        ),
    );
    writeFileSync(
      join(dir, 'orgs', 'postbox.yaml'),
      'kind: provider\nname: Postbox Mail\ndomain: postbox.example\nhost: pb01\n',
    );
    writeFileSync(
      join(dir, 'orgs', 'owners.yaml'),
      stringify({
        kind: 'population',
        name: 'Kettle owners',
        provider: 'postbox',
        members: {
          size: 3,
          seed: 5,
          traits: [{ key: 'owns', value: 'kettle', share: 1 }],
        },
        behaviour: [
          {
            id: 'recall',
            from: 'fy1-q1-d1-t1',
            who: { owns: 'kettle' },
            p,
            write: {
              to: 'support@acme.example',
              subject: 'Recall: my {owns}',
              body: 'Please refund my {owns}.\n\n{name}',
            },
            chase: {
              after: '2t',
              subject: 'Re: Recall: my {owns}',
              body: 'No reply yet.\n\n{first}',
            },
          },
        ],
      }),
    );
  };

const runWith = (script: Script, p = 1) =>
  makeRun(script, 'scripted', 'r', withCases(p));

const openCases = (run: Run) =>
  run
    .load()
    .vfs.children(ACME, '/srv/cases/open')
    .map((k) => parseCase(run.objects.get(k.node.hash as string)).head);

describe('case system', () => {
  test('a case system is a tool group over files in /srv/cases, with minute costs', async () => {
    const run = runWith({
      'bob@acme.example': {
        'fy1-q1-d1-t2': [
          call('case_intake'),
          call('case_list'),
          call('case_assign', { to: 'bob', count: 3 }),
          call('case_close', {
            resolution: 'refund sent',
            reply: 'Your refund is on its way.',
          }),
        ],
      },
    });
    await runUntil(run, 2);
    const events = run.readTurn('fy1-q1-d1-t2');
    const calls = toolCalls(events).filter(
      (e) => e.seat === 'bob@acme.example',
    );
    expect(calls.map((c) => [c.tool, c.ok, c.minutes])).toEqual([
      ['case_intake', true, 2], // 1 minute, plus 1 for each 10 messages
      ['case_list', true, 1],
      ['case_assign', true, 1],
      ['case_close', true, 5], // reading the case 2, writing the reply 3
    ]);
    expect(calls[1].result).toMatch(
      /^Open cases: 3\. Unassigned: 3\. Yours: 0\./,
    );
    // Two cases stay open with bob. One is closed, as a file in closed/.
    const open = openCases(run);
    expect(open).toHaveLength(2);
    expect(open.every((c) => c.assignee === 'bob')).toBe(true);
    const state = run.load();
    const closed = state.vfs.children(ACME, '/srv/cases/closed');
    expect(closed).toHaveLength(1);
    const text = run.objects.get(closed[0].node.hash as string);
    expect(text).toMatch(/^Status: closed$/m);
    expect(text).toContain('closed by bob');
    // The intake mail moved to cur/ in the role mailbox.
    expect(state.vfs.children(ACME, '/var/mail/support/new')).toHaveLength(0);
    expect(state.vfs.children(ACME, '/var/mail/support/cur')).toHaveLength(3);
  });

  test('a reply goes from the intake address, and the customer counts as answered', async () => {
    const run = runWith({
      'bob@acme.example': {
        'fy1-q1-d1-t2': [
          call('case_intake'),
          call('case_assign', { to: 'bob', count: 3 }),
          call('case_close', { resolution: 'done', reply: 'Refund sent.' }),
        ],
      },
    });
    await runUntil(run, 3);
    const state = run.load();
    const sent = state.vfs.children(ACME, '/var/mail/support/sent');
    expect(sent).toHaveLength(1);
    const reply = run.objects.get(sent[0].node.hash as string);
    expect(reply).toMatch(/^From: support@acme\.example$/m);
    expect(reply).toMatch(/^Subject: Re: Recall: my kettle$/m);
    expect(reply).toContain('Bob Books\nAcme Ltd customer service');
    const customer = reply.match(/^To: (\S+)@postbox\.example$/m)?.[1];
    expect(customer).toBeDefined();
    expect(
      state.vfs.children('postbox/pb01', `/var/mail/${customer}/new`),
    ).toHaveLength(1);
    // The population's next turn sees the reply from acme.example.
    const answered = run
      .readTurn('fy1-q1-d1-t3')
      .find((e) => e.type === 'population.step' && e.stage === 'answered');
    expect(answered && 'users' in answered && answered.users).toEqual([
      customer,
    ]);
  });

  test('a chase goes into the open case of the same customer', async () => {
    const run = runWith({
      'bob@acme.example': {
        'fy1-q1-d1-t2': [call('case_intake')],
        'fy1-q1-d1-t4': [call('case_intake')],
      },
    });
    await runUntil(run, 4);
    const open = openCases(run);
    expect(open).toHaveLength(3);
    expect(open.every((c) => c.messages === 2)).toBe(true);
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t4'), 'case_intake')[0].result,
    ).toMatch(/0 new cases, 3 messages added to open cases/);
  });

  test('only the case group can use the case system, and only a host with one shows the tools', async () => {
    const run = runWith({
      'carol@acme.example': { 'fy1-q1-d1-t2': [call('case_list')] },
      'bob@acme.example': {
        'fy1-q1-d1-t2': [
          call('case_intake'),
          call('case_assign', { to: 'carol', count: 1 }),
        ],
      },
    });
    await runUntil(run, 2);
    const calls = toolCalls(run.readTurn('fy1-q1-d1-t2'));
    const carol = calls.find((c) => c.seat === 'carol@acme.example');
    expect(carol?.ok).toBe(false);
    expect(carol?.result).toBe('/srv/cases: Permission denied');
    const assign = calls.find((c) => c.tool === 'case_assign');
    expect(assign?.ok).toBe(false);
    expect(assign?.result).toMatch(/carol cannot use the case system/);

    const state = run.load();
    const session = (seat: string) =>
      new Session(
        seatOfMember(run.scenario, seat, state.people.get(seat) as never),
        run.scenario,
        'fy1-q1-d1-t3',
        3,
        state.vfs.clone(),
        run.objects,
      );
    const names = (seat: string) =>
      session(seat)
        .tools()
        .map((t) => t.name);
    expect(names('bob@acme.example')).toContain('case_intake');
    expect(names('gina@globex.example')).not.toContain('case_intake');
  });

  test('a role mailbox is an account that takes mail, with no person', async () => {
    const run = runWith({});
    const state = run.load();
    const dir = Directory.load(state.vfs, run.objects, ACME);
    expect(dir.account('support')?.shell).toBe('/bin/false');
    expect(state.people.has('support@acme.example')).toBe(false);
    await runUntil(run, 1);
    expect(run.load().vfs.children(ACME, '/var/mail/support/new')).toHaveLength(
      3,
    );
  });

  test('the case MCP server serves the registry definitions, and the engine replays its calls', async () => {
    const run = runWith({}, 1);
    await runUntil(run, 1);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [QC, 'mcp-cases', 'r', '--seat', 'bob@acme.example'],
      env: { ...process.env, QC_RUNS: dirname(run.dir) } as Record<
        string,
        string
      >,
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        ['briefing', ...CASE_TOOLS.map((t) => t.name)].sort(),
      );
      const intake = CASE_TOOLS.find((t) => t.name === 'case_intake');
      expect(tools.find((t) => t.name === 'case_intake')?.description).toBe(
        intake?.description,
      );
      const r = (await client.callTool({
        name: 'case_intake',
        arguments: {},
      })) as {
        content: { text: string }[];
      };
      expect(r.content[0].text).toMatch(
        /^Took 3 messages from support: 3 new cases/,
      );
    } finally {
      await client.close();
    }
    // Cast bob to the external actor: the engine replays the pending call.
    run.info.pendingCastRules = [
      { match: { user: 'bob@acme.example' }, use: 'external' } as never,
    ];
    run.saveInfo();
    await runTurn(run, run.load());
    const replayed = toolCalls(run.readTurn('fy1-q1-d1-t2'), 'case_intake');
    expect(replayed[0].result).toMatch(
      /^Took 3 messages from support: 3 new cases/,
    );
    expect(openCases(run)).toHaveLength(3);
  }, 30_000);

  test('every case tool has a minute cost and one definition', () => {
    const listed = toolsFor(false, 'company', true).filter(
      (t) => t.server === 'cases',
    );
    expect(listed).toEqual(CASE_TOOLS);
    expect(
      toolsFor(false, 'company', false).some((t) => t.server === 'cases'),
    ).toBe(false);
  });
});

describe('scripts', () => {
  test('a range runs in each turn of the range, and a turn label beats it', () => {
    const a = [call('case_list')];
    const b = [call('case_intake')];
    const c = [call('whoami')];
    const bySeat = {
      'fy1-q1-d1-t2..fy1-q1-d2-t1': a,
      'fy1-q1-d1-t4': b,
      'fy1-q1-d1-t30..fy1-q1-d1-t31': c,
    };
    const at = (l: string) => scriptCalls(bySeat as never, l, DEFAULT_CALENDAR);
    expect(at('fy1-q1-d1-t1')).toEqual([]);
    expect(at('fy1-q1-d1-t2')).toBe(a);
    expect(at('fy1-q1-d1-t4')).toBe(b);
    expect(at('fy1-q1-d1-t31')).toBe(c); // the later range wins
    expect(at('fy1-q1-d2-t1')).toBe(a);
    expect(at('fy1-q1-d2-t2')).toEqual([]);
  });
});

describe('the recall scenario', () => {
  test('the backlog grows faster than the staff clear it, and the company hires: all scripted, no model', async () => {
    const run = Run.init({
      name: 'recall',
      scenarioDir: RECALL,
      cast: 'scripted',
      runsDir: join(mkdtempSync(join(tmpdir(), 'qc-recall-')), 'runs'),
    });
    const state = genesis(run);
    const counts = new Map<string, number>();
    while (state.ord < ordOf('fy1-q1-d2-t12', run.scenario.calendar)) {
      const r = await runTurn(run, state);
      counts.set(
        r.label,
        state.vfs.children('halden/hh-srv01', '/srv/cases/open').length,
      );
    }
    const at = (l: string) => counts.get(l) ?? -1;
    // Day 1: the backlog grows all day.
    expect(at('fy1-q1-d1-t8')).toBeGreaterThan(100);
    expect(at('fy1-q1-d1-t32')).toBeGreaterThan(at('fy1-q1-d1-t16'));
    expect(at('fy1-q1-d1-t32')).toBeGreaterThan(400);
    // The company reacts inside the world: an agency and a consultancy place people.
    const events = run.turns().flatMap((l) => run.readTurn(l));
    const joins = events.filter(
      (e): e is Extract<JournalEvent, { type: 'person.join' }> =>
        e.type === 'person.join' && e.via !== 'scenario',
    );
    expect(joins.map((j) => `${j.seat} via ${j.via}`).sort()).toEqual([
      'connor@haldenhome.example via marcus@staffline.example',
      'ines@northgate.example via helen@northgate.example',
      'mei@northgate.example via helen@northgate.example',
      'tobias@northgate.example via helen@northgate.example',
      'zara@haldenhome.example via marcus@staffline.example',
    ]);
    // With the new staff, the backlog falls on day 2.
    expect(at('fy1-q1-d2-t12')).toBeLessThan(at('fy1-q1-d2-t4'));
    const closers = new Set(
      toolCalls(run.readTurn('fy1-q1-d2-t10'), 'case_close')
        .filter((c) => c.ok)
        .map((c) => c.seat),
    );
    expect(closers).toContain('zara@haldenhome.example');
    expect(closers).toContain('mei@northgate.example');
    // The story is free.
    expect(events.some((e) => e.type === 'model.call')).toBe(false);
  }, 120_000);
});
