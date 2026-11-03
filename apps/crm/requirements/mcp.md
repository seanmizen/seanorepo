# REQ-CRM-MCP — The MCP server reads and changes, and never destroys

Claude connects to the crm through the MCP server (`crm-be/src/mcp.ts`). It
reads the crm and changes it as an assistant. The actions that cannot be
undone stay on the crm pages, where the admin does them.

---

## REQ-CRM-MCP-001 — No MCP tool deletes, erases or touches money

- **Status:** active
- **Source:** sean
- **Origin:** #1067
- **Type:** constraint
- **Priority:** P1
- **Statement:** The MCP server shall have no tool that deletes a record,
  erases a person, or makes, changes or refunds a payment.
- **Rationale:** Sean allowed edits through MCP ("you can be my assistant
  and set e.g. calendar invites or edit any of the data"), and the issue
  keeps deletes, GDPR erasure and money in the UI. A tool result can hold
  text that a client typed, for example a note. If that text tells the
  model to do something, the worst result is a wrong value that the admin
  can see in the Activity list and change again. It is never lost data, an
  erased person or a payment. An erasure is a legal act (UK GDPR, Article
  17), so the admin does it on a page.
- **Verification:** Test — `apps/crm/crm-be/src/mcp.test.ts` › "the tools are the reads and the writes, and no tool name matches delete, erase, remove or pay (REQ-CRM-MCP-001)"
- **Relations:** none
