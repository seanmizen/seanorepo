// qc-director: an MCP server for the person who runs the simulation. It runs
// turns, plays them back, injects events and recasts seats. Workers never
// get this server. See REQ-QC-010.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Rule } from '../cast.ts';
import { runUntil } from '../engine.ts';
import { Run } from '../run.ts';
import { labelOf, ordOf } from '../time.ts';
import { costReport, playback, retake, statusLines } from '../timeline.ts';
import { normalize } from '../vfs.ts';

const text = (t: string, isError = false) => ({
  content: [{ type: 'text' as const, text: t }],
  isError,
});
const OUTPUT_LIMIT = 20000;
const clip = (s: string) =>
  s.length > OUTPUT_LIMIT
    ? `${s.slice(0, OUTPUT_LIMIT)}\n… (output cut at ${OUTPUT_LIMIT} characters)`
    : s;

const guard =
  <A>(fn: (a: A) => Promise<string> | string) =>
  async (a: A) => {
    try {
      return text(clip(await fn(a)));
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), true);
    }
  };

export async function serveDirector(initial: Run) {
  let run = initial;
  const reopen = () => {
    run = new Run(run.dir);
    return run;
  };
  const server = new McpServer({
    name: `qc-director-${run.info.name}`,
    version: '0.1.0',
  });

  server.registerTool(
    'status',
    {
      description:
        'Show the last turn, the next turn, and the actor that plays each seat.',
    },
    guard(() => statusLines(reopen()).join('\n')),
  );

  server.registerTool(
    'run_turns',
    {
      description:
        'Run turns with the models. This costs money when the cast uses paid models.',
      inputSchema: { turns: z.number().int().min(1).max(64).default(1) },
    },
    guard(async ({ turns }: { turns: number }) => {
      const r = reopen();
      const lines: string[] = [];
      await runUntil(r, r.lastOrd() + turns, (l) => lines.push(l));
      return lines.join('\n');
    }),
  );

  server.registerTool(
    'playback',
    {
      description:
        'Show turns that happened, from the journal. This makes no model calls.',
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        seat: z.string().optional(),
        verbose: z.boolean().default(false),
      },
    },
    guard(
      (a: { from?: string; to?: string; seat?: string; verbose: boolean }) =>
        [...playback(reopen(), a)].join('\n'),
    ),
  );

  server.registerTool(
    'read_world',
    {
      description:
        'Read a file or list a folder in the world at the last turn. The director has no permission limits.',
      inputSchema: { company: z.string(), path: z.string() },
    },
    guard(({ company, path }: { company: string; path: string }) => {
      const r = reopen();
      const c = r.scenario.companies.find((x) => x.id === company);
      if (!c) throw new Error(`Company "${company}" does not exist.`);
      const host = `${c.id}/${c.host}`;
      const state = r.load();
      const p = normalize(path);
      const node = state.vfs.get(host, p);
      if (!node) throw new Error(`${p}: No such file or directory`);
      if (node.kind === 'dir')
        return state.vfs
          .children(host, p)
          .map((k) => `${k.name}${k.node.kind === 'dir' ? '/' : ''}`)
          .join('\n');
      return r.objects.get(node.hash as string);
    }),
  );

  server.registerTool(
    'inject_mail',
    {
      description:
        'Schedule an email into the world. Without "at", it arrives at the start of the next turn.',
      inputSchema: {
        at: z.string().optional(),
        from: z.string(),
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      },
    },
    guard(
      (a: {
        at?: string;
        from: string;
        to: string;
        subject: string;
        body: string;
      }) => {
        const r = reopen();
        const cal = r.scenario.calendar;
        const at = a.at ?? labelOf(r.lastOrd() + 1, cal);
        if (ordOf(at, cal) <= r.lastOrd())
          throw new Error(`Turn ${at} has happened. Give a later turn.`);
        r.info.injects.push({
          at,
          mail: { from: a.from, to: a.to, subject: a.subject, body: a.body },
        });
        r.saveInfo();
        return `Mail is scheduled for ${at}.`;
      },
    ),
  );

  server.registerTool(
    'recast',
    {
      description:
        'Give seats to a different actor or tier, from the next turn. Match by user, company or role.',
      inputSchema: {
        use: z.string(),
        user: z.string().optional(),
        company: z.string().optional(),
        role: z.string().optional(),
        from: z.string().optional(),
        until: z.string().optional(),
      },
    },
    guard(
      (a: {
        use: string;
        user?: string;
        company?: string;
        role?: string;
        from?: string;
        until?: string;
      }) => {
        const r = reopen();
        const rule = Rule.parse({
          match: { user: a.user, company: a.company, role: a.role },
          use: a.use,
          from: a.from,
          until: a.until,
        });
        if (!r.models.actors[r.models.tiers[rule.use] ?? rule.use])
          throw new Error(`"${rule.use}" is not an actor or a tier.`);
        r.info.pendingCastRules = [...(r.info.pendingCastRules ?? []), rule];
        r.saveInfo();
        return 'Rule added. The next turn records it in the journal.';
      },
    ),
  );

  server.registerTool(
    'retake',
    {
      description:
        'Go back to a turn and run again from there, in a new run. The original run does not change. After this call, the director controls the new run.',
      inputSchema: {
        from: z.string(),
        cast: z.string().optional(),
        as: z.string().optional(),
      },
    },
    guard((a: { from: string; cast?: string; as?: string }) => {
      const next = retake(reopen(), a.from, { cast: a.cast, name: a.as });
      run = next;
      return `Made run ${next.info.name}. It starts at ${a.from}. The director now controls it.`;
    }),
  );

  server.registerTool(
    'cost',
    {
      description: 'Show model cost so far.',
      inputSchema: {
        by: z.enum(['seat', 'actor', 'role', 'company']).default('seat'),
      },
    },
    guard(({ by }: { by: 'seat' | 'actor' | 'role' | 'company' }) => {
      const rows = costReport(reopen(), by);
      if (!rows.length) return 'No model calls yet.';
      return rows
        .map(
          (r) =>
            `${r.key}: ${r.calls} calls, ${r.inputTokens} in, ${r.outputTokens} out, $${r.costUsd.toFixed(4)}`,
        )
        .join('\n');
    }),
  );

  await server.connect(new StdioServerTransport());
}
