#!/bin/bash
# setup-developer-environment.sh: installs the toolchain and shell that every
# machine of Sean's gets, on macOS or on Debian.
#
# Where: on the machine being set up.
#          - a Mac: run it yourself from a clone of seanorepo. Do not use sudo.
#          - a target machine: provision.sh and test-vm.sh send it over SSH and
#            run it as root, before setup-server-environment.sh.
# When:  on a new machine, and again whenever this file changes.
# Why:   one file installs the same tools everywhere, so a server feels like
#        the Mac it is administered from, and nothing drifts between them.
#
# What it installs, in this order:
#   1. Homebrew (macOS) or apt packages (Debian)
#   2. zsh, oh-my-zsh, the prompt and aliases, and zsh as the login shell
#   3. Node 20, corepack and Yarn
#   4. Docker
#   5. Go, then shist (built from source)
#   6. Claude Code
#   7. ~/projects, the seanorepo clone, and the git config from config-anywhere
#   8. iTerm2 and its preferences (macOS only)
#
# It is idempotent: a second run leaves the machine in the same state. .zshrc
# is written whole every run, so edit this file rather than that one. Put
# machine-specific shell settings in ~/.zshrc.local, which this never touches.
#
# Usage:
#   macOS:  bash setup-developer-environment.sh
#   Debian: sudo DEV_USER=<user> bash setup-developer-environment.sh
set -euo pipefail
IFS=$'\n\t'

NODE_MAJOR=20
GO_MIN=1.24                       # shist needs go 1.24.2
SHIST_REPO=https://github.com/seanmizen/shist.git
REPO_URL="${REPO_URL:-https://github.com/seanmizen/seanorepo.git}"

OS="$(uname -s)"
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { echo "[dev-setup] $*"; }
die() { echo "[dev-setup] ERROR: $*" >&2; exit 1; }

#------------------------------------------------------------------------------
# Who this is for.
#
# On a Mac the answer is "you", and running as root would put Homebrew and the
# shell config in root's home. Homebrew refuses to run as root anyway.
#
# On Debian the script runs as root and configures another account, because
# provision.sh sends it to a machine where it must create files for the deploy
# user. DEV_USER names that account.
#------------------------------------------------------------------------------
case "$OS" in
    Darwin)
        [ "$(id -u)" -ne 0 ] || die "on macOS, run this without sudo"
        DEV_USER="$(id -un)"
        USER_HOME="$HOME"
        ;;
    Linux)
        [ "$(id -u)" -eq 0 ] || die "on Debian, run this with sudo"
        DEV_USER="${DEV_USER:-${SUDO_USER:-}}"
        [ -n "$DEV_USER" ] || die "DEV_USER is not set, and there is no SUDO_USER to fall back on"
        id "$DEV_USER" > /dev/null 2>&1 || die "no such user: $DEV_USER"
        USER_HOME="$(getent passwd "$DEV_USER" | cut -d: -f6)"
        export DEBIAN_FRONTEND=noninteractive
        ;;
    *) die "unsupported system: $OS. This runs on macOS and Debian." ;;
esac
USER_GROUP="$(id -gn "$DEV_USER")"

# Run a command as DEV_USER. On a Mac that is the current user already, so the
# command runs as it stands. Quoting note: the argument is one shell string.
as_user() {
    if [ "$(id -u)" -eq 0 ]; then
        sudo -H -u "$DEV_USER" bash -lc "$*"
    else
        bash -lc "$*"
    fi
}
# Asked of the file rather than of PATH: a fresh install is not on PATH until
# the next login shell.
have_user_bin() { [ -x "$USER_HOME/.local/bin/$1" ]; }

log "setting up $DEV_USER on $OS ($USER_HOME)"

#------------------------------------------------------------------------------
# 1. Packages
#------------------------------------------------------------------------------
if [ "$OS" = Darwin ]; then
    log "homebrew and packages"
    if ! command -v brew > /dev/null 2>&1 && [ ! -x /opt/homebrew/bin/brew ]; then
        log "  installing homebrew (it asks for your password)"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    BREW="$(command -v brew || echo /opt/homebrew/bin/brew)"
    eval "$("$BREW" shellenv)"
    brew install git curl wget gnupg jq htop tree unzip zsh
else
    log "apt packages"
    apt-get update -y
    apt-get install -y git curl wget ca-certificates gnupg jq htop tree unzip zsh
fi

