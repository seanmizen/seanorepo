// A local open-weight model on one PC: offline mode, bad tool calls, one
// request at a time, and the time and token report. A fake
// openai-compatible server plays the model. No test makes a paid call.
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { checkOffline, isLoopback, OfflineError } from '../src/brains/net.ts';
import { runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import { costLines, costReport } from '../src/timeline.ts';
import { makeRun } from './helpers.ts';

const requests: Record<string, unknown>[] = [];
let replies: unknown[] = [];
let delayMs = 0;
let inFlight = 0;
let maxInFlight = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    requests.push(JSON.parse(raw));
    setTimeout(() => {
      inFlight -= 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(replies.shift() ?? stop('Done.')));
    }, delayMs);
  });
});
let port = 0;
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});
afterEach(() => {
  delete process.env.QC_OFFLINE;
  requests.length = 0;
  replies = [];
  delayMs = 0;
  maxInFlight = 0;
});

const usage = { prompt_tokens: 40, completion_tokens: 8 };
const stop = (content: string) => ({
  model: 'qwen-fake',
  usage,
  choices: [{ finish_reason: 'stop', message: { content } }],
});
const calls = (
  list: { id?: string; name?: unknown; arguments?: unknown }[],
  content: string | null = null,
) => ({
  model: 'qwen-fake',
  usage,
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content,
        tool_calls: list.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments },
        })),
      },
    },
  ],
});

/** The fixture with a `local` cast. `users` get the local model. */
const withLocal =
  (base: string, users: string[], extra = '') =>
  (dir: string) => {
    writeFileSync(
      join(dir, 'providers.yaml'),
      `ollama: { kind: openai-compatible, base_url: "${base}"${extra} }\nanthropic: { kind: anthropic }\n`,
    );
    writeFileSync(
      join(dir, 'actors.yaml'),
      [
        'actors:',
        '  scripted: { provider: script, script: scripts/test.yaml }',
        '  idle: { provider: idle }',
        '  qwen-local: { provider: ollama, model: "qwen3:8b", extra_body: { reasoning_effort: none } }',
        '  haiku: { provider: anthropic, model: claude-haiku-4-5 }',
        'tiers:',
        '  local: qwen-local',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'casts', 'local.yaml'),
      `default: idle\nrules:\n${users.map((u) => `  - match: { user: ${u} }\n    use: local\n`).join('')}`,
    );
    writeFileSync(
      join(dir, 'casts', 'cloud.yaml'),
      'default: idle\nrules:\n  - match: { user: bob@acme.example }\n    use: haiku\n',
    );
  };

const toolCallsOf = (events: JournalEvent[], seat: string) =>
  events.filter(
    (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
      e.type === 'tool.call' && e.seat === seat,
  );

describe('offline mode', () => {
  test('only loopback hosts count as local', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8080/v1',
      'http://127.1.2.3/v1',
      'http://[::1]:11434/v1',
      'http://ollama.localhost/v1',
    ])
      expect(isLoopback(url)).toBe(true);
    for (const url of [
      'https://api.anthropic.com',
      'http://192.168.1.20:11434/v1',
      'http://172.20.0.1:11434/v1',
      'http://localhost.example.com/v1',
      'http://127.0.0.1.example.com/v1',
      'not a url',
    ])
      expect(isLoopback(url)).toBe(false);
  });

  test('an unset QC_OFFLINE turns nothing on', () => {
    expect(() => checkOffline('x', 'https://api.anthropic.com')).not.toThrow();
    process.env.QC_OFFLINE = '0';
    expect(() => checkOffline('x', 'https://api.anthropic.com')).not.toThrow();
    process.env.QC_OFFLINE = '1';
    expect(() => checkOffline('x', 'https://api.anthropic.com')).toThrow(
      OfflineError,
    );
  });

  test('offline mode stops the run when a cast actor uses a host that is not local', async () => {
    process.env.QC_OFFLINE = '1';
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal('http://192.0.2.10:11434/v1', ['bob@acme.example']),
    );
    await expect(runUntil(run, 1)).rejects.toThrow(
      /Offline mode is on.*"ollama".*192\.0\.2\.10.*not local/,
    );
    expect(run.lastOrd()).toBe(0);

    const cloud = makeRun(
      {},
      'cloud',
      'c',
      withLocal(`http://127.0.0.1:${port}/v1`, []),
    );
    await expect(runUntil(cloud, 1)).rejects.toThrow(/api\.anthropic\.com/);
    expect(cloud.lastOrd()).toBe(0);
    expect(requests).toHaveLength(0);
  });

  test('offline mode lets a run use a model server on 127.0.0.1, with the actor extra_body', async () => {
    process.env.QC_OFFLINE = '1';
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal(`http://127.0.0.1:${port}/v1`, ['bob@acme.example']),
    );
    replies = [stop('Nothing to do.')];
    await runUntil(run, 1);
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('qwen3:8b');
    expect(requests[0].reasoning_effort).toBe('none');
  });
});

