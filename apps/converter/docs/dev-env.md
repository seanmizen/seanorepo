# Dev Environment Notes

## Prerequisites

### ffmpeg

The backend calls `ffmpeg` and `ffprobe` at startup and fails fast if either is missing.

```bash
brew install ffmpeg
```

Both binaries must be on `PATH`. The Go server will print a clear error and exit if they're not found.

---

## Node version resolution — the Homebrew trap

### What's going on

The monorepo has no `.nvmrc`. On Sean's machine, `which -a node` currently returns:

```
/Users/seanmizen/.nvm/versions/node/v20.19.0/bin/node   ← active, via nvm
/opt/homebrew/bin/node                                   ← v25.9.0 (Homebrew)
/usr/local/bin/node
/Users/seanmizen/.nvm/versions/node/v11.15.0/bin/node
/Users/seanmizen/.nvm/versions/node/v12.22.9/bin/node
/Users/seanmizen/.nvm/versions/node/v15.14.0/bin/node
/Users/seanmizen/.nvm/versions/node/v16.13.2/bin/node
/Users/seanmizen/.nvm/versions/node/v17.4.0/bin/node
/Users/seanmizen/.nvm/versions/node/v8.17.0/bin/node
```

Inside an interactive zsh session everything is fine: `~/.zshrc` lines 204–206 load nvm, and nvm's shim prepends the active version (`v20.19.0`) to `PATH`. The surprising bit is what happens in **non-interactive** shells — cron, `launchd`, GUI-launched apps, VS Code tasks that don't inherit a login shell. Zsh only sources `~/.zshrc` in interactive mode; non-interactive shells see just `~/.zshenv`, which currently contains only:

```sh
. "$HOME/.cargo/env"
```

No nvm init. So in a non-interactive shell the first `node` on `PATH` is `/opt/homebrew/bin/node` — and that's **Node v25.9.0**, not v20. Silent version divergence between Sean's terminal and anything launched outside it.

### One-sentence finding

`nvm` is initialised in `~/.zshrc` only, so non-interactive shells silently fall through to Homebrew's `/opt/homebrew/bin/node` (currently v25.9.0) instead of the nvm-managed v20.19.0 that interactive shells see.

### Recommended fix (for Sean to approve — not applied)

Move nvm's init out of `~/.zshrc` and into `~/.zshenv` so it runs for every shell, interactive or not. Proposed diff:

```diff
--- a/.zshenv
+++ b/.zshenv
@@ -1 +1,5 @@
 . "$HOME/.cargo/env"
+
+export NVM_DIR="$HOME/.nvm"
+[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # loads nvm
+[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
```

```diff
--- a/.zshrc
+++ b/.zshrc
@@ -201,9 +201,6 @@
 # (unrelated lines)

-export NVM_DIR="$HOME/.nvm"
-[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
-[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
```

Optional belt-and-braces: add a repo-root `.nvmrc` pinning `20` so `nvm use` in any shell locks to the same major version without relying on global state.

```
echo "20" > .nvmrc
```

### Why this is not auto-applied

Shell init files are user-scoped and load-bearing — silently editing `~/.zshenv` during a task risks breaking unrelated workflows Sean hasn't told me about. The diff above is the recommendation; Sean decides whether to apply it.
