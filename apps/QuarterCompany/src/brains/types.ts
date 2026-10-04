// A brain decides what a seat does in one turn. It acts only through
// `session.call`. See REQ-QC-005.
import type { Casting, Models } from '../cast.ts';
import type { Session } from '../session.ts';

export interface ModelCallRecord {
  model: string;
  request: unknown;
  response: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Wall-clock milliseconds of the request (REQ-QC-032). */
  ms: number;
}

export interface BrainContext {
  session: Session;
  casting: Casting;
  models: Models;
  system: string;
  briefing: string;
  /** The run folder. Script and external brains read files from it. */
  runDir: string;
  record(call: ModelCallRecord): void;
}

export type Brain = (ctx: BrainContext) => Promise<void>;
