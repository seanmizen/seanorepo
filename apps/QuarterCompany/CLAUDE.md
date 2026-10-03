# QuarterCompany

Read `README.md` for the design. The requirements are in
`requirements/qc.md`.

## Rules

- QuarterCompany runs on Node with `tsx`, on Linux, macOS or another
  Unix-like system. It does not support Windows, and it does not use Bun. Add
  no platform guard. In WSL, never call a Windows binary (`bun.exe`, `npx`,
  `node.exe`). Use `yarn` scripts, which run the Linux `node`.
- The journal is the only truth (REQ-QC-001). Never read state back from
  `world/` or from git. Change state only through `fs.*` events.
- Never remove an object, a journal file or a run folder (REQ-QC-002).
  `qc new --replace` moves an old run to `runs/.trash/`.
- A new tool goes in `src/tools/` with a minute cost (REQ-QC-009). Never add a
  tool directly to an MCP server or a model adapter (REQ-QC-010).
- A tool checks everything before it emits events. The session also runs each
  tool on a scratch copy, so a failed tool changes nothing (REQ-QC-008).
- Write tool descriptions, error text and model prompts in STE Strict mode.
- Tests and demos use the `script` actor or the fake model server. Do not make
  paid model calls without Sean's approval.

## Commands

```bash
yarn workspace quarter-company test
yarn workspace quarter-company typecheck
```
