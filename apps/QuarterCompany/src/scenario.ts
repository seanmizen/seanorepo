// Scenario files: the organisations, their people and the seed files. A
// scenario says who exists. It never names a model: that is the cast's job
// (REQ-QC-006). The world is closed: every sender is a person in an
// organisation in the scenario (REQ-QC-017).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { type Calendar, DEFAULT_CALENDAR } from './time.ts';

const Person = z.object({
  user: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string(),
  role: z.string(),
  title: z.string(),
  persona: z.string().default(''),
  groups: z.array(z.string()).default([]),
  /** False: the person exists but has no account yet. IT must create it. */
  provisioned: z.boolean().default(true),
  /**
   * For a consultant: the id of the client organisation where the person
   * works. The mailbox stays on the employer's host. See REQ-QC-021.
   */
  site: z.string().optional(),
});
export type Person = z.infer<typeof Person>;

const SeedFile = z.object({
  path: z.string(),
  owner: z.string().default('root'),
  group: z.string().optional(),
  mode: z.union([z.string(), z.number()]).optional(),
  content: z.string().optional(),
  dir: z.boolean().default(false),
});

/**
 * Kinds of organisation. An `agency` places new employees at a client. A
 * `consultancy` places its own consultants at a client. Staff of both kinds
 * get the placement tools (REQ-QC-020). A `provider` is a consumer mail
 * service: its host holds the mailboxes of population members. A
 * `population` is a crowd of people that a seed makes, with one bulk brain
 * (REQ-QC-023).
 */
export const ORG_KINDS = [
  'company',
  'agency',
  'consultancy',
  'provider',
  'population',
] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export const PLACES_PEOPLE: readonly OrgKind[] = ['agency', 'consultancy'];

/** Text for one step of a behaviour. A list gives variants. */
const Lines = z.union([z.string(), z.array(z.string()).min(1)]);
const StepText = z.object({
  /** Default: the address of the write step. */
  to: z.string().optional(),
  subject: Lines,
  body: Lines,
});
const Duration = z.union([z.string().regex(/^\d+[dt]$/), z.number().int()]);

/**
 * One rule of a population's bulk brain. From turn `from`, each member that
 * matches `who` writes to `write.to` with probability `p` in each turn. A
 * member with no reply chases after `chase.after`, then escalates after
 * `escalate.after`. A duration is turns ("4t") or working days ("2d").
 */
export const Behaviour = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    from: z.string(),
    until: z.string().optional(),
    who: z.record(z.string(), z.string()).default({}),
    p: z.number().min(0).max(1),
    write: StepText.extend({ to: z.string() }),
    chase: StepText.extend({ after: Duration }).optional(),
    escalate: StepText.extend({ after: Duration }).optional(),
  })
  .strict();
export type Behaviour = z.infer<typeof Behaviour>;

/** How a seed makes the members of a population. See REQ-QC-022. */
export const MemberSpec = z
  .object({
    size: z.number().int().min(1).max(100_000),
    seed: z.number().int(),
    /** Each trait: a key, a value and the share of members that have it. */
    traits: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_]*$/),
            value: z.string(),
            share: z.number().min(0).max(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type MemberSpec = z.infer<typeof MemberSpec>;

const Org = z.object({
  kind: z.enum(ORG_KINDS).default('company'),
  name: z.string(),
  /** A population has no domain and no host: its provider has them. */
  domain: z.string().default(''),
  host: z.string().default(''),
  about: z.string().default(''),
  groups: z.array(z.string()).default([]),
  people: z.array(Person).default([]),
  /**
   * Role mailboxes, for example "support". Each one is an account that
   * takes mail, with no person and no seat. A case system reads it.
   * See REQ-QC-027.
   */
  mailboxes: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/)).default([]),
  files: z.array(SeedFile).default([]),
  /** For a population: the id of the provider organisation. */
  provider: z.string().optional(),
  /** For a population: how to make the members. */
  members: MemberSpec.optional(),
  /** For a population: the rules of the bulk brain. */
  behaviour: z.array(Behaviour).default([]),
  /**
   * For a population: false (the default) uses the text in the scenario.
   * True: a model writes a pool of variants once, and members use the pool.
   * The cast chooses the model. See REQ-QC-024.
   */
  model_mail: z.boolean().default(false),
  /** Variants for each step when model_mail is true. */
  pool_size: z.number().int().min(1).max(50).default(8),
});
export type Org = z.infer<typeof Org> & { id: string };

