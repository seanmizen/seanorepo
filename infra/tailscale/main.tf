# The tailnet: its policy, and the tags of the machines that are not Sean's
# own devices. policy.hujson says what each tag can reach.

resource "tailscale_acl" "policy" {
  acl = file("${path.module}/policy.hujson")
}

# A tag needs its tagOwners entry in the policy first.

# asus: the public web box and the subnet router of the home LAN.
resource "tailscale_device_tags" "asus" {
  device_id  = "noju8BfMsy11CNTRL"
  tags       = ["tag:server"]
  depends_on = [tailscale_acl.policy]
}

# minix: the subnet router of Caroline's LAN.
resource "tailscale_device_tags" "minix" {
  device_id  = "n1MWtkbHUi11CNTRL"
  tags       = ["tag:server"]
  depends_on = [tailscale_acl.policy]
}

# basecamp: Caroline's Synology NAS.
resource "tailscale_device_tags" "basecamp" {
  device_id  = "n4ont2QLww11CNTRL"
  tags       = ["tag:nas"]
  depends_on = [tailscale_acl.policy]
}
