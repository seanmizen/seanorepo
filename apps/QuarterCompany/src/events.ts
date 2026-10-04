// The journal event vocabulary. See REQ-QC-001.
//
// StateEvent changes state: the filesystem, seat memory, casts, system events
// and the mail queue. A thought changes the seat's memory, never the world
// (REQ-QC-014). InfoEvent records what happened, for playback and cost.
// The other events record what happened, for playback and cost reports.

import type { Person } from './scenario.ts';

export interface Meta {
  owner: string;
  group: string;
  mode: number;
}

export type StateEvent =
  | ({ type: 'fs.mkdir'; host: string; path: string } & Meta)
  | ({
      type: 'fs.write';
      host: string;
      path: string;
      hash: string;
      size: number;
    } & Meta)
  | { type: 'fs.rm'; host: string; path: string }
  | { type: 'fs.mv'; host: string; from: string; to: string }
  | ({ type: 'fs.meta'; host: string; path: string } & Partial<Meta>)
  | { type: 'seat.end'; seat: string; note: string; wake: Wake }
  | { type: 'seat.skip'; seat: string; reason: string }
  | { type: 'cast.rule'; rule: unknown }
  | { type: 'thought'; seat: string; text: string }
  | {
      type: 'system.start';
      kind: 'host.down' | 'mail.down' | 'disk.full';
      org: string;
      host: string;
      note: string;
      source: 'scenario' | 'director';
    }
  | {
      type: 'system.end';
      kind: 'host.down' | 'mail.down' | 'disk.full';
      org: string;
      host: string;
    }
  | {
      type: 'mail.queued';
      messageId: string;
      hash: string;
      from: string;
      rcpt: string;
      reason: string;
    }
  | { type: 'mail.dequeued'; messageId: string; rcpt: string }
  | {
      /**
       * A person joins an organisation. Genesis writes one for each person in
       * the scenario. A placement tool writes one during a run. See REQ-QC-020.
       */
      type: 'person.join';
      seat: string;
      /** The employer. The mailbox is on this organisation's host. */
      org: string;
      /** For a consultant: the client organisation, where the seat works. */
      site?: string;
      person: Person;
      /** "scenario", or the seat id that made the placement. */
      via: string;
    }
  | { type: 'person.leave'; seat: string; via: string };

export type Wake = 'next_turn' | 'on_mail';

export type InfoEvent =
  | { type: 'turn.start'; label: string; clock: string }
  | { type: 'turn.end'; label: string }
  | {
      type: 'tool.call';
      seat: string;
      /** Set when the scenario or the director made the seat do this. */
      compelled?: 'scenario' | 'director';
      tool: string;
      args: unknown;
      ok: boolean;
      minutes: number;
      result: string;
    }
  | {
      type: 'model.call';
      seat: string;
      actor: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      request: string; // object hash
      response: string; // object hash
    }
  | { type: 'model.error'; seat: string; actor: string; message: string }
  | {
      type: 'fs.conflict';
      seat: string;
      op: string;
      path: string;
      reason: string;
    }
  | {
      type: 'mail.send';
      seat: string;
      messageId: string;
      to: string[];
      subject: string;
      hash?: string; // object hash of the message text
    }
  | { type: 'mail.bounce'; messageId: string; to: string; reason: string }
  | { type: 'security'; seat: string; message: string }
  | { type: 'seat.blocked'; seat: string; reason: string }
  | { type: 'compel.skipped'; seat: string; reason: string };

export type EventBody = StateEvent | InfoEvent;

export type JournalEvent = EventBody & {
  seq: number;
  turn: string;
  ord: number;
  actor: string;
};
