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
 * Kinds of organisation. Only `company` exists now. `population` (many
 * generated people) and `provider` (hosts other people's mailboxes) follow.
 */
const ORG_KINDS = ['company'] as const;

const Org = z.object({
  kind: z.enum(ORG_KINDS).default('company'),
  name: z.string(),
  domain: z.string(),
  host: z.string(),
  about: z.string().default(''),
  groups: z.array(z.string()).default([]),
  people: z.array(Person),
  files: z.array(SeedFile).default([]),
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
  const domains = new Set<string>();
  for (const c of orgs) {
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
  const seats = new Set(seatsOf(scenario).map((x) => x.id));
  for (const c of s.compel) {
    if (!seats.has(c.seat))
      throw new Error(
        `A compel entry names seat ${c.seat}. No organisation has that person.`,
      );
  }
  return scenario;
}

/** Check that a system event names a real organisation and real turns. */
export function checkInject(s: Scenario, inj: Inject) {
  if (!s.orgs.some((o) => o.id === inj.org)) {
    throw new Error(
      `A system event names organisation "${inj.org}". The scenario has no such organisation.`,
    );
  }
}

/** The mail directory: the host that holds the mailboxes of a domain. */
export function mailHostOf(
  s: Scenario,
  domain: string,
): { org: Org; host: string } | undefined {
  const org = s.orgs.find((o) => o.domain === domain.toLowerCase());
  return org ? { org, host: hostOf(org) } : undefined;
}

export const hostOf = (c: Org) => `${c.id}/${c.host}`;
export const seatOf = (c: Org, p: Person) => `${p.user}@${c.domain}`;

export interface Seat {
  id: string; // user@domain
  org: Org;
  person: Person;
  host: string;
}

export function seatsOf(s: Scenario): Seat[] {
  return s.orgs
    .flatMap((c) =>
      c.people.map((p) => ({
        id: seatOf(c, p),
        org: c,
        person: p,
        host: hostOf(c),
      })),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

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
