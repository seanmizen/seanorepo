resource "cloudflare_zone" "seansconverter_com" {
  account = {
    id = local.account_id
  }
  name = "seansconverter.com"
  type = "full"
}
