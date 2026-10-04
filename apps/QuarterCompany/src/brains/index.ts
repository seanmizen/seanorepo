// Brains that need no model, and the lookup from an actor to its brain.
//
// - script:   follow a YAML file of tool calls per seat and turn. Free and
//             repeatable, for demos and tests.
// - idle:     do nothing and sleep until mail comes.
// - external: replay the calls that an outside agent made through the
//             qc-worker MCP server. See REQ-QC-010.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readYaml } from '../scenario.ts';
import { type Calendar, ordOf } from '../time.ts';
import { anthropicBrain } from './anthropic.ts';
import { openaiBrain } from './openai.ts';
import type { Brain } from './types.ts';

const Call = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});
const ScriptFile = z.record(z.string(), z.record(z.string(), z.array(Call)));

const scriptCache = new Map<string, z.infer<typeof ScriptFile>>();

/**
 * The calls of one seat in one turn. A key is a turn label, or a range
 * "<from>..<to>" that includes both turns. A label beats a range. When
 * ranges overlap, the later range in the file wins, as a later cast rule
 * does. Ranges let a long scripted story stay short (REQ-QC-028).
 */
export function scriptCalls(
  bySeat: Record<string, z.infer<typeof Call>[]> | undefined,
  label: string,
  cal: Calendar,
): z.infer<typeof Call>[] {
  if (!bySeat) return [];
  if (bySeat[label]) return bySeat[label];
  const ord = ordOf(label, cal);
  let hit: z.infer<typeof Call>[] = [];
  for (const [key, calls] of Object.entries(bySeat)) {
    const [from, to] = key.split('..');
    if (to === undefined) continue;
    if (ord >= ordOf(from.trim(), cal) && ord <= ordOf(to.trim(), cal))
      hit = calls;
  }
  return hit;
}

const scriptBrain: Brain = async (ctx) => {
  const file = ctx.casting.actor.script;
  if (!file)
    throw new Error(
      `Actor "${ctx.casting.actorName}" uses provider "script" but names no script file.`,
    );
  const path = join(ctx.runDir, 'scenario', file);
  if (!scriptCache.has(path)) {
    // A top-level key that starts with "x-" holds YAML anchors, not a seat.
    const raw = Object.entries(
      (readYaml(path) ?? {}) as Record<string, unknown>,
    ).filter(([k]) => !k.startsWith('x-'));
    scriptCache.set(path, ScriptFile.parse(Object.fromEntries(raw)));
  }
  const calls = scriptCalls(
    scriptCache.get(path)?.[ctx.session.seat.id],
    ctx.session.label,
    ctx.session.scenario.calendar,
  );
  for (const c of calls) {
    if (ctx.session.done) break;
    await ctx.session.call(c.tool, c.args);
  }
  // A script costs nothing, so it never sleeps: a later turn may have calls.
  if (!ctx.session.done)
    ctx.session.endTurn(calls.length ? 'script' : '', 'next_turn');
};

const idleBrain: Brain = async (ctx) => {
  ctx.session.endTurn('', 'on_mail');
};

export const pendingPathOf = (runDir: string, label: string, seat: string) =>
  join(runDir, 'pending', label, `${seat}.jsonl`);

const externalBrain: Brain = async (ctx) => {
  const path = pendingPathOf(
    ctx.runDir,
    ctx.session.label,
    ctx.session.seat.id,
  );
  if (!existsSync(path)) {
    ctx.session.endTurn('(no work submitted)', 'next_turn');
    return;
  }
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    if (ctx.session.done) break;
    const c = Call.parse(JSON.parse(line));
    await ctx.session.call(c.tool, c.args);
  }
  if (!ctx.session.done) ctx.session.endTurn('', 'next_turn');
};

export function brainFor(provider: string, kind: string | undefined): Brain {
  switch (provider) {
    case 'script':
      return scriptBrain;
    case 'idle':
      return idleBrain;
    case 'external':
      return externalBrain;
  }
  switch (kind) {
    case 'anthropic':
      return anthropicBrain;
    case 'openai-compatible':
      return openaiBrain;
  }
  throw new Error(`Provider "${provider}" has no brain.`);
}
