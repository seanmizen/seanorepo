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
import { anthropicBrain } from './anthropic.ts';
import { openaiBrain } from './openai.ts';
import type { Brain } from './types.ts';

const Call = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});
const ScriptFile = z.record(z.string(), z.record(z.string(), z.array(Call)));

const scriptCache = new Map<string, z.infer<typeof ScriptFile>>();

const scriptBrain: Brain = async (ctx) => {
  const file = ctx.casting.actor.script;
  if (!file)
    throw new Error(
      `Actor "${ctx.casting.actorName}" uses provider "script" but names no script file.`,
    );
  const path = join(ctx.runDir, 'scenario', file);
  if (!scriptCache.has(path))
    scriptCache.set(path, ScriptFile.parse(readYaml(path) ?? {}));
  const calls =
    scriptCache.get(path)?.[ctx.session.seat.id]?.[ctx.session.label] ?? [];
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
