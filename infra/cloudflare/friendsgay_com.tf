resource "cloudflare_zone" "friendsgay_com" {
  account = {
    id = local.account_id
  }
  name = "friendsgay.com"
  type = "full"
}

resource "cloudflare_dns_record" "friendsgay_com_www_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "www.friendsgay.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.friendsgay_com.id
}

resource "cloudflare_dns_record" "friendsgay_com_apex_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "friendsgay.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.friendsgay_com.id
}
