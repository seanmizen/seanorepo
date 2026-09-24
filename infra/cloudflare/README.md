# Cloudflare as code

The Cloudflare setup for all of Sean's sites, in OpenTofu: the zones, the
DNS records, the tunnel and its ingress rules. Git holds the code. The
state is a local cache that git ignores. One import block for each
resource rebuilds it (see "The state").

## Setup (once per machine)

1. Create an API token in the Cloudflare dashboard: *My Profile → API
   Tokens → Create Token → Create Custom Token*. Give it these
   permissions:

   | Scope   | Permission                 | Access |
   | ------- | -------------------------- | ------ |
   | Account | Cloudflare Tunnel          | Edit   |
   | Account | Account Settings           | Read   |
   | Zone    | Zone                       | Read   |
   | Zone    | DNS                        | Edit   |

   Under *Zone Resources*, include only seanmizen.com, carolinemizen.art
   and seansconverter.com.

2. Put the token in `~/.config/seanorepo/cloudflare.secrets`:

   ```bash
   mkdir -p ~/.config/seanorepo
   cp .secrets.example ~/.config/seanorepo/cloudflare.secrets
   chmod 600 ~/.config/seanorepo/cloudflare.secrets
   # then edit the file
   ```

   The file is outside the repo, so git cannot commit it, and every
   checkout and worktree uses it. `CLOUDFLARE_SECRETS=<path>` picks
   another file.

3. Make a checkout of `release` for apply, once. `yarn release` pushes
   to `origin/release` and does not change this checkout, so pull it
   before each apply:

   ```bash
   git worktree add ~/projects/seanorepo-release release
   ```

4. Run `./tofu init`.

`./tofu` calls the shared wrapper `infra/tofu`. It downloads the pinned
OpenTofu on first use, checks its SHA-256, and loads the secrets file. It
needs `curl`, `unzip` and `sha256sum`. You do not install OpenTofu
yourself. From the repo root, `yarn tofu cloudflare <command>` does the
same. The other stack is `../github`.

## Every change

`release` is what is live, so apply runs only from the `release` checkout.
The wrapper refuses apply, destroy, import and `state rm`/`mv` in any other
checkout, with changes that are not committed, or behind `origin/release`.
Plan runs anywhere.

1. Change the `.tf` files on a branch. Run `./tofu plan` and read it.
2. Merge the PR, then run `yarn release`.
3. In the `release` checkout:

   ```bash
   git pull --ff-only
   ./tofu plan     # shows what would change. Read it.
   ./tofu apply
   ```

4. If the apply created a resource, add its import block to `imports.tf`
   in a new PR. The ID is in `./tofu state show <resource>`. Until then,
   `infra/check-imports.sh` fails in CI.

If `plan` shows a change that you did not make, someone changed Cloudflare
by hand. Apply puts it back to what git says. To keep the manual change,
copy it into the `.tf` files first.

## Files

- `main.tf`: the account ID.
- `<zone>.tf`: one file for each zone, with its DNS records.
- `tunnel.tf`: the tunnel.
- `imports.tf`: one import block for each resource. They do nothing when
  the state has the resource. They rebuild a lost state.
- `terraform.tfstate`: the state. Git ignores it.

## Add a hostname for a tunnel site

1. Add the record to the zone's file:

   ```hcl
   resource "cloudflare_dns_record" "example_com_apex_cname" {
     name    = "example.com"
     type    = "CNAME"
     content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
     proxied = true
     ttl     = 1
     zone_id = cloudflare_zone.example_com.id
   }
   ```

2. Add the ingress rule to `apps/cloudflared/config.yml`. The tunnel is
   locally managed today, so its ingress is still in that file.
3. Follow "Every change", including the import block after the apply.

## The state

The state maps each resource in the code to the ID of the live object.
Cloudflare holds the settings. So a lost or old state loses no settings.
It only makes OpenTofu forget which object is which. The import blocks
give it the IDs again:

1. Delete `terraform.tfstate`.
2. `./tofu init`, then `./tofu plan`. The plan must show only imports.
3. `./tofu apply` from the `release` checkout.

To delete a resource, the state must hold it. Without it, OpenTofu does
not know the object, and removing the code leaves the object live. So
apply once first (step 3 above), then remove the code and its import
block, and apply again.

## Rules

- Change Cloudflare only through these files. A change in the dashboard
  is lost at the next apply.
- Apply from one `release` checkout only. Its state is the cache.
- Never commit `.tofu/`, `.terraform/` or a plan file.
