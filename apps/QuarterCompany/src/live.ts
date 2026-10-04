// What happens during a turn, for `qc run --watch` (REQ-QC-035). The events
// are for display only. The journal does not record them, and a run without
// a listener does not make them (REQ-QC-001).

export type LiveEvent =
  | {
      type: 'turn.begin';
      label: string;
      clock: string;
      /** The seats that work in this turn, in seat order. */
      seats: { seat: string; actor: string }[];
    }
  | { type: 'seat.begin'; seat: string; actor: string }
  /** One part of the text that a model writes. */
  | {
      type: 'text';
      seat: string;
      kind: 'content' | 'reasoning' | 'tool';
      text: string;
    }
  | {
      type: 'tool';
      seat: string;
      tool: string;
      args: unknown;
      ok: boolean;
      minutes: number;
      result: string;
    }
  | { type: 'seat.end'; seat: string; note: string }
  | { type: 'model.error'; seat: string; message: string }
  /** The engine wrote the turn to the journal. */
  | { type: 'turn.end'; label: string }
  | { type: 'run.end' };

export type Live = (e: LiveEvent) => void;
