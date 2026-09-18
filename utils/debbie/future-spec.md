# debbie fleet — future spec

**This is not a plan of record.** Nothing here is committed to, scheduled, or
implemented. It is where a decision lives after it has been reasoned about and
before it has earned a `REQ-` in [`requirements/`](./requirements/). Some of it
will become requirements. Some will be thrown away. The value is that neither
outcome requires re-deriving the argument.

Origin: #304, from the architecture conversation on 2026-09-18, immediately
after the deploy chain (#276 → #277 → #278 → #279 → #280) landed.

---

## The problem

`debbie` is one machine. It is about to be several: a box that provisions the
others, a box that serves the websites, and boxes that *could* serve the
websites but do not. They sit on a normal home wifi network shared with people
who are not running a datacentre and did not agree to one.

Three things have to be decided that a single machine never had to answer: who
does what, who decides, and how anyone can see the answer.

---

## Shape

**Control plane and data plane, in a star.** Machines talk to one control plane
and never to each other. There is no gossip, no membership protocol and no peer
awareness, because peer awareness only earns its keep if peers make decisions
about each other — and they do not (see *Parked*, below).

**Capability is not activation.** Every machine is *able* to run the web stack.
One actually does. That split already exists in the current provisioning without
having been designed for it: Docker (#276), Node 20 and Yarn 4 (#277) and the
`release` checkout (#278) are installed on any box that runs `postinstall.sh`,
with nothing role-specific about them. Roles are a thin activation layer on top.
No rework of what landed today is implied.

---

## Decided

### 1. Roles are declared, not negotiated

A machine is told what it is. It does not work it out, and it does not vote.

The reason is not that consensus is hard, although it is. It is that the
webserver role has no safe wrong answer. The apps are SQLite on local Docker
volumes, so two machines concluding they are both the webserver produces two
divergent databases and no way to merge them. A role whose failure mode is
silent data loss cannot be *usually* exactly-one.

The election that matters already exists and Cloudflare runs it: whatever holds
the tunnel credentials and the `config.yml` ingress is what the internet
reaches. `apps/cloudflared/credentials/` is host-specific and gitignored, and
`REQ-DEPLOY-006` already exists to stop a deploy deleting it. Moving the
webserver role means moving credentials, which is a deliberate act by a human.
For a single-writer datastore that is a feature, not friction.

> Note for later: `cloudflared` does support running one tunnel from several
> replicas, with Cloudflare load-balancing across them. That is built for
> stateless origins. It is the wrong tool here and should not be reached for as
> a shortcut to high availability.

### 2. No PXE. USB, permanently

Not a staging decision — a standing one. PXE would mean touching the household
DHCP server, and the network is shared with people who need it to work.

This was reconsidered once and still rejected. `dnsmasq` can run in **proxy DHCP
mode** (`dhcp-range=<subnet>,proxy`), answering only the PXE portion of the
conversation and leaving addressing entirely to the existing router — the
standard answer to exactly this constraint. It was declined anyway, because the
objection is to perturbing the network at all, not to the specific mechanism.
Recorded so it is not re-proposed as though it were news. (It would also have
needed ethernet at install time, since PXE ROMs do not do wifi.)

**Consequence, and it is a good one.** USB-booted machines can still fetch their
preseed over HTTP from the provisioner, which is what `serve-preseed.sh` already
does. So the provisioner's value is not booting — it is that **changing the
preseed does not mean rebuilding ISOs**. The USB stick becomes a dumb bootloader
written once per machine.

### 3. Role *options* are versioned. Role *assignment* is runtime

The set of roles that exist is code: one `custom-role-*.target` systemd unit per
role, shipped by `postinstall.sh`, reviewed in a PR like anything else. Which
roles a given machine has switched on is runtime state and does not belong in
git.

Adding a role is a pull request. Assigning one is a click.

systemd targets are the right mechanism rather than a bespoke supervisor:
declarative, ordering is free via `Wants=`/`BindsTo=`, and `systemctl enable
--now` / `disable --now` on a target is the whole of the activation logic. Units
must be named `custom-*` and live in `/usr/local/lib/systemd/system` — #292, and
`vm/assert.sh` already enforces both.

Roles anticipated so far, deliberately **not** mutually exclusive: `webserver`,
`provisioner`, `preseeder`. Others will appear.

### 4. Control-plane state in SQLite on the provisioner; machines poll it

Machines poll the control plane and converge on what it tells them. One endpoint
carries both directions: the machine posts its heartbeat and reads back its
declared role.

This is the same pull pattern as the deploy poller (`REQ-DEPLOY-002`) for the
same reason — no inbound ports, nothing pushing at a box behind a firewall.

Critically: **an unreachable control plane must never cause a role change.** A
machine that cannot reach the provisioner keeps doing exactly what it was last
told. The control plane being down is not an event.

Roles were considered for git, given the poller precedent, and rejected:
flipping a role would become a commit plus a two-minute poll, and the dashboard
would need push credentials. Config in git, assignment in the database.

### 5. Heartbeat and dashboard first, read-only

Before any role machinery. It is independently useful, it is the thing that gets
looked at daily, and it de-risks everything after it by making machine state
observable *before* anything starts changing machine state.

Served at `dash.seanmizen.com`. Ports **4070** (FE) and **4071** (BE) on the
cloudflared scheme, **5070**/**5071** on Fly — 4060/4061 is `inside`, and 4040 is
squatted by ngrok's web inspector.

Heartbeat payload falls out of what already exists: hostname, boot id (the
plumbing arrived free with #295), uptime, disk, Docker status, checkout SHA,
declared role versus actual role.

**One alarm matters more than the rest: more than one machine reporting the
webserver role.** The thing that must never happen should be the loudest thing on
the page.

Bootstrap wrinkle: the first deployment target is the existing `debbie`, which
runs the `2025-10-08b` generation rather than `2026-09-17`. That is still the
right call for a proof of concept; the newer generation inherits the dashboard
later.

### 6. The provisioner gets its own keypair

An always-on box holding a key that can root every machine on the network is a
materially different security posture from a key on a laptop that is plugged in
occasionally. It is a lateral-movement hub, and it should have a blast radius
that can be described in one sentence.

A dedicated provisioning keypair, not a personal one.

### 7. The Mac stays the cold-start path

`provision.sh` runs from a workstation today and will keep working. It becomes
the bootstrap stand-in: what builds machine zero when the fleet is being started
from nothing, and otherwise unused.

---

## Parked

### Automatic role negotiation

**Parked, not rejected.** The position on record is that it is solvable with a
defined protocol, and that is not disputed here — what is disputed is the order
of operations. Declared roles are a prerequisite for negotiated ones regardless,
since negotiation needs somewhere to write its answer and something to override
it when it is wrong.

The asymmetry worth carrying forward: **the objection is not to consensus, it is
to local SQLite.** A wrong answer about `preseeder` costs a retry. A wrong answer
about `webserver` costs data that does not come back. So the two are not one
feature, and stateless roles could safely negotiate long before the webserver
role could.

Before negotiation is safe for a stateful role, this document wants answers to:

- What fences a machine that believes it is the webserver but has been
  superseded — before it writes, not after.
- What happens during a partition, stated as a chosen tradeoff rather than
  discovered behaviour.
- Whether the data layer still assumes a single local SQLite writer by then. If
  it does, the answer above has to be fencing rather than quorum.
- How a human overrides a wrong negotiated answer while it is happening.

---

## Open questions

Genuinely undecided. Listed so they are not mistaken for decisions.

- **Naming.** `debbie` names a machine and also, informally, the generation of
  provisioning that produced it. Several machines need a scheme that keeps those
  two apart.
- **How a role change physically moves the tunnel credentials.** Decided that it
  is a human act; not decided what that act *is*, or what stops the old
  webserver continuing to serve after it stops being one.
- **Whether every machine runs the deploy poller.** The checkout and the poller
  are capability, so probably yes. But `deploy.sh` runs `yarn prod:docker`, and
  only the webserver should. This is the first place roles touch code that
  already exists, and it needs deciding before the second machine is built, not
  after.
- **Backups.** Not discussed at all. A fleet makes the single-writer SQLite box
  more obviously a single point of loss, not less.

---

## What this does not cover

Anything already in [`requirements/`](./requirements/). The requirements
describe one host and are validated by CI; this document describes a fleet and
is validated by nothing. When something here becomes real it moves there and
gets a `REQ-` and a test, and its section here should be replaced by a pointer.
