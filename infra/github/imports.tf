# One import block for each resource, so a lost state can be rebuilt with
# one apply. See README.md.

# The Actions permissions existed before OpenTofu managed them.
import {
  to = github_workflow_repository_permissions.seanorepo
  id = "seanorepo"
}

# OpenTofu created the ruleset. The ID is <repository>:<ruleset id>.
import {
  to = github_repository_ruleset.protect_main_and_release
  id = "seanorepo:23945521"
}