#------------------------------------------------------------------------------
# 2. zsh, oh-my-zsh and the shell config
#
# oh-my-zsh's own installer is not used: it writes its own .zshrc from a
# template, which would fight the file written below on every run.
#------------------------------------------------------------------------------
log "zsh and oh-my-zsh"
OMZ="$USER_HOME/.oh-my-zsh"
clone_once() {
    as_user "[ -d '$2/.git' ] || git clone -q --depth 1 '$1' '$2'"
}
clone_once https://github.com/ohmyzsh/ohmyzsh.git "$OMZ"
clone_once https://github.com/zsh-users/zsh-autosuggestions.git "$OMZ/custom/plugins/zsh-autosuggestions"
clone_once https://github.com/zsh-users/zsh-syntax-highlighting.git "$OMZ/custom/plugins/zsh-syntax-highlighting"

zshrc_tmp="$(mktemp)"
cat > "$zshrc_tmp" <<'ZSHRC_EOF'
# Managed by utils/debbie/2026-09-17/payload/setup-developer-environment.sh.
# Rewritten whole on every run: edits here are lost. Put local settings in
# ~/.zshrc.local, which is sourced last and never touched.
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git docker node yarn zsh-autosuggestions zsh-syntax-highlighting)
# No self-update: it prompts on login and pulls from the network.
zstyle ':omz:update' mode disabled
source "$ZSH/oh-my-zsh.sh"

