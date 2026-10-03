// World setup at genesis, and mail transport at turn boundaries.
// Both write ordinary journal events through an Ops buffer.
import { formatMessage, INTERNET_HOST, splitAddress } from './mail.ts';
import type { Ops } from './ops.ts';
import {
  type Company,
  hostOf,
  type MailInject,
  parseMode,
  type Scenario,
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

/** Seed one company host: system folders, accounts, homes and seed files. */
export function seedCompany(ops: Ops, c: Company) {
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
  ops.write(actor, host, '/etc/passwd', formatPasswd(accounts), {
    ...ROOT_DIR,
    mode: 0o644,
  });
  ops.write(actor, host, '/etc/group', formatGroup(groups), {
    ...ROOT_DIR,
    mode: 0o644,
  });
  ops.mkdir(actor, host, '/root', { ...ROOT_DIR, mode: 0o700 });
  for (const a of accounts.filter((x) => x.uid >= 1000)) {
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

export function seedWorld(ops: Ops, s: Scenario) {
  for (const c of s.companies) seedCompany(ops, c);
  ops.mkdir('genesis', INTERNET_HOST, '/', ROOT_DIR);
}

export interface Envelope {
  id: string;
  hash: string;
  from: string;
  rcpts: string[];
}

/**
 * Deliver one message to every recipient. A recipient with no account, or a
 * locked account, gets a bounce back to the sender. Mail to a domain outside
 * the simulation goes to the internet host. See REQ-QC-007.
 */
export function deliver(ops: Ops, s: Scenario, env: Envelope, bounces = true) {
  const text = ops.objects.get(env.hash);
  for (const rcpt of env.rcpts) {
    const { local, domain } = splitAddress(rcpt);
    const company = s.companies.find((c) => c.domain === domain);
    if (!company) {
      ops.mkdirp('mta', INTERNET_HOST, `/${rcpt}`, ROOT_DIR);
      ops.write('mta', INTERNET_HOST, `/${rcpt}/${env.id}.eml`, text, {
        ...ROOT_DIR,
        mode: 0o644,
      });
      continue;
    }
    const host = hostOf(company);
    const dir = Directory.load(ops.vfs, ops.objects, host);
    if (!dir.canLogin(local) || local === 'root') {
      const reason = dir.account(local) ? 'account is locked' : 'user unknown';
      ops.emit('mta', {
        type: 'mail.bounce',
        messageId: env.id,
        to: rcpt,
        reason,
      });
      if (bounces) bounce(ops, s, env, rcpt, reason);
      continue;
    }
    const group = dir.primaryGroup(local);
    ensureMailbox(ops, host, local, group);
    ops.write('mta', host, `/var/mail/${local}/new/${env.id}.eml`, text, {
      owner: local,
      group,
      mode: 0o600,
    });
  }
}

function bounce(
  ops: Ops,
  s: Scenario,
  env: Envelope,
  rcpt: string,
  reason: string,
) {
  const { domain } = splitAddress(env.from);
  if (!s.companies.some((c) => c.domain === domain)) return;
  const id = `${env.id}.bounce.${rcpt.replace(/[^a-z0-9]/gi, '_')}`;
  const text = formatMessage(
    {
      id,
      from: `MAILER-DAEMON@${domain}`,
      to: [env.from],
      cc: [],
      subject: `Undelivered Mail Returned to Sender`,
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
    false,
  );
}

/** Mail that the scenario or the director puts into the world. */
export function injectMail(
  ops: Ops,
  s: Scenario,
  label: string,
  clock: string,
  m: MailInject,
  n: number,
  source: 'scenario' | 'director',
) {
  const id = `${label}.inject.${n}`;
  const list = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.toLowerCase());
  const to = list(m.to);
  const cc = list(m.cc);
  const { domain } = splitAddress(m.from);
  const text = formatMessage(
    { id, from: m.from, to, cc, subject: m.subject, date: clock, body: m.body },
    domain || 'invalid',
  );
  const hash = ops.objects.put(text);
  ops.emit('director', {
    type: 'inject',
    kind: 'mail',
    source,
    messageId: id,
    from: m.from,
    to: [...to, ...cc],
    subject: m.subject,
    hash,
  });
  deliver(ops, s, {
    id,
    hash,
    from: m.from,
    rcpts: [...new Set([...to, ...cc])],
  });
}
