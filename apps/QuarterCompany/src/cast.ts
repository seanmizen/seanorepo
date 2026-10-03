// Model assignment in four layers: providers, actors, tiers and casts.
// A cast maps seats to actors. The most specific rule wins. See REQ-QC-005.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readYaml, type Seat } from './scenario.ts';
import { type Calendar, ordOf } from './time.ts';

export const Provider = z.object({
  kind: z.enum(['anthropic', 'openai-compatible']),
  base_url: z.string().optional(),
  key_env: z.string().optional(),
});
export type Provider = z.infer<typeof Provider>;

/** Built-in providers need no entry in providers.yaml. */
export const BUILTIN_PROVIDERS = ['script', 'idle', 'external'] as const;

export const Actor = z.object({
  provider: z.string(),
  model: z.string().optional(),
  max_tokens: z.number().default(4000),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** US dollars per million tokens. */
  price: z
    .object({ in: z.number(), out: z.number() })
    .default({ in: 0, out: 0 }),
  /** Model requests allowed in one turn, before the engine ends the turn. */
  max_steps: z.number().default(12),
  /** Script file for the `script` provider, relative to the scenario. */
  script: z.string().optional(),
});
export type Actor = z.infer<typeof Actor>;

const ActorsFile = z.object({
  actors: z.record(z.string(), Actor),
  tiers: z.record(z.string(), z.string()).default({}),
});

export const Match = z
  .object({
    user: z.string().optional(), // seat id, user@domain
    org: z.string().optional(),
    role: z.string().optional(),
  })
  .default({});

export const Rule = z.object({
  match: Match,
  use: z.string(),
  from: z.string().optional(),
  until: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

const CastFile = z.object({
  default: z.string(),
  rules: z.array(Rule).default([]),
});
export type CastFile = z.infer<typeof CastFile>;

export interface Models {
  providers: Record<string, Provider>;
  actors: Record<string, Actor>;
  tiers: Record<string, string>;
}

export function loadModels(scenarioDir: string): Models {
  const pf = join(scenarioDir, 'providers.yaml');
  const providers = existsSync(pf)
    ? z.record(z.string(), Provider).parse(readYaml(pf))
    : {};
  const af = ActorsFile.parse(readYaml(join(scenarioDir, 'actors.yaml')));
  for (const [name, a] of Object.entries(af.actors)) {
    const builtin = (BUILTIN_PROVIDERS as readonly string[]).includes(
      a.provider,
    );
    if (!builtin && !providers[a.provider]) {
      throw new Error(
        `Actor "${name}" uses provider "${a.provider}". providers.yaml does not define it.`,
      );
    }
  }
  for (const [tier, actor] of Object.entries(af.tiers)) {
    if (!af.actors[actor])
      throw new Error(
        `Tier "${tier}" points to actor "${actor}". actors.yaml does not define it.`,
      );
  }
  return { providers, actors: af.actors, tiers: af.tiers };
}

export function loadCast(scenarioDir: string, name: string): CastFile {
  const file = join(scenarioDir, 'casts', `${name}.yaml`);
  if (!existsSync(file)) throw new Error(`Cast file ${file} does not exist.`);
  return CastFile.parse(readYaml(file));
}

const specificity = (m: Rule['match']) =>
  m.user ? 4 : m.org && m.role ? 3 : m.role ? 2 : m.org ? 1 : 0;

const matches = (m: Rule['match'], seat: Seat) =>
  (!m.user || m.user === seat.id) &&
  (!m.org || m.org === seat.org.id) &&
  (!m.role || m.role === seat.person.role);

export interface Casting {
  actorName: string;
  actor: Actor;
  via: string; // the tier or actor name the rule used
}

/**
 * Resolve the actor for a seat at a turn. Rules apply only inside their
 * `from`/`until` window. The highest specificity wins. On a tie, the rule
 * that comes later wins, so a recast added during a run beats the cast file.
 */
export function resolveCast(
  models: Models,
  cast: CastFile,
  seat: Seat,
  ord: number,
  cal: Calendar,
): Casting {
  let best: { rule: Rule | undefined; score: number } = {
    rule: undefined,
    score: -1,
  };
  for (const rule of cast.rules) {
    if (!matches(rule.match, seat)) continue;
    if (rule.from && ord < ordOf(rule.from, cal)) continue;
    if (rule.until && ord > ordOf(rule.until, cal)) continue;
    const score = specificity(rule.match);
    if (score >= best.score) best = { rule, score };
  }
  const via = best.rule?.use ?? cast.default;
  const actorName = models.tiers[via] ?? via;
  const actor = models.actors[actorName];
  if (!actor)
    throw new Error(`The cast names "${via}". It is not an actor or a tier.`);
  return { actorName, actor, via };
}
