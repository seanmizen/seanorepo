# R2 buckets. The OpenTofu state bucket is not here: infra/tofu makes it on
# init, before OpenTofu can read the state.

# The crm bucket. Litestream keeps the backups of the crm database under the
# prefix crm.db/ (apps/crm/litestream.yml), so the bucket can hold other
# crm files. The data must stay in the EU, so the bucket uses the EU
# jurisdiction. Cloudflare fixes the jurisdiction when it makes the bucket.
# A bucket made without it must be replaced, not changed. Only the EU
# endpoint, https://<account_id>.eu.r2.cloudflarestorage.com, reaches the
# bucket.
#
# Sean made the bucket in the dashboard. Its import block in imports.tf
# adopts it, so the apply makes no second bucket.
resource "cloudflare_r2_bucket" "crm" {
  account_id   = local.account_id
  name         = "crm"
  jurisdiction = "eu"
}

# The crm demo bucket. The demo Litestream sidecar backs up here, with its own
# R2 key, which reaches only this bucket. The demo has an unsafe sign-in, so
# it must hold no key to the bucket crm. EU for the same reason as crm: the
# compose file accepts only the EU endpoint.
#
# Sean made the bucket in the dashboard. Its import block in imports.tf
# adopts it.
resource "cloudflare_r2_bucket" "crm_demo" {
  account_id   = local.account_id
  name         = "crm-demo"
  jurisdiction = "eu"
}
