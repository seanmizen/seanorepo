resource "cloudflare_zone" "handymanplumbersw18_com" {
  account = {
    id = local.account_id
  }
  name = "handymanplumbersw18.com"
  type = "full"
}