describe('tool calls from a local model', () => {
  test('a malformed tool call is a failed action in the journal, and the turn continues', async () => {
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal(`http://127.0.0.1:${port}/v1`, ['bob@acme.example']),
    );
    replies = [
      calls([
        { id: 'a', name: 'write_file', arguments: '{"path": "a.txt", ' },
        { id: 'b', name: 'make_coffee', arguments: '{}' },
        { name: '', arguments: '{}' },
        { id: 'd', name: 'write_file', arguments: '[1, 2]' },
      ]),
      // No native calls: the brain reads the Hermes form from the text.
      stop(
        '<think>I must save the note.</think>\n<tool_call>\n{"name": "write_file", "arguments": {"path": "note.txt", "content": "from text"}}\n</tool_call>',
      ),
      calls([
        {
          id: 'e',
          name: 'append_file',
          arguments: JSON.stringify(
            JSON.stringify({ path: 'note.txt', content: ' and more' }),
          ),
        },
      ]),
      stop('<think>Done.</think>I saved the note.'),
    ];
    await runUntil(run, 1);
    expect(requests).toHaveLength(4);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    const bob = toolCallsOf(t1, 'bob@acme.example');
    expect(bob.map((c) => [c.tool, c.ok])).toEqual([
      ['write_file', false],
      ['make_coffee', false],
      ['(no name)', false],
      ['write_file', false],
      ['write_file', true],
      ['append_file', true],
    ]);
    expect(bob[0].result).toContain('not valid JSON');
    expect(bob[1].result).toContain('does not exist');
    expect(bob[3].result).toContain('not a JSON object');
    expect(bob.slice(0, 4).every((c) => c.minutes === 0)).toBe(true);
    expect(run.load().vfs.exists('acme/acme-mf01', '/home/bob/a.txt')).toBe(
      false,
    );
    const end = t1.find(
      (e) => e.type === 'seat.end' && e.seat === 'bob@acme.example',
    );
    expect(end && 'note' in end && end.note).toBe('I saved the note.');
    // The model sees each error as the result of its own call.
    const second = requests[1].messages as { role: string; content: string }[];
    const results = second.filter((m) => m.role === 'tool');
    expect(results).toHaveLength(4);
    expect(results.every((m) => m.content.startsWith('ERROR:'))).toBe(true);
    // The text call goes back in the native form, with an id.
    const third = requests[2].messages as {
      role: string;
      tool_calls?: { id: string; function: { name: string } }[];
    }[];
    const asked = third.filter((m) => m.role === 'assistant').at(-1);
    expect(asked?.tool_calls?.[0]).toMatchObject({
      id: 'text_1_0',
      function: { name: 'write_file' },
    });
  });

  test('an unreadable tool call in the text is a failed action', async () => {
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal(`http://127.0.0.1:${port}/v1`, ['bob@acme.example']),
    );
    replies = [stop('<tool_call>{"name": "ls", "arguments": {</tool_call>')];
    await runUntil(run, 1);
    const bob = toolCallsOf(run.readTurn('fy1-q1-d1-t1'), 'bob@acme.example');
    expect(bob).toHaveLength(1);
    expect(bob[0]).toMatchObject({ tool: '(unreadable)', ok: false });
  });
});

