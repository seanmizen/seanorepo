# Tailscale as code

The tailnet policy and the machine tags, in OpenTofu. The tailnet is the
only way into the home servers from outside (REQ-NETWORK-006), so this
policy decides what can reach what.

| Machine | Tag | Reaches |
| ------- | --- | ------- |
| Sean's Mac and iPhone | none (`autogroup:member`) | everything: each machine, the home LAN through asus, Caroline's LAN through minix |
| asus | `tag:server` | nothing on the tailnet |
| minix | `tag:server` | nothing on the tailnet |
| basecamp | `tag:nas` | nothing on the tailnet |

A tagged machine belongs to the tag, not to Sean's account, so its key
does not expire. `policy.hujson` has tests. Tailscale refuses a policy that
fails one.

## Use

The workflow is the same as for `../cloudflare`: apply only from the
`release` checkout, and one import block for each resource. The state is
local, as for `../github`. The import blocks rebuild it.

1. Make an API access token: admin console → Settings → Keys → Generate
   access token, with the shortest expiry. Put it in
   `~/.config/seanorepo/tailscale.secrets` (mode 600):

   ```bash
   umask 077
   read -rs "k?Tailscale API key: "
   printf 'TAILSCALE_API_KEY=%s\n' "$k" > ~/.config/seanorepo/tailscale.secrets
   unset k
   ```

2. In the release checkout:

   ```bash
   ./tofu init
   ./tofu plan
   ./tofu apply
   ```

3. Delete the secrets file. The key expires by itself.

To check a policy edit before you merge it, without a change to the
tailnet:

```bash
curl -s -u "$TAILSCALE_API_KEY:" -H "Content-Type: application/hujson" \
  --data-binary @policy.hujson https://api.tailscale.com/api/v2/tailnet/-/acl/validate
```

`{}` means the policy is valid and each test passes.

## A new machine

Sean's own devices need nothing. For a server, add a
`tailscale_device_tags` resource with its node ID and its import block. The
node ID is `ID` in `tailscale status --json` on that machine.
