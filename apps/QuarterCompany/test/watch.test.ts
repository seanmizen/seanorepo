// qc run --watch (REQ-QC-035): the live stream of a turn, and the server of
// the live viewer. A fake openai-compatible server plays the model. It
// streams when the request asks for a stream. No test makes a paid call.
import { writeFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { StreamReader } from '../src/brains/openai.ts';
import { runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import type { LiveEvent } from '../src/live.ts';
import { startWatch } from '../src/watch.ts';
import { makeRun } from './helpers.ts';

interface Reply {
  content?: string;
  reasoning?: string;
  tool?: { name: string; arguments: string };
}

const requests: Record<string, unknown>[] = [];
let replies: Reply[] = [];
const usage = { prompt_tokens: 40, completion_tokens: 8 };

const halves = (s: string) => [
  s.slice(0, Math.ceil(s.length / 2)),
  s.slice(Math.ceil(s.length / 2)),
];

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    const body = JSON.parse(raw);
    requests.push(body);
    const r = replies.shift() ?? { content: 'Done.' };
    const calls = r.tool
      ? [
          {
            id: 'c1',
            type: 'function',
            function: { name: r.tool.name, arguments: r.tool.arguments },
          },
        ]
      : undefined;
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'qwen-fake',
          usage,
          choices: [
            {
              finish_reason: calls ? 'tool_calls' : 'stop',
              message: { content: r.content ?? null, tool_calls: calls },
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: unknown, finish: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ model: 'qwen-fake', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    if (r.reasoning) chunk({ reasoning: r.reasoning });
    for (const part of r.content ? halves(r.content) : [])
      chunk({ content: part });
    if (r.tool) {
      const [a, b] = halves(r.tool.arguments);
      chunk({
        tool_calls: [
          { index: 0, id: 'c1', function: { name: r.tool.name, arguments: a } },
        ],
      });
      chunk({ tool_calls: [{ index: 0, function: { arguments: b } }] });
    }
    chunk({}, r.tool ? 'tool_calls' : 'stop');
    res.write(
      `data: ${JSON.stringify({ model: 'qwen-fake', choices: [], usage })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
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
  requests.length = 0;
  replies = [];
});

/** The fixture with a `local` cast for bob. */
const withLocal = (dir: string) => {
  writeFileSync(
    join(dir, 'providers.yaml'),
    `ollama: { kind: openai-compatible, base_url: "http://127.0.0.1:${port}/v1" }\n`,
  );
  writeFileSync(
    join(dir, 'actors.yaml'),
    [
      'actors:',
      '  idle: { provider: idle }',
      '  qwen-local: { provider: ollama, model: "qwen-fake" }',
      'tiers:',
      '  local: qwen-local',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'casts', 'local.yaml'),
    'default: idle\nrules:\n  - match: { user: bob@acme.example }\n    use: local\n',
  );
};

const script = (): Reply[] => [
  {
    reasoning: 'A note first.',
    content: 'I write the note.',
    tool: {
      name: 'write_file',
      arguments: JSON.stringify({ path: 'note.txt', content: 'hello' }),
    },
  },
  { content: 'All done for now.' },
];

/** Journal events of a run, without the model calls: their request has `stream`. */
const journal = (events: JournalEvent[]) =>
  events.filter((e) => e.type !== 'model.call');

/** Read a GET response until `until` is true or the response ends. */
const getText = (url: string, until: (text: string) => boolean) =>
  new Promise<{ status: number; type: string; text: string }>(
    (resolve, reject) => {
      const req = get(url, (res) => {
        let text = '';
        res.setEncoding('utf8');
        const done = () => {
          req.destroy();
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type']),
            text,
          });
        };
        res.on('data', (c: string) => {
          text += c;
          if (until(text)) done();
        });
        res.on('end', done);
      });
      req.on('error', reject);
    },
  );

describe('the streamed reply of an openai-compatible server', () => {
  test('the chunks of a stream build the same reply as one full reply', () => {
    const parts: [string, string][] = [];
    const r = new StreamReader((kind, text) => parts.push([kind, text]));
    r.add({ model: 'm', choices: [{ delta: { reasoning: 'Hmm.' } }] });
    r.add({ choices: [{ delta: { content: 'I ' } }] });
    r.add({ choices: [{ delta: { content: 'act.' } }] });
    r.add({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'x',
                function: { name: 'ls', arguments: '{"pa' },
              },
            ],
          },
        },
      ],
    });
    r.add({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: 'th":"/"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    r.add({ choices: [], usage });
    expect(r.response()).toEqual({
      model: 'm',
      usage,
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'I act.',
            tool_calls: [
              {
                id: 'x',
                type: 'function',
                function: { name: 'ls', arguments: '{"path":"/"}' },
              },
            ],
          },
        },
      ],
    });
    expect(parts).toEqual([
      ['reasoning', 'Hmm.'],
      ['content', 'I '],
      ['content', 'act.'],
      ['tool', '\n'],
      ['tool', 'ls '],
      ['tool', '{"pa'],
      ['tool', 'th":"/"}'],
    ]);
  });
});

describe('qc run --watch', () => {
  test('the live stream shows the model text and each tool call, and the journal is the same as a run without it', async () => {
    const plain = makeRun({}, 'local', 'plain', withLocal);
    replies = script();
    await runUntil(plain, 1);
    expect(requests.every((r) => r.stream === undefined)).toBe(true);
    requests.length = 0;

    const watched = makeRun({}, 'local', 'watched', withLocal);
    const watch = await startWatch(watched, 0);
    const seen: LiveEvent[] = [];
    replies = script();
    try {
      await runUntil(watched, 1, undefined, (e) => {
        seen.push(e);
        watch.live(e);
      });
    } finally {
      await watch.close();
    }
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.stream === true)).toBe(true);

    const bob = 'bob@acme.example';
    const text = (kind: string) =>
      seen
        .filter((e) => e.type === 'text' && e.seat === bob && e.kind === kind)
        .map((e) => (e as { text: string }).text)
        .join('');
    expect(text('reasoning')).toBe('A note first.');
    expect(text('content')).toBe('I write the note.All done for now.');
    expect(text('tool')).toContain('write_file');
    expect(seen.map((e) => e.type)).toEqual(
      expect.arrayContaining(['turn.begin', 'seat.begin', 'tool', 'seat.end']),
    );
    expect(seen[0]).toMatchObject({
      type: 'turn.begin',
      label: 'fy1-q1-d1-t1',
    });
    expect(seen.at(-1)).toEqual({ type: 'turn.end', label: 'fy1-q1-d1-t1' });
    expect(seen.find((e) => e.type === 'tool')).toMatchObject({
      seat: bob,
      tool: 'write_file',
      ok: true,
    });

    const [label] = plain.turns().slice(-1);
    expect(journal(watched.readTurn(label))).toEqual(
      journal(plain.readTurn(label)),
    );
    // The journal records the reply in the same form, also from a stream.
    const calls = (run: typeof plain) =>
      run
        .readTurn(label)
        .filter((e) => e.type === 'model.call')
        .map((e) =>
          JSON.parse(run.objects.get((e as { response: string }).response)),
        );
    expect(calls(watched)).toEqual(calls(plain));
  });

  test('a page that opens during a turn gets the turn so far, and the turns come from the journal', async () => {
    const run = makeRun({}, 'local', 'r', withLocal);
    const watch = await startWatch(run, 0);
    try {
      watch.live({
        type: 'turn.begin',
        label: 'fy1-q1-d1-t1',
        clock: 'Mon 09:00',
        seats: [{ seat: 'bob@acme.example', actor: 'qwen-local' }],
      });
      watch.live({
        type: 'text',
        seat: 'bob@acme.example',
        kind: 'content',
        text: 'Halfway through a sen',
      });
      const live = await getText(`${watch.url}api/live`, (t) =>
        t.includes('Halfway'),
      );
      expect(live.type).toContain('text/event-stream');
      expect(live.text).toContain('"type":"turn.begin"');
      expect(live.text).toContain('Halfway through a sen');

      const turns = await getText(
        `${watch.url}api/turns?after=-1`,
        () => false,
      );
      const data = JSON.parse(turns.text);
      expect(data.turns.map((t: { ord: number }) => t.ord)).toEqual([0]);
      expect(data.seats.map((s: { id: string }) => s.id)).toContain(
        'bob@acme.example',
      );
      const none = await getText(`${watch.url}api/turns?after=0`, () => false);
      expect(JSON.parse(none.text).turns).toEqual([]);

      const page = await getText(watch.url, () => false);
      expect(page.type).toContain('text/html');
      expect(page.text).toContain('"live":true');

      const missing = await getText(`${watch.url}api/nothing`, () => false);
      expect(missing.status).toBe(404);
    } finally {
      await watch.close();
    }
  });
});
