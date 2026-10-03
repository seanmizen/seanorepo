// qc-mail: the seat's mailbox. See REQ-QC-007.
import { z } from 'zod';
import { formatMessage, parseMessage } from '../mail.ts';
import type { Session } from '../session.ts';
import { AccessError } from '../users.ts';
import { readingMinutes, tool, writingMinutes } from './def.ts';

export const mailboxOf = (user: string) => `/var/mail/${user}`;

/** Make the mailbox folders if they are missing. The mail system owns this step. */
export function ensureMailbox(
  s: Session['ops'],
  host: string,
  user: string,
  group: string,
) {
  const meta = { owner: user, group, mode: 0o700 };
  s.mkdirp('mta', host, '/var/mail', {
    owner: 'root',
    group: 'root',
    mode: 0o755,
  });
  for (const sub of ['', '/new', '/cur', '/sent']) {
    const p = `${mailboxOf(user)}${sub}`;
    if (!s.vfs.exists(host, p)) s.mkdir('mta', host, p, meta);
  }
}

function listBox(s: Session, box: 'new' | 'cur') {
  const dir = `${mailboxOf(s.user)}/${box}`;
  if (!s.vfs.exists(s.host, dir)) return [];
  return s.vfs
    .children(s.host, dir)
    .filter((k) => k.name.endsWith('.eml'))
    .map((k) => ({
      box,
      ...parseMessage(
        k.name.slice(0, -4),
        s.ops.read(s.host, `${dir}/${k.name}`) ?? '',
      ),
    }));
}

function findMessage(s: Session, id: string) {
  for (const box of ['new', 'cur'] as const) {
    const p = `${mailboxOf(s.user)}/${box}/${id}.eml`;
    if (s.vfs.exists(s.host, p)) return { box, path: p };
  }
  throw new AccessError(`Message ${id} is not in your mailbox.`);
}

const addresses = z
  .union([z.string(), z.array(z.string())])
  .describe('One address, or a list of addresses.');
const toList = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? v.split(',') : [])
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export const MAIL_TOOLS = [
  tool({
    name: 'list_mail',
    server: 'mail',
    description: 'List the messages in your mailbox. New messages come first.',
    input: z.object({}),
    minutes: () => 1,
    run: (s) => {
      const msgs = [...listBox(s, 'new'), ...listBox(s, 'cur').reverse()];
      if (!msgs.length) return 'Your mailbox is empty.';
      return msgs
        .map(
          (m) =>
            `${m.box === 'new' ? 'NEW ' : '    '}${m.id}  from ${m.from}  "${m.subject}"`,
        )
        .join('\n');
    },
  }),
  tool({
    name: 'read_mail',
    server: 'mail',
    description:
      'Read one message. Give the id that list_mail shows. The message is then marked as read.',
    input: z.object({ id: z.string() }),
    minutes: (s, a) => {
      const { path } = findMessage(s, a.id);
      return readingMinutes(s.vfs.get(s.host, path)?.size ?? 0);
    },
    run: (s, a) => {
      const found = findMessage(s, a.id);
      const text = s.ops.read(s.host, found.path) ?? '';
      if (found.box === 'new') {
        s.ops.emit(s.seat.id, {
          type: 'fs.mv',
          host: s.host,
          from: found.path,
          to: `${mailboxOf(s.user)}/cur/${a.id}.eml`,
        });
      }
      return text;
    },
  }),
  tool({
    name: 'send_mail',
    server: 'mail',
    description:
      'Send an email. The mail system delivers it at the end of this turn. A copy goes to your sent folder.',
    input: z.object({
      to: addresses,
      cc: addresses.optional(),
      subject: z.string(),
      body: z.string(),
    }),
    minutes: (_s, a) => writingMinutes(a.body),
    run: (s, a) => {
      const to = toList(a.to);
      const cc = toList(a.cc);
      if (!to.length)
        throw new AccessError('Give at least one address in "to".');
      const bad = [...to, ...cc].find(
        (x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x),
      );
      if (bad) throw new AccessError(`"${bad}" is not a valid email address.`);
      const id = s.nextMessageId();
      const text = formatMessage(
        {
          id,
          from: s.seat.id,
          to,
          cc,
          subject: a.subject,
          date: s.clock,
          body: a.body,
        },
        s.seat.org.domain,
      );
      ensureMailbox(s.ops, s.host, s.user, s.dir().primaryGroup(s.user));
      s.ops.write(
        s.seat.id,
        s.host,
        `${mailboxOf(s.user)}/sent/${id}.eml`,
        text,
        {
          owner: s.user,
          group: s.dir().primaryGroup(s.user),
          mode: 0o600,
        },
      );
      s.outbox.push({
        id,
        hash: s.objects.put(text),
        from: s.seat.id,
        rcpts: [...new Set([...to, ...cc])],
      });
      s.ops.emit(s.seat.id, {
        type: 'mail.send',
        seat: s.seat.id,
        messageId: id,
        to: [...to, ...cc],
        subject: a.subject,
        hash: s.objects.put(text),
      });
      return `Message ${id} is queued. The mail system delivers it at the end of this turn.`;
    },
  }),
];
