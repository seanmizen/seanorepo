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
#   5. shist, from its release
#   6. ~/projects, the seanorepo clone, and the git config from config-anywhere
#   7. iTerm2 and its preferences (macOS only)
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

# Login animation, from utils/image-to-ascii. It plays once, on an interactive
# SSH login only. scp, rsync and `ssh host cmd` are not interactive, so they
# stay silent. A key press skips to the last frame. `timeout` caps it, and any
# error is hidden, so it never blocks the prompt.
_ascii_repo="$HOME/projects/seanorepo/utils/image-to-ascii"
if [[ -o interactive && -n "$SSH_TTY" && -f "$_ascii_repo/examples/login.json" ]] \
  && command -v node > /dev/null && command -v timeout > /dev/null; then
  timeout 8 node "$_ascii_repo/src/cli.mjs" --spec "$_ascii_repo/examples/login.json" \
    --play --fit 2> /dev/null
  printf '\033[?25h'
fi
unset _ascii_repo

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
# 5. shist
#
# Sean's shell-history tool. It is installed from a release, so no machine
# needs a Go toolchain (which cost 279 MB when this built shist from source).
#
# macOS takes it from the tap, which a daily workflow keeps in step with the
# releases. Homebrew asks for trust before it loads a third-party tap, and
# `brew trust --tap` answers that without a prompt.
#
# Linux downloads the release. The checksum is verified against the
# checksums.txt of the same release, because this is a binary from the
# internet, and an interrupted download is otherwise a file that runs.
#------------------------------------------------------------------------------
log "shist"
if [ "$OS" = Darwin ]; then
    brew tap seanmizen/tap
    brew trust --tap seanmizen/tap
    brew list shist > /dev/null 2>&1 || brew install shist
elif [ -x "$USER_HOME/.local/bin/shist" ]; then
    log "  already installed: $(as_user "$USER_HOME/.local/bin/shist --version" 2>/dev/null || echo present)"
else
    case "$(uname -m)" in
        x86_64)  shist_arch=amd64 ;;
        aarch64) shist_arch=arm64 ;;
        *) die "no shist release for $(uname -m)" ;;
    esac
    shist_ver="$(curl -fsSL https://api.github.com/repos/seanmizen/shist/releases/latest | jq -r .tag_name)"
    shist_ver="${shist_ver#v}"
    [ -n "$shist_ver" ] && [ "$shist_ver" != null ] || die "could not read the latest shist release"
    shist_tmp="$(mktemp -d)"
    shist_tar="shist_${shist_ver}_linux_${shist_arch}.tar.gz"
    shist_url="https://github.com/seanmizen/shist/releases/download/v$shist_ver"
    log "  downloading $shist_tar"
    curl -fsSL "$shist_url/$shist_tar" -o "$shist_tmp/$shist_tar"
    curl -fsSL "$shist_url/checksums.txt" -o "$shist_tmp/checksums.txt"
    ( cd "$shist_tmp" && grep " $shist_tar\$" checksums.txt | sha256sum -c - ) \
        || die "the shist download does not match its published checksum"
    tar -xzf "$shist_tmp/$shist_tar" -C "$shist_tmp" shist
    install -m 0755 -o "$DEV_USER" -g "$USER_GROUP" "$shist_tmp/shist" "$USER_HOME/.local/bin/shist"
    rm -rf "$shist_tmp"
    log "  installed shist $shist_ver"
fi

#------------------------------------------------------------------------------
# 6. seanorepo and the git config
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
# 7. iTerm2 (macOS only)
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

# The .deb files apt keeps after installing are worth hundreds of megabytes on
# a machine that installs Docker and Node. Nothing reads them again.
if [ "$OS" = Linux ]; then
    log "clearing the apt cache"
    apt-get clean
fi

log "done. Open a new shell to pick up zsh and PATH."
[ "$OS" = Linux ] && log "log out and in again for the docker group, or run: newgrp docker"
exit 0
