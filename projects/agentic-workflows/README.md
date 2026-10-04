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
| nadia@ledgerline.example | partner | Ledgerline Consulting, a consultancy with host `ll-mail01`. |
| oliver@ledgerline.example | finance | Not in the scenario. Nadia places him at Brindle & Hart on Monday. |

On Monday morning, Priya asks Dave to set up Sophie's account. Graham at
Cartwright Stationers asks Maria for a quote. Priya asks Tom for Q1 revenue.
The scenario makes Priya and Graham send these mails themselves (compel), so
the mails are in their sent folders. From 11:00 to 11:30 the mail server is
down (a system event), so mail waits in the queue.

Priya asks Ledgerline Consulting for a finance consultant. Nadia places
Oliver Grant with `place_person`, so he joins the world during the run. His
mailbox is on `ll-mail01`. Dave makes his account on `bh-mf01`, and Oliver
starts work with Tom on Tuesday.

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

## The recall scenario

`scenario-recall/` is a second scenario, at full scale. Corvel Appliances
recalls its K2 kettle. Halden Home sold it, and 4,000 Halden Home customers
are a population on `postbox.example`. About 1,400 of them own a K2.

| Seat | Organisation | Role |
|---|---|---|
| grace@corvel.example | Corvel Appliances (manufacturer) | Sends the recall notice |
| ruth@haldenhome.example | Halden Home (retailer) | Managing Director |
| kwame@haldenhome.example | Halden Home | IT Administrator |
| jess@haldenhome.example | Halden Home | Customer Service Lead: intake and assignment |
| liam@, aisha@haldenhome.example | Halden Home | Customer Service Advisors |
| marcus@staffline.example | Staffline Recruitment (agency) | Places two temps |
| helen@northgate.example | Northgate CX Consulting (consultancy) | Places three consultants |

The owners write to `support@haldenhome.example`, a role mailbox. Jess
takes the mail into the case system in `/srv/cases` and gives cases to the
team. A reply takes about 5 minutes, so one advisor closes 3 cases in a
turn. An owner with no answer chases after a day, and complains to Ruth
after one more day.

What the scripted run shows:

| Time | Open cases | What happens |
|---|---|---|
| Mon 09:30 | 0 | The radio announces the recall. About 40 emails arrive in each turn. |
| Mon 11:00 | about 200 | Three people close about 7 cases in each turn. |
| Mon 14:15 | about 450 | Jess tells Ruth. Ruth asks Staffline and Northgate for staff. |
| Mon 15:00 | about 500 | Marcus places Zara and Connor. Helen places Ines, Tobias and Mei. |
| Tue 09:00 | about 560 | Kwame makes the five accounts in the support group. |
| Tue 09:45 | about 570 | The peak. Eight people close about 22 cases in each turn. |
| Tue all day | falls | Monday's customers with no answer chase. Each chase goes into the open case. |
| Wed 09:00 | about 220 | The team works the oldest cases first. |
| Wed 12:45 | 0 to 5 | The backlog is clear. Nobody complains to Ruth. |
| Wed 15:45 | 0 to 5 | Helen ends the placements. Kwame locks the consultants' accounts. |

```bash
yarn demo:recall                             # 3 days, about 40 seconds, no model
open runs/recall.html                        # the stats bar shows "Open cases"
yarn qc playback recall --from fy1-q1-d1-t22 --to fy1-q1-d1-t24
ls runs/recall/world/halden/hh-srv01/srv/cases/open/
```

To work the queue yourself from Claude Code, give a seat to the `external`
actor, then serve the case system for that seat:

```bash
yarn qc recast recall --user liam@haldenhome.example --use external
yarn qc mcp-cases recall --seat liam@haldenhome.example
```

Runs go to `runs/`, which git ignores. Each run is its own git repository
with one commit per turn.
