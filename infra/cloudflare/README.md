# Cloudflare as code

The Cloudflare setup for all of Sean's sites, in OpenTofu: the zones, the browser cache TTL, the
DNS records, the tunnel and its ingress rules. Git holds the code. The
state is in the R2 bucket `seanorepo-tofu-state`, which CI and every
checkout share. A push to `release` applies the stack in CI
(`.github/workflows/infra-apply.yml`). One import block for each resource
rebuilds a lost state (see "The state").

## The token

CI applies the stack with one Cloudflare token, `ci-infra-apply`. It is a
secret of the GitHub environment `release`, and only the `release` branch
can use that environment (`infra/github/main.tf`). A PR gets no token, and
no machine keeps one.

To make the token again (*Manage Account → Account API tokens → Create a
token → Start from scratch*), add two policies:

| Policy scope | Permission | Access |
| ------------ | ---------- | ------ |
| Entire Account | Argo Tunnel (Legacy). The summary calls it "Cloudflare Tunnel". | Edit |
| Entire Account | Account Settings | Read |
| Entire Account | Workers R2 Storage | Edit |
| Specified Domains: seanmizen.com, carolinemizen.art, seansconverter.com, handymanplumbersw18.com | Zone | Read |
| Same domains | DNS | Edit |
| Same domains | Zone Settings | Edit |

Set no expiry. Then put the token in the environment:

```bash
gh secret set CLOUDFLARE_API_TOKEN --env release --repo seanmizen/seanorepo
```

Workers R2 Storage is account-wide, because OpenTofu manages the buckets
and holds its state in R2. So this token can read the crm backups. That
is why only `release` gets it.

## Apply by hand

Normally you do not. If CI cannot apply:

1. Make a token as above, with a short expiry.
2. Put it in `~/.config/seanorepo/cloudflare.secrets` (see
   `.secrets.example`, mode 600).
3. Make a checkout of `release`, once. `yarn release` pushes to
   `origin/release` and does not change this checkout, so pull it before
   each apply:

   ```bash
   git worktree add ~/projects/seanorepo-release release
   ```

4. Run `./tofu init`, `./tofu plan` and `./tofu apply` there.
5. Delete the secrets file, and delete the token in the dashboard.

`./tofu` calls the shared wrapper `infra/tofu`. It downloads the pinned
OpenTofu on first use, checks its SHA-256, and loads the secrets file. It
needs `curl`, `unzip` and `sha256sum`. You do not install OpenTofu
yourself. For this stack it also gives the S3 backend its keys: the ID of
the API token and the SHA-256 of its value. These are the R2 keys of a
Cloudflare API token, so one token does both jobs. From the repo root, `yarn tofu cloudflare <command>` does the
same. The other stack is `../github`.

## Every change

`release` is what is live, so apply runs only from the `release` checkout.
The wrapper refuses apply, destroy, import and `state rm`/`mv` in any other
checkout, with changes that are not committed, or behind `origin/release`.
Plan runs anywhere.

1. Change the `.tf` files on a branch. The PR checks format, validate and
   import blocks. It shows no plan, because a PR gets no token.
2. Merge the PR, then run `yarn release`. The "Infra apply" workflow
   plans and applies the stack from `release`, and shows the plan in its
   run summary. Read it. Only one apply runs at a
   time, and the R2 lock file stops an apply from a checkout at the same
   time.
3. If the apply created a resource, add its import block to `imports.tf`
   in a new PR. The ID is in `./tofu state show <resource>`. Until then,
   `infra/check-imports.sh` fails in CI, and the apply run shows a
   warning.

To apply by hand, see "Apply by hand".

If `plan` shows a change that you did not make, someone changed Cloudflare
by hand. Apply puts it back to what git says. To keep the manual change,
copy it into the `.tf` files first.

## Files

- `main.tf`: the account ID.
- `<zone>.tf`: one file for each zone, with its DNS records.
- `tunnel.tf`: the tunnel.
- `r2.tf`: the R2 buckets, except the state bucket. The crm backup bucket
  is in the EU jurisdiction.
- `imports.tf`: one import block for each resource. They do nothing when
  the state has the resource. They rebuild a lost state.
- The state: `cloudflare/terraform.tfstate` in the R2 bucket
  `seanorepo-tofu-state`.

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

1. Delete `cloudflare/terraform.tfstate` from the R2 bucket.
2. `./tofu init`, then `./tofu plan`. The plan must show only imports.
3. Run the "Infra apply" workflow on `release`, or `./tofu apply` from
   the `release` checkout.

To delete a resource, the state must hold it. Without it, OpenTofu does
not know the object, and removing the code leaves the object live. So
apply once first (step 3 above), then remove the code and its import
block, and apply again.

## Rules

- Change Cloudflare only through these files. A change in the dashboard
  is lost at the next apply.
- Apply only from `release`: CI, or a clean `release` checkout.
- Never commit `.tofu/`, `.terraform/` or a plan file.
