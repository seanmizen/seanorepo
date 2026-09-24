resource "cloudflare_zone" "carolinemizen_art" {
  account = {
    id = local.account_id
  }
  name = "carolinemizen.art"
  type = "full"
}

resource "cloudflare_dns_record" "carolinemizen_art_apex_txt_2" {
  content = "\"v=spf1 include:secureserver.net -all\""
  name    = "carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

# Microsoft 365 (from GoDaddy) mail for carolinemizen.art. The tenant is
# live, so a mailbox can exist. These CNAMEs must be DNS only: a proxied
# autodiscover answers with Cloudflare addresses and Outlook setup fails.
resource "cloudflare_dns_record" "carolinemizen_art_autodiscover_cname" {
  content = "autodiscover.outlook.com"
  name    = "autodiscover.carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_sip_cname" {
  content = "sipdir.online.lync.com"
  name    = "sip.carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_apex_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "carolinemizen.art"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_msoid_cname" {
  content = "clientconfig.microsoftonline-p.net"
  name    = "msoid.carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_email_cname" {
  content = "email.secureserver.net"
  name    = "email.carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_lyncdiscover_cname" {
  content = "webdir.online.lync.com"
  name    = "lyncdiscover.carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_apex_mx" {
  content  = "carolinemizen-art.mail.protection.outlook.com"
  name     = "carolinemizen.art"
  priority = 0
  proxied  = false
  ttl      = 1
  type     = "MX"
  zone_id  = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_www_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "www.carolinemizen.art"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.carolinemizen_art.id
}

resource "cloudflare_dns_record" "carolinemizen_art_apex_txt" {
  content = "\"NETORGFT15153301.onmicrosoft.com\""
  name    = "carolinemizen.art"
  proxied = false
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.carolinemizen_art.id
}
