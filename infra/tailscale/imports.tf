# One import block for each resource, so a lost state can be rebuilt with
# one apply. See ../cloudflare/README.md, "The state".

import {
  to = tailscale_acl.policy
  id = "acl"
}

# The ID is the device's node ID (tailscale status --json, or the API).
import {
  to = tailscale_device_tags.asus
  id = "noju8BfMsy11CNTRL"
}

import {
  to = tailscale_device_tags.minix
  id = "n1MWtkbHUi11CNTRL"
}

import {
  to = tailscale_device_tags.basecamp
  id = "n4ont2QLww11CNTRL"
}
