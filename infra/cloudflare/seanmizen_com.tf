resource "cloudflare_zone" "seanmizen_com" {
  account = {
    id = local.account_id
  }
  name = "seanmizen.com"
  type = "full"
}

resource "cloudflare_dns_record" "seanmizen_com_google_domainkey_txt" {
  content = "\"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAgA53u/WAVL/oMBW4FrEdq3zg6ASAggk0fijmrcd52oWoqpjMFmGhZ+Lj0gDTYVyegIichGrj1kF7sJIrKASbak5BYHObRclsasNY1sOj1A8Q6HjvfhUzZANuknmll/4Mxzu+OVCWkhf\" \"N3aoZf668G1hJcRjUBFpSzl3O7moYERrwuOyYw0iEDi5cvN2pDV8zh8zhQZvukBEUdVGRSTZdqFJMfyQDdkMk4NgTay0JJcO3OrV07FpMeoDeiiJpw2o/LbVLrVHSA4c8SXC/8rJRjS1uS/I+UjCr7EQXsxxOjLkWMK929jrCBKtP/ykkzIbwm2mBoiSkM8lsFKCJoCyl\" \"sQIDAQAB\""
  name    = "google._domainkey.seanmizen.com"
  proxied = false
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_pp_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "pp.seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.seanmizen_com.id
}

# A placeholder address (192.0.2.1). A Cloudflare redirect rule, not in
# OpenTofu yet, sends hue.seanmizen.com to an image on carolinemizen.art.
resource "cloudflare_dns_record" "seanmizen_com_hue_a" {
  comment = "Created during Cloudflare Rules deployment process for page_rules"
  content = "192.0.2.1"
  name    = "hue.seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "A"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_minecraft_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "minecraft.seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_mx_2" {
  content  = "alt2.aspmx.l.google.com"
  name     = "seanmizen.com"
  priority = 5
  proxied  = false
  ttl      = 1
  type     = "MX"
  zone_id  = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_inside_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "inside.seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_txt" {
  content = "\"v=spf1 include:_spf.google.com ~all\""
  name    = "seanmizen.com"
  proxied = false
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_mx" {
  content  = "alt1.aspmx.l.google.com"
  name     = "seanmizen.com"
  priority = 5
  proxied  = false
  ttl      = 1
  type     = "MX"
  zone_id  = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_cname" {
  comment = "0f63e5e3-ee1c-425a-9916-cd037524731d.cfargotunnel.com / seanmizen.fly.dev"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_mx_4" {
  content  = "alt4.aspmx.l.google.com"
  name     = "seanmizen.com"
  priority = 10
  proxied  = false
  ttl      = 1
  type     = "MX"
  zone_id  = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_mx_5" {
  content  = "aspmx.l.google.com"
  name     = "seanmizen.com"
  priority = 1
  proxied  = false
  ttl      = 1
  type     = "MX"
  zone_id  = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_apex_mx_3" {
  content  = "alt3.aspmx.l.google.com"
  name     = "seanmizen.com"
  priority = 10
  proxied  = false
  ttl      = 1
  type     = "MX"
  zone_id  = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_planning_poker_cname" {
  content = "${cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3.id}.cfargotunnel.com"
  name    = "planning-poker.seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.seanmizen_com.id
}

resource "cloudflare_dns_record" "seanmizen_com_www_cname" {
  comment = "seanmizen.fly.dev seanmizen.com"
  content = "seanmizen.com"
  name    = "www.seanmizen.com"
  proxied = true
  ttl     = 1
  type    = "CNAME"
  zone_id = cloudflare_zone.seanmizen_com.id
}

