# GitHub settings for seanmizen/seanorepo. asus deploys whatever lands on
# the release branch, so who can move it matters.

locals {
  repository = "seanorepo"
}

# The GITHUB_TOKEN of a workflow run can only read, unless the workflow asks
# for more (image-to-ascii-release.yml asks for contents: write). A
# compromised third-party action then cannot push to release.
resource "github_workflow_repository_permissions" "seanorepo" {
  repository                       = local.repository
  default_workflow_permissions     = "read"
  can_approve_pull_request_reviews = true
}

# Nobody can force-push to main or release, or delete them. There is no
# bypass. Normal pushes, squash merges and `yarn release` (a fast-forward)
# still work. For a deliberate history rewrite, set enforcement to
# "disabled", apply, rewrite, then set it back to "active" and apply.
resource "github_repository_ruleset" "protect_main_and_release" {
  name        = "protect main and release"
  repository  = local.repository
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/main", "refs/heads/release"]
      exclude = []
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true
  }
}
