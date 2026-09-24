resource "cloudflare_zero_trust_tunnel_cloudflared" "seanmizen_3" {
  account_id = local.account_id
  config_src = "local"
  name       = "seanmizen_3"
}
