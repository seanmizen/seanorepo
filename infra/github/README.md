# GitHub as code

GitHub settings for `seanmizen/seanorepo`, in OpenTofu. asus deploys
whatever lands on `release`, so these settings decide who can deploy.

| Setting | Why |
| ------- | --- |
| Actions token: read by default | A compromised third-party action cannot push. A workflow that needs more asks for it (`permissions:`). |
| Ruleset on `main` and `release`: no force-push, no deletion, no bypass | Nobody rewinds or deletes a deploy branch. `yarn release` fast-forwards, so it still works. |

## Use

The workflow is the same as for `../cloudflare`: apply only from the
`release` checkout, and one import block for each resource. See its
README, "Every change" and "The state".

```bash
./tofu init
./tofu plan
./tofu apply    # in the release checkout only
```

The token comes from your gh login (`gh auth token`).

## A deliberate history rewrite

The ruleset blocks force-pushes to `main` and `release`, for everyone.

1. In `main.tf`, set the ruleset's `enforcement = "disabled"`. Apply.
2. Rewrite and force-push.
3. Set `enforcement = "active"` again. Apply.

The ruleset change goes through a PR and `yarn release` each time, because
apply runs only from `release`.
