// The tool registry. Each tool is defined once. MCP servers and model
// adapters expose the same definitions. See REQ-QC-010.
import { z } from 'zod';
import { ADMIN_TOOLS } from './admin.ts';
import type { ToolDef } from './def.ts';
import { MAIL_TOOLS } from './mail.ts';
import { WORKSTATION_TOOLS } from './workstation.ts';

export type { Server, ToolDef } from './def.ts';

export const TOOLS: ToolDef[] = [
  ...WORKSTATION_TOOLS,
  ...MAIL_TOOLS,
  ...ADMIN_TOOLS,
];

export const toolsFor = (admin: boolean) =>
  TOOLS.filter((t) => admin || t.server !== 'admin');

export interface JsonTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function jsonSchemaOf(t: ToolDef): JsonTool {
  const schema = z.toJSONSchema(t.input, { io: 'input' }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return { name: t.name, description: t.description, input_schema: schema };
}
