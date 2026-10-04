// World setup at genesis, and mail transport at turn boundaries.
// Both write ordinary journal events through an Ops buffer.
import { formatMessage, splitAddress } from './mail.ts';
import type { Ops } from './ops.ts';
import { expand, type PopMember, scenarioPopulations } from './population.ts';
import {
  hostOf,
  mailHostOf,
  type Org,
  parseMode,
  type Scenario,
  type SystemKind,
  scenarioJoins,
} from './scenario.ts';
import { ensureMailbox } from './tools/mail.ts';
import {
  type Account,
  Directory,
  formatGroup,
  formatPasswd,
  type Group,
} from './users.ts';
import { parentOf } from './vfs.ts';

const ROOT_DIR = { owner: 'root', group: 'root', mode: 0o755 };
const SYSTEM_DIRS: [string, number][] = [
  ['/etc', 0o755],
  ['/home', 0o755],
  ['/srv', 0o755],
  ['/tmp', 0o1777],
  ['/var', 0o755],
  ['/var/log', 0o755],
  ['/var/mail', 0o755],
];

/** The shell of a role mailbox: the account takes mail, but has no shell. */
export const ROLE_SHELL = '/bin/false';

/** The primary group of all population members on a provider host. */
export const MEMBERS_GROUP = { name: 'members', gid: 3000 };

/**
 * Seed one organisation host: system folders, accounts, homes and seed
 * files. A provider host also gets an account for each population member.
 * A member's mailbox appears with the first mail, so genesis stays small.
 * See REQ-QC-022.
 */
export function seedOrg(ops: Ops, c: Org, members: PopMember[] = []) {
  const host = hostOf(c);
  const actor = 'genesis';
  ops.mkdir(actor, host, '/', ROOT_DIR);
  for (const [p, mode] of SYSTEM_DIRS)
    ops.mkdir(actor, host, p, { ...ROOT_DIR, mode });

  const accounts: Account[] = [
    {
      name: 'root',
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: '/bin/sh',
    },
  ];
  const groups: Group[] = [
    { name: 'root', gid: 0, members: [] },
    { name: 'wheel', gid: 10, members: [] },
  ];
  c.groups.forEach((g, i) => {
    groups.push({ name: g, gid: 2001 + i, members: [] });
  });
  let uid = 1000;
  for (const p of c.people) {
    for (const g of p.groups) {
      if (!groups.some((x) => x.name === g))
        throw new Error(
          `${p.user}@${c.domain} names group "${g}". Add it to the company groups.`,
        );
    }
    if (!p.provisioned) continue;
    uid += 1;
    accounts.push({
      name: p.user,
      uid,
      gid: uid,
      gecos: p.name,
      home: `/home/${p.user}`,
      shell: '/bin/sh',
    });
    groups.push({ name: p.user, gid: uid, members: [] });
    for (const g of p.groups)
      groups.find((x) => x.name === g)?.members.push(p.user);
  }
  // A role mailbox takes mail, but no person logs in to it (REQ-QC-027).
  for (const m of c.mailboxes) {
    uid += 1;
    accounts.push({
      name: m,
      uid,
      gid: uid,
      gecos: `${m} mailbox`,
      home: `/home/${m}`,
      shell: ROLE_SHELL,
    });
    groups.push({ name: m, gid: uid, members: [] });
  }
  const own = accounts.filter((x) => x.uid >= 1000);
  if (c.kind === 'provider') {
    groups.push({ ...MEMBERS_GROUP, members: [] });
    members.forEach((m, i) => {
      accounts.push({
        name: m.user,
        uid: 10000 + i,
        gid: MEMBERS_GROUP.gid,
        gecos: m.name,
        home: `/home/${m.user}`,
        shell: '/bin/sh',
      });
    });
  }
  ops.write(actor, host, '/etc/passwd', formatPasswd(accounts), {
    ...ROOT_DIR,
    mode: 0o644,
  });
  ops.write(actor, host, '/etc/group', formatGroup(groups), {
    ...ROOT_DIR,
    mode: 0o644,
  });
  ops.mkdir(actor, host, '/root', { ...ROOT_DIR, mode: 0o700 });
  for (const a of own) {
    ops.mkdir(actor, host, a.home, {
      owner: a.name,
      group: a.name,
      mode: 0o700,
    });
    ensureMailbox(ops, host, a.name, a.name);
  }

  const dir = new Directory(accounts, groups);
  for (const f of c.files) {
    const owner = f.owner;
    if (!dir.account(owner))
      throw new Error(
        `Seed file ${f.path} has owner "${owner}", who has no account at genesis.`,
      );
    const group = f.group ?? dir.primaryGroup(owner);
    ops.mkdirp(actor, host, parentOf(f.path), ROOT_DIR);
    if (f.dir)
      ops.mkdir(actor, host, f.path, {
        owner,
        group,
        mode: parseMode(f.mode, 0o755),
      });
    else
      ops.write(actor, host, f.path, f.content ?? '', {
        owner,
        group,
        mode: parseMode(f.mode, 0o644),
      });
  }
}

/**
 * Genesis: the scenario's people join the world, then each organisation's
 * host gets its folders, accounts and seed files. See REQ-QC-020.
 */
export function seedWorld(ops: Ops, s: Scenario) {
  for (const j of scenarioJoins(s)) ops.emit('genesis', j);
  const pops = scenarioPopulations(s);
  for (const p of pops)
    ops.emit('genesis', { type: 'population.join', ...p, via: 'scenario' });
  const members = expand(pops);
  for (const c of s.orgs) {
    if (c.kind === 'population') continue;
    const mine = pops
      .filter((p) => p.provider === c.id)
      .flatMap((p) => members.get(p.org) ?? []);
    const staff = new Set(c.people.map((p) => p.user));
    const clash = mine.find((m) => staff.has(m.user));
    if (clash)
      throw new Error(
        `Population member "${clash.user}" has the same user name as a person at ${c.name}. Change the person's user name.`,
      );
    seedOrg(ops, c, mine);
  }
}

