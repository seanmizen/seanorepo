terraform {
  required_version = "~> 1.12"

  # The state lives in R2, so CI and every checkout share one copy.
  # infra/tofu derives the S3 keys from CLOUDFLARE_API_TOKEN and creates
  # the bucket on init. use_lockfile stops two applies at the same time.
  backend "s3" {
    bucket = "seanorepo-tofu-state"
    key    = "cloudflare/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://8e76a7e41317a164bf03bf360ba4ac38.r2.cloudflarestorage.com"
    }
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.25"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment (.secrets).
provider "cloudflare" {}
