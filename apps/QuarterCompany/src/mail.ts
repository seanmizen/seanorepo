// Mail. A message is a plain RFC 822-style text file. Delivery puts it in
// `/var/mail/<user>/new/` on the recipient's company host, Maildir style.
// Reading moves it to `cur/`. Delivery happens at the turn boundary.
// See REQ-QC-007.

export interface Message {
  id: string; // file name without .eml, for example fy1-q1-d1-t2.3
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  body: string;
}

export const addressList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? v.split(',') : [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function formatMessage(m: Message, domain: string): string {
  const lines = [
    `Message-ID: <${m.id}@${domain}>`,
    `Date: ${m.date}`,
    `From: ${m.from}`,
    `To: ${m.to.join(', ')}`,
  ];
  if (m.cc.length) lines.push(`Cc: ${m.cc.join(', ')}`);
  lines.push(
    `Subject: ${m.subject}`,
    '',
    m.body.endsWith('\n') ? m.body : `${m.body}\n`,
  );
  return lines.join('\n');
}

export function parseMessage(id: string, text: string): Message {
  const split = text.indexOf('\n\n');
  const head = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? '' : text.slice(split + 2);
  const h: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return {
    id,
    from: h.from ?? '',
    to: addressList(h.to),
    cc: addressList(h.cc),
    subject: h.subject ?? '',
    date: h.date ?? '',
    body,
  };
}

export const splitAddress = (addr: string) => {
  const at = addr.lastIndexOf('@');
  return at === -1
    ? { local: addr, domain: '' }
    : { local: addr.slice(0, at), domain: addr.slice(at + 1) };
};

export const INTERNET_HOST = 'internet/mx';
