// Populations: crowds of people that a seed makes (REQ-QC-022), with one bulk
// brain per population (REQ-QC-023).
//
// The journal holds a population as one `population.join` event. The fold
// expands the event into members with the same seed, so a run with 5,000
// consumers does not write 5,000 person events. Each member is a real
// person: an account and a mailbox on the provider's host, and their own
// tool calls in the journal.
//
// The bulk brain is a set of seeded rules. It is free and repeatable. With
// `model_mail`, a model writes a pool of message variants once, and the
// members use the pool (REQ-QC-024).
import { complete } from './brains/complete.ts';
import { OfflineError } from './brains/net.ts';
import { BUILTIN_PROVIDERS, type CastFile, resolveCast } from './cast.ts';
import type { PopulationStage } from './events.ts';
import { parseMessage, splitAddress } from './mail.ts';
import { Ops } from './ops.ts';
import type { Run, SimState } from './run.ts';
import {
  type Behaviour,
  hostOf,
  type MemberSpec,
  type Org,
  type Scenario,
  type Seat,
} from './scenario.ts';
import { type OutMail, Session } from './session.ts';
import { type Calendar, ordOf, turnsPerDay } from './time.ts';

// ----- seeded randomness -----

/** FNV-1a: a 32-bit hash of a string. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: a small seeded generator of numbers in [0, 1). */
function stream(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A number in [0, 1) that depends only on its parts. The result for a member
 * does not depend on the order in which the brain visits the members.
 */
export const chance = (...parts: (string | number)[]) =>
  stream(hash32(parts.join('|')))();

// ----- members -----

const FIRST = [
  'amy',
  'ben',
  'chloe',
  'daniel',
  'ella',
  'farah',
  'george',
  'hannah',
  'isaac',
  'jade',
  'kieran',
  'leah',
  'mohammed',
  'nina',
  'oscar',
  'poppy',
  'quentin',
  'rosa',
  'samir',
  'tara',
  'umar',
  'violet',
  'william',
  'yasmin',
  'zoe',
  'adam',
  'bethany',
  'callum',
  'dina',
  'evan',
  'freya',
  'gareth',
  'holly',
  'ivan',
  'jasmine',
  'kofi',
  'lucy',
  'mark',
  'naomi',
  'owen',
  'priti',
  'rhys',
  'sian',
  'theo',
  'una',
  'vikram',
  'wendy',
  'xavier',
];
const LAST = [
  'adams',
  'baker',
  'clarke',
  'davies',
  'evans',
  'fisher',
  'green',
  'hughes',
  'iqbal',
  'jones',
  'khan',
  'lewis',
  'morgan',
  'nolan',
  'owens',
  'patel',
  'quinn',
  'roberts',
  'singh',
  'taylor',
  'usman',
  'vaughan',
  'walker',
  'young',
  'ahmed',
  'begum',
  'carter',
  'doyle',
  'ellis',
  'foster',
  'grant',
  'hall',
  'irving',
  'jackson',
  'kelly',
  'lowe',
  'mills',
  'nash',
  'okoro',
  'price',
  'reid',
  'shaw',
  'turner',
  'webb',
  'wood',
  'wright',
  'yates',
];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface PopMember {
  user: string;
  first: string;
  last: string;
  name: string;
  /** Trait key to values, for example { owns: ['kettle-k2'] }. */
  traits: Record<string, string[]>;
}

/** A population as the journal holds it. */
export interface PopulationSpec {
  org: string;
  provider: string;
  members: MemberSpec;
}

const expanded = new Map<string, Map<string, PopMember[]>>();

/**
 * Make the members of every population. Populations on one provider share
 * the names on its host, so this takes all of them, in join order. The same
 * specs always give the same members. See REQ-QC-022.
 */
export function expand(specs: PopulationSpec[]): Map<string, PopMember[]> {
  const memo = JSON.stringify(specs);
  const hit = expanded.get(memo);
  if (hit) return hit;
  const out = new Map<string, PopMember[]>();
  const used = new Map<string, Map<string, number>>();
  for (const spec of specs) {
    const names = used.get(spec.provider) ?? new Map<string, number>();
    used.set(spec.provider, names);
    const rand = stream(spec.members.seed);
    const list: PopMember[] = [];
    for (let i = 0; i < spec.members.size; i++) {
      const first = FIRST[Math.floor(rand() * FIRST.length)];
      const last = LAST[Math.floor(rand() * LAST.length)];
      const stem = `${first}${last}`;
      const n = (names.get(stem) ?? 0) + 1;
      names.set(stem, n);
      const traits: Record<string, string[]> = {};
      for (const t of spec.members.traits) {
        if (rand() >= t.share) continue;
        traits[t.key] = [...(traits[t.key] ?? []), t.value];
      }
      list.push({
        user: `${stem}${n}`,
        first: cap(first),
        last: cap(last),
        name: `${cap(first)} ${cap(last)}`,
        traits,
      });
    }
    out.set(spec.org, list);
  }
  if (expanded.size > 16) expanded.clear();
  expanded.set(memo, out);
  return out;
}

/** The populations of a scenario, in the order that genesis writes them. */
export const scenarioPopulations = (s: Scenario): PopulationSpec[] =>
  s.orgs
    .filter((o) => o.kind === 'population')
    .map((o) => ({
      org: o.id,
      provider: o.provider as string,
      members: o.members as MemberSpec,
    }));

/** The members of a population in the world, from the fold. */
export function membersOf(state: SimState, org: string): PopMember[] {
  const specs = [...state.populations].map(([id, p]) => ({
    org: id,
    provider: p.provider,
    members: p.members,
  }));
  return expand(specs).get(org) ?? [];
}

export const providerOf = (s: Scenario, pop: Org): Org => {
  const p = s.orgs.find((o) => o.id === pop.provider);
  if (!p) throw new Error(`Provider "${pop.provider}" does not exist.`);
  return p;
};

/** A member's seat: a person on the provider's host. */
export function memberSeat(s: Scenario, pop: Org, m: PopMember): Seat {
  const provider = providerOf(s, pop);
  const host = hostOf(provider);
  return {
    id: `${m.user}@${provider.domain}`,
    org: provider,
    person: {
      user: m.user,
      name: m.name,
      role: 'member',
      title: `Member of ${pop.name}`,
      persona: '',
      groups: [],
      provisioned: true,
    },
    host,
    mailHost: host,
  };
}

// ----- the bulk brain -----

/** A duration in turns. "2d" is two working days. "4t" is four turns. */
export function turnsOf(d: string | number, cal: Calendar): number {
  if (typeof d === 'number') return d;
  const n = Number.parseInt(d, 10);
  return d.endsWith('d') ? n * turnsPerDay(cal) : n;
}

export interface Variant {
  subject: string;
  body: string;
}
export type Pool = Record<'write' | 'chase' | 'escalate', Variant[]>;

type Step = 'write' | 'chase' | 'escalate';
const STEPS: Step[] = ['write', 'chase', 'escalate'];

const listOf = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

const matches = (b: Behaviour, m: PopMember) =>
  Object.entries(b.who).every(([k, v]) => m.traits[k]?.includes(v));

/** Fill {first}, {last}, {name}, {address} and trait keys such as {owns}. */
function fill(text: string, b: Behaviour, m: PopMember, address: string) {
  return text.replace(/\{([a-z_]+)\}/g, (all, k: string) => {
    if (k === 'first') return m.first;
    if (k === 'last') return m.last;
    if (k === 'name') return m.name;
    if (k === 'address') return address;
    if (b.who[k]) return b.who[k];
    return m.traits[k]?.join(', ') ?? all;
  });
}

/** The next step after `stage`, if the behaviour has one. */
function nextStep(b: Behaviour, stage: PopulationStage): Step | undefined {
  if (stage === 'answered' || stage === 'escalate') return;
  for (const s of STEPS.slice(STEPS.indexOf(stage) + 1)) if (b[s]) return s;
}

const recipientOf = (b: Behaviour, step: Step) =>
  (step === 'write' ? b.write.to : (b[step]?.to ?? b.write.to)).toLowerCase();

/** The domains whose mail counts as a reply to this behaviour. */
const replyDomains = (b: Behaviour) =>
  new Set(
    STEPS.filter((s) => b[s]).map(
      (s) => splitAddress(recipientOf(b, s)).domain,
    ),
  );

export const progressKey = (org: string, rule: string) => `${org}/${rule}`;

export interface PopulationTurn {
  ops: Ops;
  outbox: OutMail[];
  mails: number;
  costUsd: number;
}

const POOL_SYSTEM = [
  'You write sample emails for a workplace simulation.',
  'Write only JSON. Write no other text.',
].join('\n');

function poolPrompt(pop: Org, b: Behaviour, size: number): string {
  const step = (s: Step) => {
    const t = b[s];
    if (!t) return [];
    return [
      `Step "${s}": the email goes to ${recipientOf(b, s)}.`,
      `Example subject: ${listOf(t.subject)[0]}`,
      `Example body:\n${listOf(t.body)[0]}`,
      '',
    ];
  };
  return [
    `The people are members of the public: ${pop.name}.`,
    pop.about.trim(),
    `Write ${size} different versions of each step below. Each version must have a different tone and length.`,
    'Use these placeholders. The simulation replaces them: {first}, {last}, {name}, {address}.',
    ...Object.keys(b.who).map((k) => `Use {${k}} for the value "${b.who[k]}".`),
    '',
    ...STEPS.flatMap(step),
    `Write one JSON object with the keys ${STEPS.filter((s) => b[s])
      .map((s) => `"${s}"`)
      .join(
        ', ',
      )}. Each key has a list of objects. Each object has the keys "subject" and "body".`,
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Read the pool from model text. Throws when the text has no usable pool. */
export function parsePool(text: string, b: Behaviour): Pool {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start)
    throw new Error('The model reply has no JSON object.');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const pool: Pool = { write: [], chase: [], escalate: [] };
  for (const s of STEPS) {
    if (!b[s]) continue;
    const list = Array.isArray(raw[s]) ? (raw[s] as unknown[]) : [];
    pool[s] = list
      .filter(
        (v): v is Variant =>
          !!v &&
          typeof (v as Variant).subject === 'string' &&
          typeof (v as Variant).body === 'string',
      )
      .map((v) => ({ subject: v.subject, body: v.body }));
    if (!pool[s].length)
      throw new Error(`The model reply has no variants for step "${s}".`);
  }
  return pool;
}

/**
 * Get the variant pool of a behaviour: from the journal, or from a model
 * through the cast's provider layer. A new pool goes into the object store,
 * and a population.pool event records its hash. See REQ-QC-024.
 */
async function poolFor(
  run: Run,
  state: SimState,
  ops: Ops,
  pop: Org,
  b: Behaviour,
  cast: CastFile,
): Promise<{ pool: Pool; costUsd: number }> {
  const key = progressKey(pop.id, b.id);
  const known = state.pools.get(key);
  if (known) return { pool: JSON.parse(run.objects.get(known)), costUsd: 0 };
  const provider = providerOf(run.scenario, pop);
  const seat: Seat = {
    id: pop.id,
    org: pop,
    person: {
      user: pop.id,
      name: pop.name,
      role: 'population',
      title: pop.name,
      persona: '',
      groups: [],
      provisioned: true,
    },
    host: hostOf(provider),
    mailHost: hostOf(provider),
  };
  const casting = resolveCast(
    run.models,
    cast,
    seat,
    ops.ord,
    run.scenario.calendar,
  );
  if ((BUILTIN_PROVIDERS as readonly string[]).includes(casting.actor.provider))
    throw new Error(
      `Population "${pop.id}" has model_mail set to true. The cast gives it actor "${casting.actorName}". That actor has no model. Cast the population to a model actor, or set model_mail to false.`,
    );
  const { text, call } = await complete(
    run.models,
    casting.actor,
    POOL_SYSTEM,
    poolPrompt(pop, b, pop.pool_size),
  );
  ops.emit(pop.id, {
    type: 'model.call',
    seat: pop.id,
    actor: casting.actorName,
    model: call.model,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: call.costUsd,
    ms: call.ms,
    request: run.objects.putJson(call.request),
    response: run.objects.putJson(call.response),
  });
  const pool = parsePool(text, b);
  const hash = run.objects.putJson(pool);
  ops.emit(pop.id, {
    type: 'population.pool',
    org: pop.id,
    rule: b.id,
    hash,
    actor: casting.actorName,
  });
  return { pool, costUsd: call.costUsd };
}

/** The pool from the scenario text: every subject with every body. */
function templatePool(b: Behaviour): Pool {
  const pool: Pool = { write: [], chase: [], escalate: [] };
  for (const s of STEPS) {
    const t = b[s];
    if (!t) continue;
    for (const subject of listOf(t.subject))
      for (const body of listOf(t.body)) pool[s].push({ subject, body });
  }
  return pool;
}

/** True when the member has mail from a reply domain since turn `since`. */
function answered(
  ops: Ops,
  host: string,
  user: string,
  since: number,
  domains: Set<string>,
): boolean {
  for (const box of ['new', 'cur']) {
    const dir = `/var/mail/${user}/${box}`;
    for (const { name, node } of ops.vfs.children(host, dir)) {
      if (node.mtime < since || !name.endsWith('.eml')) continue;
      const m = parseMessage(
        name.slice(0, -4),
        ops.read(host, `${dir}/${name}`) ?? '',
      );
      if (domains.has(splitAddress(m.from).domain.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * One turn of a population's bulk brain. All members work on one view of
 * the snapshot, as one bulk session. Each mail is the member's own
 * send_mail call, in the member's own Session, so the journal records it as
 * that member's tool call. See REQ-QC-023.
 */
export async function populationTurn(
  run: Run,
  state: SimState,
  pop: Org,
  label: string,
  ord: number,
  cast: CastFile,
): Promise<PopulationTurn> {
  const { scenario } = run;
  const cal = scenario.calendar;
  const ops = new Ops(state.vfs.clone(), run.objects, ord, state.system);
  const result: PopulationTurn = { ops, outbox: [], mails: 0, costUsd: 0 };
  const provider = providerOf(scenario, pop);
  const host = hostOf(provider);
  if (state.system.get(host)?.has('host.down')) {
    ops.emit('engine', {
      type: 'population.skip',
      org: pop.id,
      reason: `host ${provider.host} is down`,
    });
    return result;
  }
  const members = membersOf(state, pop.id);
  const seed = pop.members?.seed ?? 0;
  for (const b of pop.behaviour) {
    if (ord < ordOf(b.from, cal)) continue;
    if (b.until && ord >= ordOf(b.until, cal)) continue;
    let pool: Pool;
    try {
      if (pop.model_mail) {
        const got = await poolFor(run, state, ops, pop, b, cast);
        pool = got.pool;
        result.costUsd += got.costUsd;
      } else pool = templatePool(b);
    } catch (err) {
      // Offline mode stops the run (REQ-QC-030).
      if (err instanceof OfflineError) throw err;
      ops.emit(pop.id, {
        type: 'model.error',
        seat: pop.id,
        actor: 'population',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const progress = state.progress.get(progressKey(pop.id, b.id));
    const domains = replyDomains(b);
    const moved: Record<PopulationStage, string[]> = {
      write: [],
      chase: [],
      escalate: [],
      answered: [],
    };
    for (const m of members) {
      if (!matches(b, m)) continue;
      const cur = progress?.get(m.user);
      let step: Step | undefined;
      if (!cur) {
        if (chance(seed, pop.id, b.id, m.user, ord) < b.p) step = 'write';
      } else {
        if (cur.stage === 'answered') continue;
        const next = nextStep(b, cur.stage);
        if (answered(ops, host, m.user, cur.ord, domains)) {
          moved.answered.push(m.user);
          continue;
        }
        const after = next && next !== 'write' ? b[next]?.after : undefined;
        if (next && after !== undefined && ord - cur.ord >= turnsOf(after, cal))
          step = next;
      }
      if (!step) continue;
      const variants = pool[step];
      const v =
        variants[
          Math.floor(chance(seed, pop.id, b.id, step, m.user) * variants.length)
        ];
      const seat = memberSeat(scenario, pop, m);
      const session = new Session(
        seat,
        scenario,
        label,
        ord,
        ops.vfs,
        run.objects,
        state.system,
        state.people,
        ops,
      );
      const r = await session.call(
        'send_mail',
        {
          to: recipientOf(b, step),
          subject: fill(v.subject, b, m, seat.id),
          body: fill(v.body, b, m, seat.id),
        },
        { population: pop.id },
      );
      if (!r.ok) continue;
      moved[step].push(m.user);
      result.outbox.push(...session.outbox);
      result.mails += 1;
    }
    for (const stage of ['answered', ...STEPS] as PopulationStage[])
      if (moved[stage].length)
        ops.emit(pop.id, {
          type: 'population.step',
          org: pop.id,
          rule: b.id,
          stage,
          users: moved[stage],
        });
  }
  return result;
}
