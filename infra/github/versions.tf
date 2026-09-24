terraform {
  required_version = "~> 1.12"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }

  # The same encryption as infra/cloudflare: the state is committed, and
  # only the passphrase (in ~/.config/seanorepo/cloudflare.secrets) reads it.
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }
    state {
      method   = method.aes_gcm.main
      enforced = true
    }
    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}

variable "state_passphrase" {
  description = "Encrypts the state. At least 16 characters. From the secrets file."
  type        = string
  sensitive   = true
}

# Reads GITHUB_TOKEN. infra/tofu sets it from `gh auth token`.
provider "github" {
  owner = "seanmizen"
}
