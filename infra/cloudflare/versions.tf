terraform {
  required_version = "~> 1.12"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.25"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment (.secrets).
provider "cloudflare" {}
