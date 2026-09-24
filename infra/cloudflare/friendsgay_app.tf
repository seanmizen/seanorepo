resource "cloudflare_zone" "friendsgay_app" {
  account = {
    id = local.account_id
  }
  name = "friendsgay.app"
  type = "full"
}

resource "cloudflare_dns_record" "friendsgay_app_www_cname" {
  content = "friendsgay.com"
  name    = "www.friendsgay.app"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.friendsgay_app.id
}

resource "cloudflare_dns_record" "friendsgay_app_apex_cname" {
  content = "friendsgay.com"
  name    = "friendsgay.app"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.friendsgay_app.id
}
