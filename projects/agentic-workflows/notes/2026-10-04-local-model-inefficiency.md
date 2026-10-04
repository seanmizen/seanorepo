# 2026-10-04 — Why the local model is so slow

On 4 October 2026, one 15-minute turn with six seats took 67 minutes of
real time on Qwen 3.5 4B (abliterated) and a GTX 980 Ti. Almost all of that
time went to reading, not writing. In the turn, the model read 112,943
prompt tokens and wrote 7,245. The model writes 33 tokens a
second, but it reads its prompt at only 24 tokens a second. Each request
sends about 2,500 tokens, so the model reads for about 100 seconds and then
writes for 2 to 4 seconds. The chat API keeps no state, so each step of a
seat sends the full conversation again: the system prompt, the briefing and
every tool result so far. Six seats share one model, and each change of seat
removes the cached prompt, so every request starts again from zero. A step as
small as `whoami` therefore costs about 2 minutes of real time for 0 minutes
of simulated time, and the seats spend their first steps on checks like this.
The slow reading is probably caused by the hybrid layers of Qwen 3.5 on an
old card, but we did not test this.

## Code state

- The run used the live viewer branch: `071aad3a74c93a3e686ad1055e9bf8029a652d30`
  (`SEAN-564/live-viewer`, "[SEAN-564] feat: watch a QuarterCompany run live
  in the viewer", 2026-10-04 14:53 +0100).
- Its parent is the offline model branch:
  `f07762b42102fc7a21ccfe5b98e4471cc7626eb8` (`SEAN-559/offline-local-models`,
  "[SEAN-559] feat: local tier runs Qwen 3.5 4B abliterated", 2026-10-04
  14:02 +0100). This commit sets the `local` tier to
  `huihui_ai/qwen3.5-abliterated:4B`.
- Command: `QC_OFFLINE=1 yarn qc run smoke --turns 1 --watch` in
  `projects/agentic-workflows`, after `yarn qc new smoke --scenario scenario
  --cast local`.

On 2026-10-04, neither commit was on GitHub. A squash merge gives new hashes,
and Git can remove a commit that no branch or tag holds. To keep this state,
add a tag: `git tag notes/2026-10-04-local-model 071aad3`.
