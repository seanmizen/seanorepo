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

## Not built

**Control-plane state in SQLite on the provisioner.** Machines poll the control
plane. One endpoint takes the heartbeat and returns the declared roles. This is
the pull pattern of REQ-DEPLOY-002, so no machine opens an inbound port. **An
unreachable control plane never causes a role change.** The machine keeps its
last roles. Role assignment stays out of git, because a role change in git
needs a commit, a poll, and push credentials for the dashboard.

**Heartbeat and dashboard first, read-only.** Build this before any role
machinery. It makes machine state visible before anything changes it. It serves
`dash.seanmizen.com` on ports **4070** (FE) and **4071** (BE). The heartbeat
sends hostname, boot id, uptime, disk, Docker status, checkout SHA, and declared
roles against actual roles. **The loudest alarm is more than one machine with
the `tunnel` role.**

**The provisioner gets its own keypair.** An always-on machine with a root key
to every machine is a lateral-movement hub. Its blast radius must fit in one
sentence. Every machine already trusts one durable admin key,
[`seanorepo-admin.pub`](./2026-09-17/payload/seanorepo-admin.pub). The
provisioner key is a second, dedicated key.

## Parked

**Automatic role negotiation.** Declared roles come first, because negotiation
needs a place to write its answer and a way to override it. A wrong answer for
a stateless role costs a retry. A wrong answer for a stateful role loses data.
Before a stateful role negotiates, answer these questions:

- What fences a superseded machine before it writes?
- What happens during a partition, as a chosen tradeoff?
- Does the data layer still assume one local SQLite writer? If so, the answer
  is fencing, and quorum does not apply.
- How does a human override a wrong answer while it happens?

**systemd targets and slices.** A `custom-role-*.target` per role, a
`custom.target` for the whole stack, and a `custom.slice` with `MemoryMax=`.
Add them when there is a real list of services to group.

## Open question: backups

A fleet makes the single SQLite writer a clearer single point of loss. On
2026-09-22 the production data survived a wiped machine only because a
migration bundle was on a laptop. Open work: #408.

## What this does not cover

Anything in [`2026-09-17/requirements/`](./2026-09-17/requirements/), which CI
checks. Each generation owns its `requirements/`. A new generation copies the
previous one's and moves the decisions it builds from here into them. The
decision here then becomes a pointer.
