# Cloudflare as code

The Cloudflare setup for all of Sean's sites, in OpenTofu: the zones, the
DNS records, the tunnel and its ingress rules. Git holds all of it,
including the state. The state is encrypted.

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

2. Put the token and the state passphrase in
   `~/.config/seanorepo/cloudflare.secrets`:

   ```bash
   mkdir -p ~/.config/seanorepo
   cp .secrets.example ~/.config/seanorepo/cloudflare.secrets
   chmod 600 ~/.config/seanorepo/cloudflare.secrets
   # then edit the file
   ```

   The file is outside the repo, so git cannot commit it, and every
   checkout and worktree uses it. `CLOUDFLARE_SECRETS=<path>` picks
   another file.

   Make the passphrase with `openssl rand -base64 32`. Keep a copy where
   you keep other secrets. It decrypts the state in git.

3. Run `./tofu init`.

The wrapper `./tofu` downloads the pinned OpenTofu on first use, checks
its SHA-256, and loads the secrets file. It needs `curl`, `unzip` and
`sha256sum`. You do not install OpenTofu yourself. From the repo root,
`yarn tofu <command>` runs the same wrapper.

## Every change

```bash
./tofu plan     # shows what would change. Read it.
./tofu apply    # makes the change, and writes the encrypted state
git add terraform.tfstate *.tf && git commit
```

Commit `terraform.tfstate` after every apply. It is encrypted.

If `plan` shows a change that you did not make, someone changed Cloudflare
by hand. Apply puts it back to what git says. To keep the manual change,
copy it into the `.tf` files first.

## Files

- `main.tf`: the account ID.
- `<zone>.tf`: one file for each zone, with its DNS records.
- `tunnel.tf`: the tunnel.
- `imports.tf`: import blocks for everything that existed before OpenTofu.
  They do nothing after the first apply. They make a rebuild possible.
- `terraform.tfstate`: the encrypted state.

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
3. `./tofu plan`, `./tofu apply`, commit.

## Lost passphrase or state

The Cloudflare resources still exist, and `imports.tf` knows their IDs.

1. Delete `terraform.tfstate`.
2. Put a new passphrase in the secrets file.
3. `./tofu init`, then `./tofu apply`. The plan must show only imports.
4. Commit the new state.

A resource that you added after the first import has no import block.
Add one before step 3, or apply creates a second copy of it.

## Rules

- Change Cloudflare only through these files. A change in the dashboard
  is lost at the next apply.
- One person applies at a time. The state is in git, so there is no lock:
  pull before you plan, and push after you apply.
- Never commit `.tofu/`, `.terraform/` or a plan file.
