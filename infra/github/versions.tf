terraform {
  required_version = "~> 1.12"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
}

# Reads GITHUB_TOKEN. infra/tofu sets it from `gh auth token`.
provider "github" {
  owner = "seanmizen"
}
