terraform {
  required_version = "~> 1.12"

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.29"
    }
  }
}

# Reads TAILSCALE_API_KEY. infra/tofu loads it from
# ~/.config/seanorepo/tailscale.secrets. "-" is the tailnet of the key.
provider "tailscale" {
  tailnet = "-"
}
