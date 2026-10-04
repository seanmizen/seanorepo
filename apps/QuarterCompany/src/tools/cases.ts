// qc-cases: a case system, the first business tool group. A case is a text
// file in /srv/cases/open or /srv/cases/closed on the host where the seat
// works. The tools change cases only through fs.* events, so the journal
// stays the only truth (REQ-QC-001). Each tool is defined once, for the
// model adapters and for the MCP servers (REQ-QC-010, REQ-QC-026).
//
// The case system is a service on the host. It acts for a user who can
// write /srv/cases/open, so the IT administrator controls access with the
// group of that folder (REQ-QC-004). The service reads the intake mailbox
// that /srv/cases/config names, and it sends replies from that address
// (REQ-QC-027).
import { z } from 'zod';
import { parseMessage } from '../mail.ts';
import { sha256 } from '../objects.ts';
import type { Session } from '../session.ts';
import { ordOf } from '../time.ts';
import { AccessError, allowed, check } from '../users.ts';
import { readingMinutes, tool, writingMinutes } from './def.ts';
import { mailboxOf, postMessage } from './mail.ts';

export const CASES_ROOT = '/srv/cases';
const OPEN = `${CASES_ROOT}/open`;
const CLOSED = `${CASES_ROOT}/closed`;
const CONFIG = `${CASES_ROOT}/config`;
const CASE_MODE = 0o660;
/** The most messages that one intake call takes. */
const INTAKE_LIMIT = 50;
/** The most cases that one assign call gives out. */
const ASSIGN_LIMIT = 100;
const NOBODY = '-';

export interface CaseHead {
  id: string;
  status: 'open' | 'closed';
  subject: string;
  customer: string;
  assignee: string;
  opened: string;
  updated: string;
  messages: number;
}

interface CaseFile {
  head: CaseHead;
  log: string;
  path: string;
  size: number;
}

const HEAD_KEYS: [keyof CaseHead, string][] = [
  ['id', 'Case'],
  ['status', 'Status'],
  ['subject', 'Subject'],
  ['customer', 'Customer'],
  ['assignee', 'Assignee'],
  ['opened', 'Opened'],
  ['updated', 'Updated'],
  ['messages', 'Messages'],
];

export function formatCase(head: CaseHead, log: string): string {
  const lines = HEAD_KEYS.map(([k, label]) => `${label}: ${head[k]}`);
  return `${lines.join('\n')}\n\n${log.replace(/\n*$/, '\n')}`;
}

/** Parsed cases by object hash. Objects never change, so a cache is safe. */
const parsed = new Map<string, { head: CaseHead; log: string }>();

export function parseCase(text: string): { head: CaseHead; log: string } {
  const split = text.indexOf('\n\n');
  const top = split === -1 ? text : text.slice(0, split);
  const log = split === -1 ? '' : text.slice(split + 2);
  const raw: Record<string, string> = {};
  for (const line of top.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) raw[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    head: {
      id: raw.Case ?? '',
      status: raw.Status === 'closed' ? 'closed' : 'open',
      subject: raw.Subject ?? '',
      customer: raw.Customer ?? '',
      assignee: raw.Assignee ?? NOBODY,
      opened: raw.Opened ?? '',
      updated: raw.Updated ?? '',
      messages: Number(raw.Messages ?? 0) || 0,
    },
    log,
  };
}

const entry = (when: string, what: string, text: string) =>
  `== ${when} · ${what}\n${text.replace(/\n*$/, '\n')}\n`;

/**
 * Check that the seat can use the case system on its work host, and read
 * the settings. The service acts for the seat, so the seat must be able to
 * write the folder of open cases. See REQ-QC-004 and REQ-QC-026.
 */
function system(s: Session): { intake?: string } {
  if (!s.vfs.exists(s.host, OPEN) || !s.vfs.exists(s.host, CLOSED))
    throw new AccessError(
      `This host has no case system. The folders ${OPEN} and ${CLOSED} do not exist.`,
    );
  for (const dir of [OPEN, CLOSED]) {
    check(s.vfs, s.dir(), s.host, s.user, dir, 'w');
    check(s.vfs, s.dir(), s.host, s.user, dir, 'x');
  }
  const out: { intake?: string } = {};
  for (const line of (s.ops.read(s.host, CONFIG) ?? '').split('\n')) {
    const m = line.match(/^\s*intake\s*:\s*([a-z][a-z0-9_-]*)\s*$/);
    if (m) out.intake = m[1];
  }
  return out;
}

