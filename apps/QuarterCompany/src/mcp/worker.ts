// qc-worker: an MCP server that lets an outside agent (Claude Code, Claude
// Desktop, any MCP client) work as one seat. See REQ-QC-010.
//
// Each call runs at once against the snapshot of the next turn, and goes to
// pending/<turn>/<seat>.jsonl. When the engine runs that turn, the seat's
// `external` brain replays the same calls against the same snapshot, so the
// journal gets the same results that the agent saw.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { z } from 'zod';
import { pendingPathOf } from '../brains/index.ts';
import { resolveCast } from '../cast.ts';
import { compelledFor, runCompelled, turnStart } from '../engine.ts';
import { Ops } from '../ops.ts';
import { briefing, systemPrompt } from '../prompt.ts';
import type { Run, SimState } from '../run.ts';
import { seatsOf } from '../scenario.ts';
import { Session } from '../session.ts';
import { labelOf } from '../time.ts';
import { toolsFor } from '../tools/index.ts';
import { Directory } from '../users.ts';

const text = (t: string, isError = false) => ({
  content: [{ type: 'text' as const, text: t }],
  isError,
});

export function workerSession(run: Run, seatId: string) {
  const seat = seatsOf(run.scenario).find((s) => s.id === seatId);
  if (!seat) throw new Error(`Seat ${seatId} does not exist in this scenario.`);
  let cached: { ord: number; state: SimState } | undefined;

  /** A session for the next turn, with this seat's pending calls already done. */
  const open = async () => {
    const last = run.lastOrd();
    if (cached?.ord !== last) cached = { ord: last, state: run.load() };
    const { state } = cached;
    const ord = state.ord + 1;
    const label = labelOf(ord, run.scenario.calendar);
    const start = new Ops(state.vfs.clone(), run.objects, ord);
    turnStart(run, start, label);
    const session = new Session(
      seat,
      run.scenario,
      label,
      ord,
      start.vfs.clone(),
      run.objects,
    );
    // Compelled calls first, as in the engine. They are not the agent's, so
    // they never go to the pending file. See REQ-QC-016.
    const did = await runCompelled(session, compelledFor(run, label, seat.id));
    const path = pendingPathOf(run.dir, label, seat.id);
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)) {
        const c = JSON.parse(line);
        await session.call(c.tool, c.args);
      }
    }
    return { session, state, path, did };
  };

  const call = async (tool: string, args: unknown) => {
    const { session, path } = await open();
    if (session.done)
      return {
        ok: false,
        text: 'Your turn is over. Wait until the director runs the next turn.',
      };
    const r = await session.call(tool, args);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ tool, args })}\n`);
    return r;
  };

  const brief = async () => {
    const { session, state, did } = await open();
    const unread = session.vfs.children(
      seat.host,
      `/var/mail/${seat.person.user}/new`,
    ).length;
    const cast = {
      ...run.castFile,
      rules: [...run.castFile.rules, ...state.castRules],
    };
    const casting = resolveCast(
      run.models,
      cast,
      seat,
      session.ops.ord,
      run.scenario.calendar,
    );
    const warn =
      casting.actor.provider === 'external'
        ? ''
        : `\n\nWARNING: the cast gives this seat to actor "${casting.actorName}", not to an external actor. The engine ignores your calls.`;
    return `${systemPrompt(seat, run.scenario.calendar.slotMinutes, run.scenario.turnMinutes)}\n\n${briefing(session, state.seats.get(seat.id), unread, state.thoughts.get(seat.id), did)}${warn}`;
  };

  return { seat, call, brief, open };
}

export async function serveWorker(run: Run, seatId: string) {
  const w = workerSession(run, seatId);
  const admin = Directory.load(
    run.load().vfs,
    run.objects,
    w.seat.host,
  ).isAdmin(w.seat.person.user);
  const server = new McpServer({
    name: `qc-worker-${seatId}`,
    version: '0.1.0',
  });
  server.registerTool(
    'briefing',
    {
      description:
        'Read who you are, the time, and your note from your last turn. Read this first in each turn.',
    },
    async () => text(await w.brief()),
  );
  for (const t of toolsFor(admin)) {
    const handler = async (args: unknown) => {
      const r = await w.call(t.name, args);
      return text(r.text, !r.ok);
    };
    // The registry holds zod object schemas, which is what the SDK accepts.
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.input as z.ZodObject },
      handler as never,
    );
  }
  await server.connect(new StdioServerTransport());
}
