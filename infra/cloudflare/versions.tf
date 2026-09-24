terraform {
  required_version = "~> 1.12"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.25"
    }
  }

  # The state is encrypted and committed to git. Without the passphrase
  # nobody can read it, and nobody can plan or apply. Keep a copy of the
  # passphrase in a password manager: a lost passphrase means a lost state.
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
  description = "Encrypts the state. At least 16 characters. From .secrets."
  type        = string
  sensitive   = true
}

# Reads CLOUDFLARE_API_TOKEN from the environment (.secrets).
provider "cloudflare" {}
