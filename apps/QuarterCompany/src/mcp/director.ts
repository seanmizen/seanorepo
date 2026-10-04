// qc-director: an MCP server for the person who runs the simulation. It runs
// turns, plays them back, injects events and recasts seats. Workers never
// get this server. See REQ-QC-010.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Rule } from '../cast.ts';
import { runUntil } from '../engine.ts';
import { Run } from '../run.ts';
import {
  checkCompelSeat,
  checkInject,
  Inject,
  SYSTEM_KINDS,
} from '../scenario.ts';
import { labelOf, ordOf } from '../time.ts';
import {
  type CostBy,
  costLines,
  costReport,
  playback,
  retake,
  statusLines,
} from '../timeline.ts';
import { TOOLS } from '../tools/index.ts';
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
      inputSchema: { org: z.string(), path: z.string() },
    },
    guard(({ org, path }: { org: string; path: string }) => {
      const r = reopen();
      const c = r.scenario.orgs.find((x) => x.id === org);
      if (!c) throw new Error(`Organisation "${org}" does not exist.`);
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
    'inject',
    {
      description:
        'Schedule a system event on one organisation\'s host: host.down, mail.down or disk.full. It starts at "at" (default: the next turn) and ends at the start of "until". A system event never acts as a person. To make a person act, use compel.',
      inputSchema: {
        kind: z.enum(SYSTEM_KINDS),
        org: z.string(),
        at: z.string().optional(),
        until: z.string().optional(),
        note: z.string().default(''),
      },
    },
    guard(
      (a: {
        kind: (typeof SYSTEM_KINDS)[number];
        org: string;
        at?: string;
        until?: string;
        note: string;
      }) => {
        const r = reopen();
        const cal = r.scenario.calendar;
        const at = a.at ?? labelOf(r.lastOrd() + 1, cal);
        if (ordOf(at, cal) <= r.lastOrd())
          throw new Error(`Turn ${at} has happened. Give a later turn.`);
        if (a.until && ordOf(a.until, cal) <= ordOf(at, cal))
          throw new Error('"until" must be after "at".');
        const inj = Inject.parse({ ...a, at });
        checkInject(r.scenario, inj);
        r.info.injects.push(inj);
        r.saveInfo();
        return `${inj.kind} on ${inj.org} is scheduled from ${at}${inj.until ? ` until ${inj.until}` : ''}.`;
      },
    ),
  );

  server.registerTool(
    'compel',
    {
      description:
        'Make a seat run one tool at the start of a turn, in its own session. The action is real: for example, a compelled mail is in the sent folder of the sender. Without "at", it runs in the next turn.',
      inputSchema: {
        seat: z.string(),
        tool: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
        at: z.string().optional(),
      },
    },
    guard(
      (a: {
        seat: string;
        tool: string;
        args: Record<string, unknown>;
        at?: string;
      }) => {
        const r = reopen();
        const cal = r.scenario.calendar;
        const at = a.at ?? labelOf(r.lastOrd() + 1, cal);
        if (ordOf(at, cal) <= r.lastOrd())
          throw new Error(`Turn ${at} has happened. Give a later turn.`);
        checkCompelSeat(r.scenario, a.seat);
        if (!TOOLS.some((t) => t.name === a.tool))
          throw new Error(`Tool "${a.tool}" does not exist.`);
        r.info.compel = [
          ...(r.info.compel ?? []),
          { at, seat: a.seat, do: [{ tool: a.tool, args: a.args }] },
        ];
        r.saveInfo();
        return `${a.seat} will run ${a.tool} at the start of ${at}.`;
      },
    ),
  );

  server.registerTool(
    'recast',
    {
      description:
        'Give seats to a different actor or tier, from the next turn. Match by user, org or role.',
      inputSchema: {
        use: z.string(),
        user: z.string().optional(),
        org: z.string().optional(),
        role: z.string().optional(),
        from: z.string().optional(),
        until: z.string().optional(),
      },
    },
    guard(
      (a: {
        use: string;
        user?: string;
        org?: string;
        role?: string;
        from?: string;
        until?: string;
      }) => {
        const r = reopen();
        const rule = Rule.parse({
          match: { user: a.user, org: a.org, role: a.role },
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
      description:
        'Show model calls, tokens, request seconds and cost so far. Group the rows by seat, actor, role, org or turn.',
      inputSchema: {
        by: z.enum(['seat', 'actor', 'role', 'org', 'turn']).default('seat'),
      },
    },
    guard(({ by }: { by: CostBy }) => {
      const rows = costReport(reopen(), by);
      if (!rows.length) return 'No model calls yet.';
      return costLines(rows, by).join('\n');
    }),
  );

  await server.connect(new StdioServerTransport());
}
