// The tool registry. Each tool is defined once. MCP servers and model
// adapters expose the same definitions. See REQ-QC-010.
import { z } from 'zod';
import { type OrgKind, PLACES_PEOPLE } from '../scenario.ts';
import { ADMIN_TOOLS } from './admin.ts';
import { CASE_TOOLS } from './cases.ts';
import type { ToolDef } from './def.ts';
import { MAIL_TOOLS } from './mail.ts';
import { MIND_TOOLS } from './mind.ts';
import { STAFFING_TOOLS } from './staffing.ts';
import { WORKSTATION_TOOLS } from './workstation.ts';

export type { Server, ToolDef } from './def.ts';

export const TOOLS: ToolDef[] = [
  ...WORKSTATION_TOOLS,
  ...MAIL_TOOLS,
  ...MIND_TOOLS,
  ...ADMIN_TOOLS,
  ...STAFFING_TOOLS,
  ...CASE_TOOLS,
];

/**
 * Admin tools appear only for the wheel group. Staffing tools appear only
 * for the staff of an agency or a consultancy (REQ-QC-020). Case tools
 * appear only on a host that has a case system (REQ-QC-026).
 */
export const toolsFor = (
  admin: boolean,
  kind: OrgKind = 'company',
  cases = false,
) =>
  TOOLS.filter(
    (t) =>
      (admin || t.server !== 'admin') &&
      (t.server !== 'staffing' || PLACES_PEOPLE.includes(kind)) &&
      (t.server !== 'cases' || cases),
  );

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
