# GitHub as code

GitHub settings for `seanmizen/seanorepo`, in OpenTofu. asus deploys
whatever lands on `release`, so these settings decide who can deploy.

| Setting | Why |
| ------- | --- |
| Actions token: read by default | A compromised third-party action cannot push. A workflow that needs more asks for it (`permissions:`). |
| Ruleset on `main` and `release`: no force-push, no deletion, no bypass | Nobody rewinds or deletes a deploy branch. `yarn release` fast-forwards, so it still works. |

## Use

```bash
./tofu init
./tofu plan
./tofu apply
git add terraform.tfstate *.tf && git commit
```

The token comes from your gh login (`gh auth token`). The state passphrase
is the one in `~/.config/seanorepo/cloudflare.secrets`, as for
`../cloudflare`.

## A deliberate history rewrite

The ruleset blocks force-pushes to `main` and `release`, for everyone.

1. In `main.tf`, set the ruleset's `enforcement = "disabled"`. Apply.
2. Rewrite and force-push.
3. Set `enforcement = "active"` again. Apply. Commit the state.
