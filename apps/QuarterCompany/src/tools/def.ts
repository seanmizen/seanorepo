// Tool definition types and shared helpers. See REQ-QC-010.
import type { z } from 'zod';
import type { Session } from '../session.ts';

export type Server = 'workstation' | 'mail' | 'admin' | 'mind';

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  server: Server;
  description: string;
  input: S;
  /** Simulated minutes the tool takes. See REQ-QC-009. */
  minutes: (s: Session, args: z.infer<S>) => number;
  run: (s: Session, args: z.infer<S>) => string;
}

export const tool = <S extends z.ZodType>(def: ToolDef<S>): ToolDef =>
  def as unknown as ToolDef;

/** Cost of writing text: 2 minutes, plus 1 minute for each 600 characters, to 10. */
export const writingMinutes = (text: string) =>
  Math.min(10, 2 + Math.ceil(text.length / 600));
/** Cost of reading text: 1 minute, plus 1 minute for each 3000 characters, to 8. */
export const readingMinutes = (size: number) =>
  Math.min(8, 1 + Math.ceil(size / 3000));