describe('one local model for every seat', () => {
  test('with concurrency 1, the seats wait in turn for the model server', async () => {
    const seats = [
      'alice@acme.example',
      'bob@acme.example',
      'carol@acme.example',
    ];
    const one = makeRun(
      {},
      'local',
      'one',
      withLocal(`http://127.0.0.1:${port}/v1`, seats, ', concurrency: 1'),
    );
    delayMs = 40;
    await runUntil(one, 1);
    expect(requests).toHaveLength(3);
    expect(maxInFlight).toBe(1);

    // With no limit, the engine sends the requests at the same time.
    requests.length = 0;
    maxInFlight = 0;
    const many = makeRun(
      {},
      'local',
      'many',
      withLocal(`http://127.0.0.1:${port}/v1`, seats),
    );
    await runUntil(many, 1);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test('the time of a model call does not count the wait for its slot', async () => {
    const seats = [
      'alice@acme.example',
      'bob@acme.example',
      'carol@acme.example',
    ];
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal(`http://127.0.0.1:${port}/v1`, seats, ', concurrency: 1'),
    );
    delayMs = 100;
    await runUntil(run, 1);
    const ms = run
      .readTurn(run.turns().at(-1) as string)
      .filter((e) => e.type === 'model.call')
      .map((e) => (e as { ms: number }).ms);
    expect(ms).toHaveLength(3);
    // The third request waits about 200 ms for its slot. Its time is still
    // about 100 ms.
    for (const t of ms) {
      expect(t).toBeGreaterThanOrEqual(90);
      expect(t).toBeLessThan(190);
    }
  });

  test('a request with no reply in timeout_s is a model error, and the run continues', async () => {
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal(
        `http://127.0.0.1:${port}/v1`,
        ['bob@acme.example'],
        ', timeout_s: 0.05',
      ),
    );
    delayMs = 300;
    const [report] = await runUntil(run, 1);
    expect(report.label).toBe('fy1-q1-d1-t1');
    const err = run
      .readTurn('fy1-q1-d1-t1')
      .find((e) => e.type === 'model.error');
    expect(err && err.type === 'model.error' && err.message).toContain(
      'timeout_s',
    );
  });

  test('the cost report shows request seconds and tokens by turn and by role, at zero cost', async () => {
    const run = makeRun(
      {},
      'local',
      'r',
      withLocal(`http://127.0.0.1:${port}/v1`, [
        'alice@acme.example',
        'bob@acme.example',
      ]),
    );
    delayMs = 20;
    const reports = await runUntil(run, 2);
    expect(reports.every((r) => r.ms > 0)).toBe(true);
    const byTurn = costReport(run, 'turn');
    expect(byTurn.map((r) => r.key)).toEqual(['fy1-q1-d1-t1', 'fy1-q1-d1-t2']);
    expect(byTurn[0]).toMatchObject({
      calls: 2,
      inputTokens: 80,
      outputTokens: 16,
      costUsd: 0,
    });
    expect(byTurn[0].seconds).toBeGreaterThan(0);
    const byRole = costReport(run, 'role');
    expect(byRole.map((r) => r.key).sort()).toEqual(['finance', 'it-admin']);
    const lines = costLines(byRole, 'role');
    expect(lines[0]).toMatch(/role.*calls.*in.*out.*seconds.*USD/);
    expect(lines.at(-1)).toMatch(/^total\s+4\s+160\s+32\s+\d+\.\d\s+0\.0000$/);
  });
});
