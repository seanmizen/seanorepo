# agentic-workflows

Episode 1 of the agentic automation series. It uses the QuarterCompany
simulator in `apps/QuarterCompany`.

## The scenario

Brindle & Hart Ltd sells office supplies. It has five staff on one host,
`bh-mf01`:

| Seat | Role | Notes |
|---|---|---|
| priya@brindlehart.example | md | Managing Director |
| dave@brindlehart.example | it-admin | The only member of wheel |
| tom@brindlehart.example | finance | Owns `/srv/finance` |
| maria@brindlehart.example | sales | Owns `/srv/sales` |
| sophie@brindlehart.example | sales | Starts on Tuesday. No account at genesis. |
| graham@cartwright-stationers.example | buyer | A customer. Cartwright Stationers is its own organisation, with host `cw-mail01`. |

On Monday morning, Priya asks Dave to set up Sophie's account. Graham at
Cartwright Stationers asks Maria for a quote. Priya asks Tom for Q1 revenue.
The scenario makes Priya and Graham send these mails themselves (compel), so
the mails are in their sent folders. From 11:00 to 11:30 the mail server is
down (a system event), so mail waits in the queue.

## Casts

| Cast | Who plays what |
|---|---|
| `scripted` | Everyone follows `scenario/scripts/demo.yaml`. Free. |
| `budget-it` | IT on the cheap tier, the MD on premium, everyone else standard. |
| `local` | Everyone on a local model through Ollama. |
| `you-are-it` | You play IT through the `qc mcp-worker` server. |

## Commands

```bash
yarn demo                                    # scripted run to Tuesday 09:30
yarn qc playback demo                        # show what happened
yarn qc export demo                          # runs/demo.html: open it in a browser
yarn qc playback demo --seat dave@brindlehart.example --verbose
yarn qc new ep1 --scenario scenario --cast budget-it
yarn qc run ep1 --days 1
yarn qc retake ep1 --from fy1-q1-d1-t2 --cast local
yarn qc cost ep1 --by role
```

Runs go to `runs/`, which git ignores. Each run is its own git repository
with one commit per turn.
