import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runUntil } from '../src/engine.ts';
import { costReport } from '../src/timeline.ts';
import { makeRun } from './helpers.ts';

// A fake model service. Each request gets the next canned reply.
const requests: { path: string; body: Record<string, unknown> }[] = [];
let replies: unknown[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    requests.push({
      path: new URL(req.url).pathname,
      body: (await req.json()) as Record<string, unknown>,
    });
    return Response.json(replies.shift());
  },
});
afterAll(() => server.stop());

const withProvider = (kind: string, base: string) => (dir: string) => {
  writeFileSync(
    join(dir, 'providers.yaml'),
    `fake: { kind: ${kind}, base_url: "${base}", key_env: QC_FAKE_KEY }\n`,
  );
  writeFileSync(
    join(dir, 'actors.yaml'),
    `actors:\n  scripted: { provider: script, script: scripts/test.yaml }\n  idle: { provider: idle }\n  model: { provider: fake, model: fake-1, price: { in: 1, out: 10 } }\n`,
  );
  writeFileSync(
    join(dir, 'casts', 'one.yaml'),
    'default: idle\nrules:\n  - match: { user: bob@acme.example }\n    use: model\n',
  );
};

process.env.QC_FAKE_KEY = 'test-key';

describe('anthropic brain', () => {
  test('runs the tool loop, records each call, and ends the turn with the note', async () => {
    requests.length = 0;
    const usage = {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    replies = [
      {
        id: 'm1',
        type: 'message',
        role: 'assistant',
        model: 'fake-1',
        stop_reason: 'tool_use',
        usage,
        content: [{ type: 'tool_use', id: 'tu1', name: 'whoami', input: {} }],
      },
      {
        id: 'm2',
        type: 'message',
        role: 'assistant',
        model: 'fake-1',
        stop_reason: 'tool_use',
        usage,
        content: [
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'end_turn',
            input: { note: 'checked who I am', wake: 'on_mail' },
          },
        ],
      },
    ];
    const run = makeRun(
      {},
      'one',
      'r',
      withProvider('anthropic', `http://localhost:${server.port}`),
    );
    await runUntil(run, 1);
    expect(requests.map((r) => r.path)).toEqual([
      '/v1/messages',
      '/v1/messages',
    ]);
    const tools = requests[0].body.tools as { name: string }[];
    expect(tools.map((t) => t.name)).toContain('send_mail');
    expect(tools.map((t) => t.name)).not.toContain('useradd');
    const second = requests[1].body.messages as {
      role: string;
      content: unknown;
    }[];
    expect(JSON.stringify(second[2])).toContain('user: bob');
    const events = run.readTurn('fy1-q1-d1-t1');
    const end = events.find(
      (e) => e.type === 'seat.end' && e.seat === 'bob@acme.example',
    );
    expect(end && 'note' in end && end.note).toBe('checked who I am');
    const [row] = costReport(run, 'actor');
    expect(row).toEqual({
      key: 'model',
      calls: 2,
      inputTokens: 200,
      outputTokens: 40,
      costUsd: (200 * 1 + 40 * 10) / 1e6,
    });
  });
});

describe('openai-compatible brain', () => {
  test('runs the tool loop against /chat/completions', async () => {
    requests.length = 0;
    const usage = { prompt_tokens: 50, completion_tokens: 5 };
    replies = [
      {
        model: 'fake-1',
        usage,
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"hello.txt","content":"hi"}',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        model: 'fake-1',
        usage,
        choices: [
          { finish_reason: 'stop', message: { content: 'Done for now.' } },
        ],
      },
    ];
    const run = makeRun(
      {},
      'one',
      'r',
      withProvider('openai-compatible', `http://localhost:${server.port}/v1`),
    );
    await runUntil(run, 1);
    expect(requests.map((r) => r.path)).toEqual([
      '/v1/chat/completions',
      '/v1/chat/completions',
    ]);
    expect(run.load().vfs.exists('acme/acme-mf01', '/home/bob/hello.txt')).toBe(
      true,
    );
    const end = run
      .readTurn('fy1-q1-d1-t1')
      .find((e) => e.type === 'seat.end' && e.seat === 'bob@acme.example');
    expect(end && 'note' in end && end.note).toBe('Done for now.');
  });
});
