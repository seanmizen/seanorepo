// Scenario files: the companies, their people and the seed files. A scenario
// says who exists. It never names a model: that is the cast's job.
// See REQ-QC-006.
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

const Company = z.object({
  name: z.string(),
  domain: z.string(),
  host: z.string(),
  about: z.string().default(''),
  groups: z.array(z.string()).default([]),
  people: z.array(Person),
  files: z.array(SeedFile).default([]),
});
export type Company = z.infer<typeof Company> & { id: string };

const MailInject = z.object({
  from: z.string(),
  to: z.union([z.string(), z.array(z.string())]),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  subject: z.string(),
  body: z.string(),
});
export type MailInject = z.infer<typeof MailInject>;

const Inject = z.object({ at: z.string(), mail: MailInject });
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
  companies: z.array(z.string()),
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
  companies: Company[];
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
  const companies = s.companies.map((id) => ({
    id,
    ...Company.parse(readYaml(join(dir, 'companies', `${id}.yaml`))),
  }));
  const domains = new Set<string>();
  for (const c of companies) {
    if (domains.has(c.domain))
      throw new Error(`Two companies use the domain ${c.domain}.`);
    domains.add(c.domain);
  }
  const scenario: Scenario = {
    dir,
    name: s.name,
    description: s.description,
    calendar,
    turnMinutes: s.turnMinutes ?? calendar.slotMinutes,
    concurrency: s.concurrency,
    companies,
    injects: s.injects,
    compel: s.compel,
  };
  for (const inj of s.injects) checkInjectSender(scenario, inj.mail.from);
  const seats = new Set(seatsOf(scenario).map((x) => x.id));
  for (const c of s.compel) {
    if (!seats.has(c.seat))
      throw new Error(
        `A compel entry names seat ${c.seat}. No company has that person.`,
      );
  }
  return scenario;
}

/**
 * Injected mail comes from outside the simulation. Mail from a person inside
 * it must come from that person's own action: use compel. See REQ-QC-015.
 */
export function checkInjectSender(s: Scenario, from: string) {
  const domain = from.slice(from.lastIndexOf('@') + 1).toLowerCase();
  const company = s.companies.find((c) => c.domain === domain);
  if (company) {
    throw new Error(
      `Mail from ${from} cannot be injected: ${domain} belongs to ${company.name}. Use compel, so that the sender sends the mail and keeps a copy.`,
    );
  }
}

export const hostOf = (c: Company) => `${c.id}/${c.host}`;
export const seatOf = (c: Company, p: Person) => `${p.user}@${c.domain}`;

export interface Seat {
  id: string; // user@domain
  company: Company;
  person: Person;
  host: string;
}

export function seatsOf(s: Scenario): Seat[] {
  return s.companies
    .flatMap((c) =>
      c.people.map((p) => ({
        id: seatOf(c, p),
        company: c,
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
