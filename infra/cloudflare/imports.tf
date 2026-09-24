# Import blocks for everything that existed before OpenTofu managed it.
# After the first apply they do nothing. They stay, so that a lost state
# can be rebuilt: delete terraform.tfstate, then run ./tofu apply.

import {
  to = cloudflare_zero_trust_tunnel_cloudflared.seanmizen_3
  id = "8e76a7e41317a164bf03bf360ba4ac38/0f63e5e3-ee1c-425a-9916-cd037524731d"
}

import {
  to = cloudflare_zone.carolinemizen_art
  id = "09fac9e16bdfa00d49c35fbe78f112e4"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_autodiscover_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/a202c20113764b27adcd73f81fbedec0"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_apex_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/701617ff0dcc629041a61f00326a1138"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_email_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/b3e623216186cd9ef1b08c1b140feffa"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_lyncdiscover_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/cb90b7a29e4b9a105ea4478de4fce532"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_msoid_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/31c432146d053bb33e19682e4f7cc1f8"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_sip_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/b22a8e156c4dbc6784e9941661e6f1f6"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_www_cname
  id = "09fac9e16bdfa00d49c35fbe78f112e4/8c7098095b44e7fbb9171c9eb7542b22"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_apex_mx
  id = "09fac9e16bdfa00d49c35fbe78f112e4/81e40bafe2b797318673d46396aba70d"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_apex_txt
  id = "09fac9e16bdfa00d49c35fbe78f112e4/dc719a5c21b06d8ac16332cbe1e29ec2"
}

import {
  to = cloudflare_dns_record.carolinemizen_art_apex_txt_2
  id = "09fac9e16bdfa00d49c35fbe78f112e4/e5649154cc9444e3cf4beecd006bd0e5"
}

import {
  to = cloudflare_zone.handymanplumbersw18_com
  id = "c5581f2f89a86079189496a0da1b637e"
}

import {
  to = cloudflare_zone.seanmizen_com
  id = "428a9a9f5e22c95bc7e67faa7d5ab942"
}

import {
  to = cloudflare_dns_record.seanmizen_com_hue_a
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/68e515e6e79851dcbe3c9380415d60a7"
}

import {
  to = cloudflare_dns_record.seanmizen_com_inside_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/1a896b5abf903e334e65ec56a006df90"
}

import {
  to = cloudflare_dns_record.seanmizen_com_mail_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/ce387843b136e2813e994a5a51625043"
}

import {
  to = cloudflare_dns_record.seanmizen_com_minecraft_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/ad222b4342cb7f554ab007ecdbbb9938"
}

import {
  to = cloudflare_dns_record.seanmizen_com_planning_poker_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/ac1bd8cf4ebc78c1da56950c3bc47127"
}

import {
  to = cloudflare_dns_record.seanmizen_com_pp_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/c82b50b8c0241a3a3c2b053beee0bfa1"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/ed22725d11359601f770db5b28a601b6"
}

import {
  to = cloudflare_dns_record.seanmizen_com_ssh_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/a432b0f33410138cbca2b9e38e743292"
}

import {
  to = cloudflare_dns_record.seanmizen_com_stealthly_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/1cfdc5fbf820aed0dee904a84c0f7695"
}

import {
  to = cloudflare_dns_record.seanmizen_com_www_cname
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/3961337ad9edae4f2d28516048b0334c"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_mx
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/1373005f48823d8d6ff9ab02d9f4472c"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_mx_2
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/b4002caae3b8a4ccf9f1810ebc22f31c"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_mx_3
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/cf2db273835264a13c6f60c90a806b56"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_mx_4
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/b08118f7feb10918a46e418a667f0be8"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_mx_5
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/e1f5448a584bedb8ad275256b474948e"
}

import {
  to = cloudflare_dns_record.seanmizen_com_google_domainkey_txt
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/3ca12ec1ca110f3f06c489e0b0ae7a66"
}

import {
  to = cloudflare_dns_record.seanmizen_com_apex_txt
  id = "428a9a9f5e22c95bc7e67faa7d5ab942/6901768544a8e5fe95ddff62795ba117"
}

import {
  to = cloudflare_zone.seansconverter_com
  id = "bc66a0dc112f15ae7d5ae2b9d395168a"
}

