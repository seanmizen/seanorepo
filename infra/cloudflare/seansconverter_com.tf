resource "cloudflare_zone" "seansconverter_com" {
  account = {
    id = local.account_id
  }
  name = "seansconverter.com"
  type = "full"
}

# The site runs behind the tunnel (apps/cloudflared/config.yml).
resource "cloudflare_dns_record" "seansconverter_com_apex_cname" {
  name    = "seansconverter.com"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  zone_id = cloudflare_zone.seansconverter_com.id
}

resource "cloudflare_dns_record" "seansconverter_com_www_cname" {
  name    = "www.seansconverter.com"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  zone_id = cloudflare_zone.seansconverter_com.id
}