/**
 * A system event: the physics of the world, never a person. It acts on one
 * organisation's host from turn `at`, and ends at the start of turn `until`.
 * Without `until`, it lasts to the end of the run. See REQ-QC-017.
 *
 * - host.down: nobody on the host can log in. Mail to and from it waits.
 * - mail.down: people work, but mail to and from the host waits.
 * - disk.full: writes on the host fail. Mail to it waits.
 */
export const SYSTEM_KINDS = ['host.down', 'mail.down', 'disk.full'] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];
export const Inject = z
  .object({
    at: z.string(),
    until: z.string().optional(),
    kind: z.enum(SYSTEM_KINDS),
    org: z.string(),
    note: z.string().default(''),
  })
  .strict();
export type Inject = z.infer<typeof Inject>;

/**
 * A compelled action: at a turn, a seat runs these tool calls in its own
 * session, before its brain. The world records them like any other action,
 * so the seat's mailbox and files stay true. See REQ-QC-016.
 */
export const Compel = z.object({
  at: z.string(),
  seat: z.string(),
  do: z
    .array(
      z.object({
        tool: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
});
export type Compel = z.infer<typeof Compel>;

const ScenarioFile = z.object({
  name: z.string(),
  description: z.string().default(''),
  calendar: z
    .object({
      dayStart: z.string(),
      dayEnd: z.string(),
      slotMinutes: z.number(),
      daysPerQuarter: z.number(),
      quartersPerYear: z.number(),
    })
    .partial()
    .default({}),
  /** Simulated minutes in one turn. Defaults to the slot length. */
  turnMinutes: z.number().optional(),
  /** Seats that run at the same time inside one turn. */
  concurrency: z.number().default(4),
  orgs: z.array(z.string()),
  injects: z.array(Inject).default([]),
  compel: z.array(Compel).default([]),
});

export interface Scenario {
  dir: string;
  name: string;
  description: string;
  calendar: Calendar;
  turnMinutes: number;
  concurrency: number;
  orgs: Org[];
  injects: Inject[];
  compel: Compel[];
}

export const readYaml = (path: string): unknown =>
  parse(readFileSync(path, 'utf8'));

export function loadScenario(dir: string): Scenario {
  const file = join(dir, 'scenario.yaml');
  if (!existsSync(file))
    throw new Error(
      `File ${file} does not exist. A scenario folder must contain scenario.yaml.`,
    );
  const s = ScenarioFile.parse(readYaml(file));
  const calendar = { ...DEFAULT_CALENDAR, ...s.calendar };
  const orgs = s.orgs.map((id) => {
    const file = join(dir, 'orgs', `${id}.yaml`);
    if (!existsSync(file))
      throw new Error(`Organisation file ${file} does not exist.`);
    return { id, ...Org.parse(readYaml(file)) };
  });
  for (const c of orgs) checkOrg(c, orgs);
  const domains = new Set<string>();
  for (const c of orgs) {
    if (c.kind === 'population') continue;
    if (domains.has(c.domain))
      throw new Error(`Two organisations use the domain ${c.domain}.`);
    domains.add(c.domain);
  }
  const scenario: Scenario = {
    dir,
    name: s.name,
    description: s.description,
    calendar,
    turnMinutes: s.turnMinutes ?? calendar.slotMinutes,
    concurrency: s.concurrency,
    orgs,
    injects: s.injects,
    compel: s.compel,
  };
  for (const inj of s.injects) checkInject(scenario, inj);
  for (const o of orgs)
    for (const p of o.people)
      if (p.site && !orgs.some((x) => x.id === p.site && x.id !== o.id))
        throw new Error(
          `${p.user}@${o.domain} has site "${p.site}". The site must be another organisation in the scenario.`,
        );
  for (const c of s.compel) checkCompelSeat(scenario, c.seat);
  return scenario;
}

function checkOrg(c: Org, orgs: Org[]) {
  if (c.kind !== 'population') {
    if (!c.domain || !c.host)
      throw new Error(`Organisation "${c.id}" must have a domain and a host.`);
    const clash = c.mailboxes.find(
      (m) => m === 'root' || c.people.some((p) => p.user === m),
    );
    if (clash)
      throw new Error(
        `Organisation "${c.id}" has the mailbox "${clash}". A person or root has that user name. Use another name.`,
      );
    if (c.provider || c.members || c.behaviour.length)
      throw new Error(
        `Organisation "${c.id}" has provider, members or behaviour. Only a population can have them.`,
      );
    return;
  }
  if (
    c.domain ||
    c.host ||
    c.people.length ||
    c.files.length ||
    c.mailboxes.length
  )
    throw new Error(
      `Population "${c.id}" has a domain, a host, people, mailboxes or files. A population has none of them. Its provider holds the mailboxes.`,
    );
  if (!c.members) throw new Error(`Population "${c.id}" must have "members".`);
  const provider = orgs.find((o) => o.id === c.provider);
  if (provider?.kind !== 'provider')
    throw new Error(
      `Population "${c.id}" names provider "${c.provider}". The provider must be an organisation of kind "provider" in the scenario.`,
    );
  const ids = new Set<string>();
  for (const b of c.behaviour) {
    if (ids.has(b.id))
      throw new Error(`Population "${c.id}" has two behaviours "${b.id}".`);
    ids.add(b.id);
  }
}

/**
 * A compel can name a person who joins later in the run, so only the domain
 * is checked here. The engine records compel.skipped when the person is not
 * in the world at that turn.
 */
export function checkCompelSeat(s: Scenario, seat: string) {
  const domain = seat.split('@')[1] ?? '';
  if (!mailHostOf(s, domain))
    throw new Error(
      `A compel entry names seat ${seat}. No organisation in the world has the domain "${domain}".`,
    );
}

/** Check that a system event names a real organisation and real turns. */
export function checkInject(s: Scenario, inj: Inject) {
  const org = s.orgs.find((o) => o.id === inj.org);
  if (!org) {
    throw new Error(
      `A system event names organisation "${inj.org}". The scenario has no such organisation.`,
    );
  }
  if (org.kind === 'population')
    throw new Error(
      `A system event names population "${inj.org}". A population has no host. Name its provider "${org.provider}".`,
    );
}

/** The mail directory: the host that holds the mailboxes of a domain. */
export function mailHostOf(
  s: Scenario,
  domain: string,
): { org: Org; host: string } | undefined {
  const d = domain.toLowerCase();
  const org = s.orgs.find((o) => o.kind !== 'population' && o.domain === d);
  return org ? { org, host: hostOf(org) } : undefined;
}

export const hostOf = (c: Org) => `${c.id}/${c.host}`;
export const seatOf = (c: Org, p: Person) => `${p.user}@${c.domain}`;

export interface Seat {
  id: string; // user@domain
  /** The employer. */
  org: Org;
  person: Person;
  /** For a consultant: the client organisation where the seat works. */
  site?: Org;
  /** The host where the seat logs in and works. */
  host: string;
  /** The host that holds the seat's mailbox: the employer's host. */
  mailHost: string;
}

/**
 * A person in the world. The fold of person.join and person.leave events
 * builds the set of people (REQ-QC-020). A person who left stays in the map,
 * so old journal entries still have a name.
 */
export interface Member {
  org: string;
  person: Person;
  site?: string;
  via: string;
  joined: number;
  left?: number;
}

export type People = ReadonlyMap<string, Member>;

const orgById = (s: Scenario, id: string) => {
  const o = s.orgs.find((x) => x.id === id);
  if (!o) throw new Error(`Organisation "${id}" does not exist.`);
  return o;
};

export function seatOfMember(s: Scenario, id: string, m: Member): Seat {
  const org = orgById(s, m.org);
  const site = m.site ? orgById(s, m.site) : undefined;
  return {
    id,
    org,
    person: m.person,
    site,
    host: hostOf(site ?? org),
    mailHost: hostOf(org),
  };
}

/** The people in the world now, as seats in seat-id order. */
export function seatsIn(s: Scenario, people: People): Seat[] {
  return [...people]
    .filter(([, m]) => m.left === undefined)
    .map(([id, m]) => seatOfMember(s, id, m))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The person.join events that genesis writes for the scenario's people. */
export const scenarioJoins = (s: Scenario) =>
  s.orgs.flatMap((o) =>
    o.people.map((p) => ({
      type: 'person.join' as const,
      seat: seatOf(o, p),
      org: o.id,
      ...(p.site ? { site: p.site } : {}),
      person: p,
      via: 'scenario',
    })),
  );

/**
 * Modes are octal. YAML reads an unquoted `0770` as the decimal number 770,
 * so a number is read back as its octal digits.
 */
export function parseMode(
  m: string | number | undefined,
  fallback: number,
): number {
  if (m === undefined) return fallback;
  const n = Number.parseInt(String(m), 8);
  if (Number.isNaN(n) || n < 0 || n > 0o7777)
    throw new Error(`Mode "${m}" is not a valid octal mode.`);
  return n;
}

export const listYaml = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => f.slice(0, -5))
        .sort()
    : [];
