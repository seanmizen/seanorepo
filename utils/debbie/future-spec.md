# debbie fleet — future spec

**This is not a plan of record.** Nothing here is on a schedule or built.
A decision lives here after someone reasons about it and before it earns a
`REQ-`. This file is also the seed for the next debbie generation.

## Built

These decisions are real now. Each one keeps only the reason that stops a bad
idea from coming back.

**A machine is told its roles.** It does not work them out, and it does not
vote. The apps keep SQLite on local Docker volumes, so two public webservers
make two databases that cannot merge. Cloudflare already runs the real
election: the machine with the tunnel credential gets the traffic. See
[Roles](./2026-09-17/README.md#roles). `cloudflared` can run one tunnel from
several replicas, and that suits stateless origins. The
[cutover runbook](./2026-09-17/README.md#move-the-tunnel-from-machine-a-to-machine-b)
runs two connectors for a short, planned overlap. That is fine for a cutover.
As a standing high-availability setup it is wrong.

**USB install, permanently. No PXE.** PXE needs a change to the household DHCP
server. Proxy DHCP (`dnsmasq`) got the same answer, because the objection is to
any change on a shared network. PXE ROMs also need ethernet.

**Roles are flag files.** `ROLE_<NAME>=yes` in
`scripts/3-provision/<machine>.env` sets a role. The invariant is **exactly one
`tunnel`**, because only the tunnel machine's data is public. The names
`provisioner` and `preseeder` stay free for later roles of the same form.

**Every machine tracks `release`.** See REQ-DEPLOY-001 and REQ-DEPLOY-002 in
[`deploy.md`](./2026-09-17/requirements/deploy.md).

## Not built: the herd

The next generation is a herd. Every machine runs the same agent and holds the
same picture of every machine. Any machine can answer for all of them. No
server of ours sits in the middle. Cloudflare is the only hub.

**One agent per machine. Each machine writes only its own record.** The agent
collects its own facts: hostname, boot id, uptime, disk, Docker status,
checkout SHA, declared and actual roles, timer state, and the last failover
action. It gossips that record to the other agents. A record has one writer,
so two agents never disagree about it, and monitoring needs no vote. A machine
that stops answering stays in the picture with the time it was last seen.
**Losing contact with a peer never causes a role change.** A machine keeps its
last roles.

**Machines reach each other over Cloudflare Mesh.** Mesh gives each machine a
private IP in `100.96.0.0/12`. Every packet goes through Cloudflare, so
machines can live in any house or on a VPS with no port forward. Mesh opens no
inbound port, so REQ-SERVER-002 keeps its port list. Gossip listens only on
the Mesh interface. Mesh is in beta. #417 tests it on surface first. If Mesh
fails, the fallback is WireGuard that the agent configures itself. The agent
needs only a peer IP, so the choice of network does not change it.

**The dashboard is `dash.seanmizen.com`, on a second tunnel.** The production
tunnel stays on one machine because of the SQLite data. The herd tunnel has
one hostname, and every machine runs a connector for it. Cloudflare sends each
request to a live connector, so the dashboard survives the loss of any one
machine. Every agent serves the dashboard page itself, on port **4070**.
Cloudflare Access puts a login in front of the hostname, so the agent needs no
auth code. The `dash.` ingress rule sits above the `*.seanmizen.com` wildcard.
**The loudest alarm is more than one machine with the `tunnel` role.**

**Declared roles come from the dashboard.** Sean sets a machine's roles there.
The agents copy that versioned record to every machine. Sean is its only
writer, so it needs no vote either. Role assignment stays out of git, because
a role change in git needs a commit, a poll, and push credentials for the
dashboard. Each machine shows where it differs from its declared roles.

**Phases.** Each phase is useful on its own.

1. The agent and dashboard, served from asus alone.
2. The herd: every machine gossips and serves the dashboard.
3. Declared roles: set in the dashboard, and machines report drift. Nothing
   acts on it yet.
4. Self-provisioning: a machine sets itself up from its declared roles. A new
   machine from the generic USB joins the herd after Sean approves it. Only
   stateless roles act automatically.
5. Automatic failover of the tunnel role. See Parked.

## Parked

**Automatic failover of a stateful role.** Two machines cannot fail over
safely. A majority of two is both machines, so neither can tell a dead peer
from a lost link. If both take the tunnel, the data splits and does not come
back. Failover needs a third voter, the data on the standby before the switch
(Litestream streaming the SQLite WAL), and fencing. Before a stateful role
fails over automatically, answer these questions:

- What fences a superseded machine before it writes?
- What happens during a partition, as a chosen tradeoff?
- Does the data layer still assume one local SQLite writer? If so, the answer
  is fencing, and quorum does not apply.
- How does a human override a wrong answer while it happens?

**A provisioner key.** In a herd, each machine sets itself up from its own
checkout. No machine needs a root key to another. If that changes, the
provisioning machine gets its own dedicated key. Every machine already trusts
one durable admin key,
[`seanorepo-admin.pub`](./2026-09-17/payload/seanorepo-admin.pub).

**systemd targets and slices.** A `custom-role-*.target` per role, a
`custom.target` for the whole stack, and a `custom.slice` with `MemoryMax=`.
Add them when there is a real list of services to group.

## Open questions

- **The agent's language.** Go with HashiCorp's `memberlist` is the
  recommendation: one static binary, no runtime on the host, and mature gossip
  and failure detection.
- **A third machine.** A Raspberry Pi is enough to vote. Without one, phase 5
  stays the manual runbook.

## Open question: backups

A fleet makes the single SQLite writer a clearer single point of loss. On
2026-09-22 the production data survived a wiped machine only because a
migration bundle was on a laptop. Open work: #408.

## What this does not cover

Anything in [`2026-09-17/requirements/`](./2026-09-17/requirements/), which CI
checks. Each generation owns its `requirements/`. A new generation copies the
previous one's and moves the decisions it builds from here into them. The
decision here then becomes a pointer.