[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="$HOME/.local/bin:$PATH"
[ -d /usr/local/go/bin ] && export PATH="$PATH:/usr/local/go/bin"
export PATH="$PATH:$HOME/go/bin"

# Depth-based path display.
setopt promptsubst
autoload -U colors && colors
precmd() {
  if [[ $PWD == "/" ]]; then
    prompt_path="/"
  else
    depth=$(( $(echo "$PWD" | awk -F/ '{print NF-1}') - 1 ))
    dirname=$([[ $PWD == $HOME ]] && echo "~" || basename "$PWD")
    [[ $depth == 0 ]] && prompt_path="/$dirname" || prompt_path="/[$depth]/$dirname"
  fi
}
arrow='%(?:%F{green}➜%f:%F{red}➜%f)'
PROMPT='%B${arrow}%b %B%F{blue}%m%f%b %B%F{cyan}${prompt_path}%f%b $(git_prompt_info)'

alias cls=clear
# Project-local completions, if the directory you are in provides them.
[[ -f ./completions.zsh ]] && source ./completions.zsh

[ -f "$HOME/.zshrc.local" ] && source "$HOME/.zshrc.local"
ZSHRC_EOF
install -m 0644 -o "$DEV_USER" -g "$USER_GROUP" "$zshrc_tmp" "$USER_HOME/.zshrc"
rm -f "$zshrc_tmp"
as_user "mkdir -p '$USER_HOME/.local/bin'"

ZSH_PATH="$(command -v zsh)"
if [ "$(getent passwd "$DEV_USER" 2> /dev/null | cut -d: -f7 || dscl . -read "/Users/$DEV_USER" UserShell | awk '{print $2}')" != "$ZSH_PATH" ]; then
    log "  making zsh the login shell"
    if [ "$OS" = Darwin ]; then
        grep -qxF "$ZSH_PATH" /etc/shells || echo "$ZSH_PATH" | sudo tee -a /etc/shells > /dev/null
        chsh -s "$ZSH_PATH"
    else
        chsh -s "$ZSH_PATH" "$DEV_USER"
    fi
fi

#------------------------------------------------------------------------------
# 3. Node, corepack and Yarn
#
# Debian 13 ships Node 20 and a corepack package, so apt owns both and the
# security updates cover them. Yarn's version comes from the repository's own
# packageManager field once the checkout exists, further down.
#------------------------------------------------------------------------------
log "node $NODE_MAJOR, corepack and yarn"
if [ "$OS" = Darwin ]; then
    brew install "node@$NODE_MAJOR"
    brew link --overwrite --force "node@$NODE_MAJOR"
    as_user "corepack enable --install-directory '$USER_HOME/.local/bin'"
else
    apt-get install -y nodejs node-corepack
    corepack enable yarn
fi

#------------------------------------------------------------------------------
# 4. Docker
#------------------------------------------------------------------------------
log "docker"
if [ "$OS" = Darwin ]; then
    if [ ! -d /Applications/Docker.app ]; then
        brew install --cask docker
        log "  start Docker Desktop once to finish its setup"
    fi
else
    DOCKER_KEYRING=/etc/apt/keyrings/docker.gpg
    DOCKER_LIST=/etc/apt/sources.list.d/docker.list
    install -d -m 0755 /etc/apt/keyrings
    if [ ! -s "$DOCKER_KEYRING" ]; then
        log "  fetching Docker's apt signing key"
        # Dearmoured through a temp file: a curl that dies mid-stream would
        # otherwise leave a present, non-empty, unusable keyring, and the guard
        # above would skip repairing it forever.
        docker_key_tmp="$(mktemp)"
        curl -fsSL https://download.docker.com/linux/debian/gpg -o "$docker_key_tmp"
        gpg --batch --yes --dearmor -o "$DOCKER_KEYRING" "$docker_key_tmp"
        rm -f "$docker_key_tmp"
        chmod 0644 "$DOCKER_KEYRING"
    fi
    docker_deb_line="deb [arch=$(dpkg --print-architecture) signed-by=$DOCKER_KEYRING] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable"
    docker_repo_changed=0
    if [ ! -f "$DOCKER_LIST" ] || [ "$(cat "$DOCKER_LIST")" != "$docker_deb_line" ]; then
        log "  writing $DOCKER_LIST"
        printf '%s\n' "$docker_deb_line" > "$DOCKER_LIST"
        docker_repo_changed=1
    fi
    # Refresh the package lists only when there is a reason to. The second test
    # covers a machine whose previous run wrote the source and then failed
    # before installing.
    if [ "$docker_repo_changed" = 1 ] \
        || ! dpkg-query -W -f='${Status}' docker-ce 2> /dev/null | grep -q "^install ok installed"; then
        apt-get update -y
    fi
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    getent group docker > /dev/null || groupadd docker
    usermod -aG docker "$DEV_USER"
fi

#------------------------------------------------------------------------------
# 5. Go, then shist
#
# shist is Sean's shell-history tool. It is built from source because it is
# published as a repository rather than as a package.
#------------------------------------------------------------------------------
log "go"
if [ "$OS" = Darwin ]; then
    brew install go
else
    apt-get install -y golang-go
fi
GO_VERSION="$(as_user 'go version' | awk '{print $3}' | sed 's/^go//')"
# Sort the two versions and see which comes first. An older Go cannot build
# shist, and the error it gives names a module rather than the real cause.
if [ "$(printf '%s\n%s\n' "$GO_MIN" "$GO_VERSION" | sort -V | head -1)" != "$GO_MIN" ]; then
    die "go $GO_VERSION is older than $GO_MIN, which shist needs"
fi
log "  go $GO_VERSION"

log "shist"
SHIST_SRC="$USER_HOME/projects/shist"
as_user "mkdir -p '$USER_HOME/projects' '$USER_HOME/go/bin'"
clone_once "$SHIST_REPO" "$SHIST_SRC"
if ! as_user "[ -x '$USER_HOME/go/bin/shist' ]"; then
    log "  building"
    as_user "cd '$SHIST_SRC' && go build -o '$USER_HOME/go/bin/shist' ./src/main"
fi

#------------------------------------------------------------------------------
# 6. Claude Code
#------------------------------------------------------------------------------
log "claude code"
if have_user_bin claude || command -v claude > /dev/null 2>&1; then
    log "  already installed"
else
    as_user "curl -fsSL https://claude.ai/install.sh | bash"
fi

#------------------------------------------------------------------------------
# 7. seanorepo and the git config
#
# The clone is anonymous HTTPS, because the repository is public. On a target
# machine setup-server-environment.sh runs next and moves this checkout to the
# release branch.
#
# The git config comes from utils/config-anywhere, which is the one place that
# holds it. An existing ~/.gitconfig is left alone.
#------------------------------------------------------------------------------
log "seanorepo"
REPO_DIR="${REPO_DIR:-$USER_HOME/projects/seanorepo}"
clone_once "$REPO_URL" "$REPO_DIR"
if as_user "[ -f '$USER_HOME/.gitconfig' ]"; then
    log "  ~/.gitconfig exists - leaving it alone"
else
    log "  applying utils/config-anywhere/gitconfig.txt"
    as_user "cd '$REPO_DIR' && bash utils/config-anywhere/get-gitconfig.sh"
fi
if as_user "[ -f '$REPO_DIR/package.json' ]"; then
    as_user "cd '$REPO_DIR' && corepack prepare --activate"
fi

#------------------------------------------------------------------------------
# 8. iTerm2 (macOS only)
#------------------------------------------------------------------------------
if [ "$OS" = Darwin ]; then
    log "iterm2"
    if [ ! -d /Applications/iTerm.app ] && [ ! -d "$USER_HOME/Applications/iTerm.app" ]; then
        brew install --cask iterm2
    fi
    ITERM_PLIST="$HERE/com.googlecode.iterm2.plist"
    if [ ! -f "$ITERM_PLIST" ]; then
        log "  no preferences file beside this script - skipping the import"
    elif pgrep -qx iTerm2 2> /dev/null; then
        log "  iTerm2 is running - quit it and run this again to import preferences"
    else
        defaults import com.googlecode.iterm2 "$ITERM_PLIST"
        log "  preferences imported"
    fi
fi

log "done. Open a new shell to pick up zsh and PATH."
[ "$OS" = Linux ] && log "log out and in again for the docker group, or run: newgrp docker"
exit 0