/** The cases in one folder. */
function casesIn(s: Session, dir: string): CaseFile[] {
  const out: CaseFile[] = [];
  for (const { name, node } of s.vfs.children(s.host, dir)) {
    if (node.kind !== 'file' || !node.hash || !name.endsWith('.case')) continue;
    let p = parsed.get(node.hash);
    if (!p) {
      p = parseCase(s.objects.get(node.hash));
      if (parsed.size > 50_000) parsed.clear();
      parsed.set(node.hash, p);
    }
    out.push({ ...p, path: `${dir}/${name}`, size: node.size ?? 0 });
  }
  return out;
}

/** Oldest first: by the turn that opened the case, then by id. */
function oldestFirst(s: Session, list: CaseFile[]): CaseFile[] {
  const cal = s.scenario.calendar;
  const ord = (c: CaseFile) => {
    try {
      return ordOf(c.head.opened, cal);
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  };
  return list
    .map((c) => ({ c, o: ord(c) }))
    .sort((a, b) => a.o - b.o || (a.c.head.id < b.c.head.id ? -1 : 1))
    .map((x) => x.c);
}

const normId = (id: string) => id.trim().toUpperCase();

/** One case by id, open or closed. */
function findCase(s: Session, id: string): CaseFile {
  const want = normId(id);
  for (const dir of [OPEN, CLOSED]) {
    const p = `${dir}/${want}.case`;
    if (s.vfs.exists(s.host, p))
      return casesIn(s, dir).find((c) => c.path === p) as CaseFile;
  }
  throw new AccessError(`Case ${want} does not exist.`);
}

/** The case that `id` names, or the oldest open case of the seat. */
function targetCase(s: Session, id: string | undefined): CaseFile {
  if (id) return findCase(s, id);
  const mine = oldestFirst(
    s,
    casesIn(s, OPEN).filter((c) => c.head.assignee === s.user),
  );
  if (!mine.length)
    throw new AccessError(
      'You have no open cases. Use case_assign to take a case, or give an id.',
    );
  return mine[0];
}

/** A new case id that no case on the host has. */
function newId(s: Session, source: string): string {
  const base = `C-${sha256(source).slice(0, 8).toUpperCase()}`;
  let id = base;
  for (let n = 2; ; n++) {
    if (
      !s.vfs.exists(s.host, `${OPEN}/${id}.case`) &&
      !s.vfs.exists(s.host, `${CLOSED}/${id}.case`)
    )
      return id;
    id = `${base}-${n}`;
  }
}

function save(s: Session, c: { head: CaseHead; log: string }, dir: string) {
  s.ops.write(
    s.seat.id,
    s.host,
    `${dir}/${c.head.id}.case`,
    formatCase(c.head, c.log),
    {
      owner: s.user,
      group: s.vfs.get(s.host, dir)?.group ?? s.dir().primaryGroup(s.user),
      mode: CASE_MODE,
    },
  );
}

/**
 * Send a reply to the customer of a case. The service sends it from the
 * intake address of the organisation that owns the host, with the seat's
 * name in the signature. A copy goes to the sent folder of the intake
 * mailbox. See REQ-QC-027.
 */
function reply(s: Session, c: CaseHead, text: string): string {
  const { intake } = system(s);
  if (!intake)
    throw new AccessError(
      `The case system has no intake mailbox, so it cannot send a reply. Root must add the line "intake: <user>" to ${CONFIG}.`,
    );
  const org = s.seat.site ?? s.seat.org;
  const subject = /^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`;
  return postMessage(s, {
    from: `${intake}@${org.domain}`,
    domain: org.domain,
    host: s.host,
    user: intake,
    to: [c.customer],
    cc: [],
    subject,
    body: `${text.replace(/\n*$/, '')}\n\n${s.seat.person.name}\n${org.name} customer service\nCase ${c.id}\n`,
  });
}

/** New messages in the intake mailbox, oldest first. */
function intakeQueue(s: Session, intake: string) {
  const dir = `${mailboxOf(intake)}/new`;
  if (!s.vfs.exists(s.host, dir)) return [];
  return s.vfs
    .children(s.host, dir)
    .filter((k) => k.node.kind === 'file' && k.name.endsWith('.eml'))
    .sort((a, b) => a.node.mtime - b.node.mtime || (a.name < b.name ? -1 : 1))
    .map((k) => ({ name: k.name, path: `${dir}/${k.name}` }));
}

function intakeOf(s: Session): string {
  const { intake } = system(s);
  if (!intake)
    throw new AccessError(
      `The case system has no intake mailbox. Root must add the line "intake: <user>" to ${CONFIG}.`,
    );
  return intake;
}

const assignees = z
  .union([z.string(), z.array(z.string()).min(1)])
  .describe('One user name, or a list of user names on this host.');
const userList = (v: string | string[]) =>
  (Array.isArray(v) ? v : [v]).map((u) => u.trim()).filter(Boolean);

const caseId = z
  .string()
  .min(1)
  .describe('The case id, for example C-1A2B3C4D.');

const row = (c: CaseHead) =>
  `${c.id.padEnd(12)} ${c.opened.padEnd(15)} ${c.assignee.padEnd(10)} ${String(c.messages).padStart(2)}  ${c.customer}  "${c.subject}"`;

export const CASE_TOOLS = [
  tool({
    name: 'case_list',
    server: 'cases',
    description:
      'List cases, oldest first. The first line gives the number of open cases, unassigned cases and your cases. Each row shows id, opened turn, assignee, number of messages, customer and subject.',
    input: z.object({
      status: z.enum(['open', 'closed']).default('open'),
      assignee: z
        .string()
        .optional()
        .describe(
          'A user name. Use "me" for your cases. Use "none" for unassigned cases.',
        ),
      limit: z.number().int().min(1).max(200).default(20),
    }),
    minutes: () => 1,
    run: (s, a) => {
      system(s);
      const open = casesIn(s, OPEN);
      const unassigned = open.filter((c) => c.head.assignee === NOBODY).length;
      const mine = open.filter((c) => c.head.assignee === s.user).length;
      const who =
        a.assignee === 'me'
          ? s.user
          : a.assignee === 'none'
            ? NOBODY
            : a.assignee;
      const list = oldestFirst(
        s,
        (a.status === 'open' ? open : casesIn(s, CLOSED)).filter(
          (c) => who === undefined || c.head.assignee === who,
        ),
      );
      const top = `Open cases: ${open.length}. Unassigned: ${unassigned}. Yours: ${mine}.`;
      if (!list.length) return `${top}\nNo ${a.status} cases match.`;
      const shown = list.slice(0, a.limit);
      return [
        top,
        `Showing ${shown.length} of ${list.length} ${a.status} cases:`,
        ...shown.map((c) => row(c.head)),
      ].join('\n');
    },
  }),
  tool({
    name: 'case_show',
    server: 'cases',
    description:
      'Read one case: the header and every message and note. With no id, this shows your oldest open case.',
    input: z.object({ id: caseId.optional() }),
    minutes: (s, a) => readingMinutes(targetCase(s, a.id).size),
    run: (s, a) => {
      system(s);
      const c = targetCase(s, a.id);
      return formatCase(c.head, c.log);
    },
  }),
  tool({
    name: 'case_intake',
    server: 'cases',
    description: `Make cases from the new messages in the intake mailbox, oldest first. A message from a customer who has an open case goes into that case. Each message moves to the "cur" folder of the intake mailbox. The cost is 1 minute, plus 1 minute for each 10 messages. One call takes at most ${INTAKE_LIMIT} messages.`,
    input: z.object({
      limit: z.number().int().min(1).max(INTAKE_LIMIT).default(INTAKE_LIMIT),
    }),
    minutes: (s, a) =>
      1 + Math.ceil(Math.min(a.limit, intakeQueue(s, intakeOf(s)).length) / 10),
    run: (s, a) => {
      const intake = intakeOf(s);
      const queue = intakeQueue(s, intake).slice(0, a.limit);
      if (!queue.length)
        return `The intake mailbox ${intake} has no new messages.`;
      // Open cases by customer, so a chase goes into the first case.
      const byCustomer = new Map<string, { head: CaseHead; log: string }>();
      for (const c of oldestFirst(s, casesIn(s, OPEN)))
        if (!byCustomer.has(c.head.customer))
          byCustomer.set(c.head.customer, { head: c.head, log: c.log });
      const changed = new Map<string, { head: CaseHead; log: string }>();
      let opened = 0;
      let added = 0;
      for (const q of queue) {
        const msgId = q.name.slice(0, -4);
        const m = parseMessage(msgId, s.ops.read(s.host, q.path) ?? '');
        const customer = m.from.toLowerCase();
        const text = entry(
          s.label,
          `mail from ${customer} · "${m.subject}"`,
          m.body,
        );
        const cur = byCustomer.get(customer);
        let c: { head: CaseHead; log: string };
        if (cur) {
          c = {
            head: {
              ...cur.head,
              updated: s.label,
              messages: cur.head.messages + 1,
            },
            log: cur.log + text,
          };
          added += 1;
        } else {
          c = {
            head: {
              id: newId(s, `${s.host}:${msgId}`),
              status: 'open',
              subject: m.subject || '(no subject)',
              customer,
              assignee: NOBODY,
              opened: s.label,
              updated: s.label,
              messages: 1,
            },
            log: text,
          };
          opened += 1;
        }
        byCustomer.set(customer, c);
        changed.set(c.head.id, c);
        // The service files the message: it acts as root on the mailbox.
        s.ops.emit(s.seat.id, {
          type: 'fs.mv',
          host: s.host,
          from: q.path,
          to: `${mailboxOf(intake)}/cur/${q.name}`,
        });
      }
      // A write replaces the whole file, so each case is written once.
      for (const c of changed.values()) save(s, c, OPEN);
      const left = intakeQueue(s, intake).length;
      return `Took ${queue.length} messages from ${intake}: ${opened} new cases, ${added} messages added to open cases. ${left} new messages are left in the intake mailbox.`;
    },
  }),
  tool({
    name: 'case_open',
    server: 'cases',
    description:
      'Open a case by hand, for example for a complaint that came to your own mailbox. The case has no assignee.',
    input: z.object({
      customer: z.string().describe('The email address of the customer.'),
      subject: z.string().min(1),
      note: z.string().min(1).describe('What the customer wants.'),
    }),
    minutes: (_s, a) => writingMinutes(a.note),
    run: (s, a) => {
      system(s);
      const customer = a.customer.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer))
        throw new AccessError(`"${a.customer}" is not a valid email address.`);
      const id = newId(
        s,
        `${s.host}:${s.label}:${s.user}:${customer}:${a.subject}`,
      );
      save(
        s,
        {
          head: {
            id,
            status: 'open',
            subject: a.subject,
            customer,
            assignee: NOBODY,
            opened: s.label,
            updated: s.label,
            messages: 0,
          },
          log: entry(s.label, `opened by ${s.user}`, a.note),
        },
        OPEN,
      );
      return `Opened case ${id} for ${customer}.`;
    },
  }),
  tool({
    name: 'case_assign',
    server: 'cases',
    description: [
      'Give open cases to people.',
      'With an id, this gives that case to one person.',
      'With no id, this gives the "count" oldest unassigned cases to the people in "to", in turn.',
      'Each person must be able to use the case system on this host.',
      'The cost is 1 minute, plus 1 minute for each 10 more cases.',
    ].join(' '),
    input: z.object({
      id: caseId.optional(),
      to: assignees,
      count: z.number().int().min(1).max(ASSIGN_LIMIT).default(1),
    }),
    minutes: (_s, a) => (a.id ? 1 : 1 + Math.floor((a.count - 1) / 10)),
    run: (s, a) => {
      system(s);
      const users = userList(a.to);
      if (!users.length)
        throw new AccessError('Give at least one user in "to".');
      const open = s.vfs.get(s.host, OPEN);
      for (const u of users) {
        if (!s.dir().canLogin(u))
          throw new AccessError(
            `${u} has no account that can log in on this host.`,
          );
        if (!open || !allowed(s.dir(), u, open, 'w'))
          throw new AccessError(
            `${u} cannot use the case system. Ask the IT administrator to give ${u} the group "${open?.group}".`,
          );
      }
      let picked: CaseFile[];
      if (a.id) {
        if (users.length !== 1)
          throw new AccessError('With an id, give exactly one user in "to".');
        const c = findCase(s, a.id);
        if (c.head.status !== 'open')
          throw new AccessError(`Case ${c.head.id} is closed.`);
        picked = [c];
      } else {
        picked = oldestFirst(
          s,
          casesIn(s, OPEN).filter((c) => c.head.assignee === NOBODY),
        ).slice(0, a.count);
        if (!picked.length) return 'No open case is unassigned.';
      }
      const given = new Map<string, number>();
      picked.forEach((c, i) => {
        const u = users[i % users.length];
        given.set(u, (given.get(u) ?? 0) + 1);
        save(
          s,
          {
            head: { ...c.head, assignee: u, updated: s.label },
            log: c.log + entry(s.label, `assigned to ${u} by ${s.user}`, ''),
          },
          OPEN,
        );
      });
      return `Assigned ${picked.length} cases: ${[...given].map(([u, n]) => `${n} to ${u}`).join(', ')}.`;
    },
  }),
  tool({
    name: 'case_update',
    server: 'cases',
    description:
      'Add a note to an open case. With "reply", the case system also sends that text to the customer from the intake address. The customer then counts as answered.',
    input: z.object({
      id: caseId,
      note: z.string().default(''),
      reply: z.string().optional(),
    }),
    minutes: (_s, a) => writingMinutes(`${a.note}${a.reply ?? ''}`),
    run: (s, a) => {
      system(s);
      if (!a.note.trim() && !a.reply?.trim())
        throw new AccessError('Give a note, a reply, or both.');
      const c = findCase(s, a.id);
      if (c.head.status !== 'open')
        throw new AccessError(`Case ${c.head.id} is closed.`);
      let log = c.log;
      if (a.note.trim()) log += entry(s.label, `note by ${s.user}`, a.note);
      let sent = '';
      if (a.reply?.trim()) {
        const msg = reply(s, c.head, a.reply);
        log += entry(s.label, `reply by ${s.user} · message ${msg}`, a.reply);
        sent = ` Reply ${msg} goes to ${c.head.customer} at the end of this turn.`;
      }
      save(s, { head: { ...c.head, updated: s.label }, log }, OPEN);
      return `Updated case ${c.head.id}.${sent}`;
    },
  }),
  tool({
    name: 'case_close',
    server: 'cases',
    description: [
      'Close an open case. With no id, this closes your oldest open case.',
      'With "reply", the case system also sends that text to the customer from the intake address.',
      'The cost includes reading the case.',
    ].join(' '),
    input: z.object({
      id: caseId.optional(),
      resolution: z
        .string()
        .min(1)
        .describe('How the case ended, in a few words.'),
      reply: z.string().optional(),
    }),
    minutes: (s, a) =>
      readingMinutes(targetCase(s, a.id).size) +
      (a.reply ? writingMinutes(a.reply) : 1),
    run: (s, a) => {
      system(s);
      const c = targetCase(s, a.id);
      if (c.head.status !== 'open')
        throw new AccessError(`Case ${c.head.id} is closed.`);
      let log = c.log;
      let sent = '';
      if (a.reply?.trim()) {
        const msg = reply(s, c.head, a.reply);
        log += entry(s.label, `reply by ${s.user} · message ${msg}`, a.reply);
        sent = ` Reply ${msg} goes to ${c.head.customer} at the end of this turn.`;
      }
      log += entry(s.label, `closed by ${s.user}`, a.resolution);
      s.ops.emit(s.seat.id, {
        type: 'fs.mv',
        host: s.host,
        from: c.path,
        to: `${CLOSED}/${c.head.id}.case`,
      });
      save(
        s,
        { head: { ...c.head, status: 'closed', updated: s.label }, log },
        CLOSED,
      );
      return `Closed case ${c.head.id}.${sent}`;
    },
  }),
];
