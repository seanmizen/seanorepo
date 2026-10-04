// qc-staffing: placement tools for the staff of an agency or a consultancy.
// A person joins the world only through an action of a person in the world,
// so the journal records who placed whom (REQ-QC-020, REQ-QC-021).
import { z } from 'zod';
import type { Session } from '../session.ts';
import { AccessError } from '../users.ts';
import { addUser, username } from './admin.ts';
import { tool } from './def.ts';

function clientOf(s: Session, domain: string) {
  const client = s.scenario.orgs.find(
    (o) => o.domain === domain.trim().toLowerCase(),
  );
  if (!client)
    throw new AccessError(
      `No organisation in the world has the domain "${domain}".`,
    );
  if (client.id === s.seat.org.id)
    throw new AccessError(
      'The client must be a different organisation from your organisation.',
    );
  return client;
}

export const STAFFING_TOOLS = [
  tool({
    name: 'place_person',
    server: 'staffing',
    description: [
      'Place a new person at a client organisation. The person joins at the end of this turn.',
      'If your organisation is an agency, the person becomes an employee of the client. The address is <username>@<client domain>.',
      'If your organisation is a consultancy, the person becomes a consultant of your organisation and works on the client host. The address is <username>@<your domain>. The mailbox is on your host.',
      'The person cannot work until the client IT administrator makes an account on the client host. Send mail to the client to ask for the account.',
    ].join(' '),
    input: z.object({
      client: z
        .string()
        .describe('The mail domain of the client, for example "acme.example".'),
      username,
      full_name: z.string().min(1),
      role: z
        .string()
        .min(1)
        .describe('The job role, for example "sales" or "developer".'),
      title: z.string().min(1).describe('The job title.'),
      persona: z
        .string()
        .default('')
        .describe('Who the person is, in one or two sentences.'),
    }),
    minutes: () => 5,
    run: (s, a) => {
      const own = s.seat.org;
      const client = clientOf(s, a.client);
      const consultant = own.kind === 'consultancy';
      const employer = consultant ? own : client;
      const seat = `${a.username}@${employer.domain}`;
      const cur = s.people.get(seat);
      if (cur && cur.left === undefined)
        throw new AccessError(`A person with the address ${seat} exists.`);
      // A consultancy is the employer: its own system makes the account and
      // the mailbox on its own host at once (REQ-QC-021).
      if (consultant) addUser(s, s.mailHost, a.username, a.full_name, []);
      const site = consultant ? { site: client.id } : {};
      const person = {
        user: a.username,
        name: a.full_name,
        role: a.role,
        title: a.title,
        persona: a.persona,
        groups: [],
        provisioned: consultant,
      };
      s.ops.emit(s.seat.id, {
        type: 'person.join',
        seat,
        org: employer.id,
        ...site,
        person,
        via: s.seat.id,
      });
      s.people.set(seat, {
        org: employer.id,
        person,
        ...site,
        via: s.seat.id,
        joined: s.ops.ord,
      });
      return consultant
        ? `${a.full_name} joins ${own.name} as ${seat}, on contract at ${client.name}. The mailbox is on ${own.host}. The ${client.name} IT administrator must make the account "${a.username}" on ${client.host}.`
        : `${a.full_name} joins ${client.name} as ${seat}. The ${client.name} IT administrator must make the account "${a.username}" on ${client.host}.`;
    },
  }),
  tool({
    name: 'end_placement',
    server: 'staffing',
    description:
      'End the placement of a person that your organisation placed. The person leaves the world at the end of this turn. The accounts stay. The client IT administrator must lock them.',
    input: z.object({
      address: z.string().describe('The address of the person.'),
    }),
    minutes: () => 3,
    run: (s, a) => {
      const seat = a.address.trim().toLowerCase();
      const cur = s.people.get(seat);
      if (!cur || cur.left !== undefined)
        throw new AccessError(
          `No person with the address ${seat} is in the world.`,
        );
      if (cur.via.split('@')[1] !== s.seat.org.domain)
        throw new AccessError(
          `Your organisation did not place ${seat}. You cannot end the placement.`,
        );
      s.ops.emit(s.seat.id, { type: 'person.leave', seat, via: s.seat.id });
      s.people.set(seat, { ...cur, left: s.ops.ord });
      return `The placement of ${seat} ends at the end of this turn.`;
    },
  }),
];