export interface Envelope {
  id: string;
  hash: string;
  from: string;
  rcpts: string[];
}

export type SystemStatus = Map<string, Set<SystemKind>>;

export interface QueuedMail {
  messageId: string;
  hash: string;
  from: string;
  rcpt: string;
}

const has = (st: SystemStatus, host: string | undefined, kind: SystemKind) =>
  !!host && !!st.get(host)?.has(kind);
/** Why a host cannot send mail now, if it cannot. */
const sendBlock = (st: SystemStatus, host: string | undefined) =>
  has(st, host, 'host.down')
    ? 'the sender host is down'
    : has(st, host, 'mail.down')
      ? 'the sender mail service is down'
      : undefined;
/** Why a host cannot take mail now, if it cannot. */
const receiveBlock = (st: SystemStatus, host: string) =>
  has(st, host, 'host.down')
    ? 'the recipient host is down'
    : has(st, host, 'mail.down')
      ? 'the recipient mail service is down'
      : has(st, host, 'disk.full')
        ? 'the recipient disk is full'
        : undefined;

/**
 * Deliver one message to every recipient. The mail directory gives the host
 * for each domain. A domain that is not in the world bounces: nothing exists
 * outside it (REQ-QC-017). A recipient with no account, or a locked account,
 * bounces. Mail waits in the queue while a system event blocks the sender
 * or the recipient host. See REQ-QC-007.
 */
export function deliver(
  ops: Ops,
  s: Scenario,
  env: Envelope,
  system: SystemStatus,
  bounces = true,
) {
  const sender = mailHostOf(s, splitAddress(env.from).domain);
  for (const rcpt of env.rcpts) {
    const dest = mailHostOf(s, splitAddress(rcpt).domain);
    if (!dest) {
      ops.emit('mta', {
        type: 'mail.bounce',
        messageId: env.id,
        to: rcpt,
        reason: 'no such domain',
      });
      if (bounces) bounce(ops, s, env, rcpt, 'no such domain', system);
      continue;
    }
    const reason =
      sendBlock(system, sender?.host) ?? receiveBlock(system, dest.host);
    if (reason) {
      ops.emit('mta', {
        type: 'mail.queued',
        messageId: env.id,
        hash: env.hash,
        from: env.from,
        rcpt,
        reason,
      });
      continue;
    }
    deliverOne(ops, s, env, rcpt, dest.host, system, bounces);
  }
}

function deliverOne(
  ops: Ops,
  s: Scenario,
  env: Envelope,
  rcpt: string,
  host: string,
  system: SystemStatus,
  bounces: boolean,
) {
  const { local } = splitAddress(rcpt);
  const dir = Directory.load(ops.vfs, ops.objects, host);
  if (!dir.canLogin(local) || local === 'root') {
    const reason = dir.account(local) ? 'account is locked' : 'user unknown';
    ops.emit('mta', {
      type: 'mail.bounce',
      messageId: env.id,
      to: rcpt,
      reason,
    });
    if (bounces) bounce(ops, s, env, rcpt, reason, system);
    return;
  }
  const group = dir.primaryGroup(local);
  ensureMailbox(ops, host, local, group);
  ops.write(
    'mta',
    host,
    `/var/mail/${local}/new/${env.id}.eml`,
    ops.objects.get(env.hash),
    {
      owner: local,
      group,
      mode: 0o600,
    },
  );
}

/** Deliver the queued mail that no system event blocks now, in queue order. */
export function releaseQueue(
  ops: Ops,
  s: Scenario,
  queue: QueuedMail[],
  system: SystemStatus,
): QueuedMail[] {
  const released: QueuedMail[] = [];
  for (const q of queue) {
    const sender = mailHostOf(s, splitAddress(q.from).domain);
    const dest = mailHostOf(s, splitAddress(q.rcpt).domain);
    if (
      !dest ||
      sendBlock(system, sender?.host) ||
      receiveBlock(system, dest.host)
    )
      continue;
    ops.emit('mta', {
      type: 'mail.dequeued',
      messageId: q.messageId,
      rcpt: q.rcpt,
    });
    deliverOne(
      ops,
      s,
      { id: q.messageId, hash: q.hash, from: q.from, rcpts: [q.rcpt] },
      q.rcpt,
      dest.host,
      system,
      true,
    );
    released.push(q);
  }
  return released;
}

function bounce(
  ops: Ops,
  s: Scenario,
  env: Envelope,
  rcpt: string,
  reason: string,
  system: SystemStatus,
) {
  const { domain } = splitAddress(env.from);
  if (!mailHostOf(s, domain)) return;
  const id = `${env.id}.bounce.${rcpt.replace(/[^a-z0-9]/gi, '_')}`;
  const text = formatMessage(
    {
      id,
      from: `MAILER-DAEMON@${domain}`,
      to: [env.from],
      cc: [],
      subject: 'Undelivered Mail Returned to Sender',
      date: '',
      body: `Your message ${env.id} could not be delivered to ${rcpt}: ${reason}.\n\n--- Original message ---\n${ops.objects.get(env.hash)}`,
    },
    domain,
  );
  deliver(
    ops,
    s,
    {
      id,
      hash: ops.objects.put(text),
      from: `MAILER-DAEMON@${domain}`,
      rcpts: [env.from],
    },
    system,
    false,
  );
}
