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
#   8. Windows Terminal colours and font (WSL only)
#
# It is idempotent: a second run leaves the machine in the same state. .zshrc
# is written whole every run, so edit this file rather than that one. Put
# machine-specific shell settings in ~/.zshrc.local, which this never touches.
#
# Usage:
#   macOS:  bash setup-developer-environment.sh
#   Debian: bash setup-developer-environment.sh (it asks for your sudo password)
#   As root for another account (provision.sh does this):
#           sudo DEV_USER=<user> bash setup-developer-environment.sh
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
# On Debian there are two ways to run it:
# - As you (a WSL install or a desktop). The steps that need root use sudo.
# - As root, for another account. provision.sh does this, because it must
#   create files for the deploy user. DEV_USER names that account.
#------------------------------------------------------------------------------
case "$OS" in
    Darwin)
        [ "$(id -u)" -ne 0 ] || die "on macOS, run this without sudo"
        DEV_USER="$(id -un)"
        USER_HOME="$HOME"
        ;;
    Linux)
        if [ "$(id -u)" -eq 0 ]; then
            DEV_USER="${DEV_USER:-${SUDO_USER:-}}"
            [ -n "$DEV_USER" ] || die "DEV_USER is not set, and there is no SUDO_USER to fall back on"
        else
            DEV_USER="$(id -un)"
            sudo -v || die "the Debian steps need sudo"
        fi
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

# Run a command as root. The script is root already under provision.sh, and
# uses sudo when you run it as yourself. sudo removes most of the environment,
# so env gives apt its non-interactive setting again.
as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    else
        sudo env DEBIAN_FRONTEND=noninteractive "$@"
    fi
}

# WSL: a Linux that runs inside Windows. It gets Windows-only extras (section 8).
IS_WSL=0
[ "$OS" = Linux ] && grep -qi microsoft /proc/version && IS_WSL=1
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
    brew install git curl wget gnupg jq htop tree unzip zsh gh
else
    log "apt packages"
    as_root apt-get update -y
    as_root apt-get install -y git curl wget ca-certificates gnupg jq htop tree unzip zsh gh
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
# pwdw: the Windows path of the current directory, for Explorer or a Windows
# app. Only WSL has a Windows path, so other systems get a warning.
pwdw() {
  if command -v wslpath > /dev/null; then
    wslpath -w "$PWD"
  else
    echo "pwdw: this is not WSL, so there is no Windows path" >&2
    return 1
  fi
}
# Project-local completions, if the directory you are in provides them.
[[ -f ./completions.zsh ]] && source ./completions.zsh

# Login animation: the image-to-ascii Go binary, which host-tools.sh installs
# (REQ-DEPLOY-007). It plays once, on an interactive SSH login only. scp, rsync
# and `ssh host cmd` are not interactive, so they stay silent. It holds the
# last frame until a key press. Any error is hidden.
_ascii_spec="$HOME/projects/seanorepo/utils/image-to-ascii/examples/sean-login.json"
if [[ -o interactive && -n "$SSH_TTY" && -x "$HOME/.local/bin/image-to-ascii" && -f "$_ascii_spec" ]]; then
  "$HOME/.local/bin/image-to-ascii" --spec "$_ascii_spec" --play --fit --hold 2> /dev/null
  printf '\033[?25h'
fi
unset _ascii_spec

[ -f "$HOME/.zshrc.local" ] && source "$HOME/.zshrc.local"
ZSHRC_EOF
install -m 0644 -o "$DEV_USER" -g "$USER_GROUP" "$zshrc_tmp" "$USER_HOME/.zshrc"
rm -f "$zshrc_tmp"
# An empty ~/.hushlogin silences the login text for this user: the uname line
# from /etc/update-motd.d, /etc/motd, and sshd's last-login line. The login
# animation in the .zshrc above shows the hostname and uptime instead.
as_user "touch '$USER_HOME/.hushlogin'"
as_user "mkdir -p '$USER_HOME/.local/bin'"

ZSH_PATH="$(command -v zsh)"
if [ "$(getent passwd "$DEV_USER" 2> /dev/null | cut -d: -f7 || dscl . -read "/Users/$DEV_USER" UserShell | awk '{print $2}')" != "$ZSH_PATH" ]; then
    log "  making zsh the login shell"
    if [ "$OS" = Darwin ]; then
        grep -qxF "$ZSH_PATH" /etc/shells || echo "$ZSH_PATH" | sudo tee -a /etc/shells > /dev/null
        chsh -s "$ZSH_PATH"
    else
        as_root chsh -s "$ZSH_PATH" "$DEV_USER"
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
    as_root apt-get install -y nodejs node-corepack
    as_root corepack enable yarn
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
    as_root install -d -m 0755 /etc/apt/keyrings
    if [ ! -s "$DOCKER_KEYRING" ]; then
        log "  fetching Docker's apt signing key"
        # Dearmoured through a temp file: a curl that dies mid-stream would
        # otherwise leave a present, non-empty, unusable keyring, and the guard
        # above would skip repairing it forever.
        docker_key_tmp="$(mktemp)"
        curl -fsSL https://download.docker.com/linux/debian/gpg -o "$docker_key_tmp"
        as_root gpg --batch --yes --dearmor -o "$DOCKER_KEYRING" "$docker_key_tmp"
        rm -f "$docker_key_tmp"
        as_root chmod 0644 "$DOCKER_KEYRING"
    fi
    docker_deb_line="deb [arch=$(dpkg --print-architecture) signed-by=$DOCKER_KEYRING] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable"
    docker_repo_changed=0
    if [ ! -f "$DOCKER_LIST" ] || [ "$(cat "$DOCKER_LIST")" != "$docker_deb_line" ]; then
        log "  writing $DOCKER_LIST"
        printf '%s\n' "$docker_deb_line" | as_root tee "$DOCKER_LIST" > /dev/null
        docker_repo_changed=1
    fi
    # Refresh the package lists only when there is a reason to. The second test
    # covers a machine whose previous run wrote the source and then failed
    # before installing.
    if [ "$docker_repo_changed" = 1 ] \
        || ! dpkg-query -W -f='${Status}' docker-ce 2> /dev/null | grep -q "^install ok installed"; then
        as_root apt-get update -y
    fi
    as_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    # A WSL install without systemd=true in /etc/wsl.conf has no systemd.
    if [ -d /run/systemd/system ]; then
        as_root systemctl enable --now docker
    else
        log "  no systemd - set systemd=true in /etc/wsl.conf, then run: wsl --shutdown"
    fi
    getent group docker > /dev/null || as_root groupadd docker
    as_root usermod -aG docker "$DEV_USER"
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

#------------------------------------------------------------------------------
# 8. Windows Terminal (WSL only)
#
# windows-terminal.json holds the iTerm2 colours as a Windows Terminal scheme,
# the profile defaults that use it, and key actions. Shift+Enter sends ESC+CR,
# which Claude Code reads as a newline. Ctrl+Backspace sends ^W, which deletes
# one word in zsh and in Claude Code. Monaco is not on Windows, so the font
# is Cascadia Mono, which comes with Windows Terminal. The merge replaces the
# scheme of the same name and keeps all other settings. A settings.json that
# jq cannot read (it has comments) is not changed.
#------------------------------------------------------------------------------
if [ "$IS_WSL" = 1 ]; then
    log "windows terminal"
    wt_appdata="$(as_user "cmd.exe /c 'echo %LOCALAPPDATA%' 2> /dev/null" | tr -d '\r' || true)"
    WT_SETTINGS="$(wslpath -u "$wt_appdata" 2> /dev/null || true)/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json"
    if [ ! -f "$WT_SETTINGS" ]; then
        log "  no Windows Terminal settings.json - skipping"
    elif wt_tmp="$(mktemp)" && jq --slurpfile wt "$HERE/windows-terminal.json" '
            .schemes = ([.schemes[]? | select(.name != $wt[0].scheme.name)] + [$wt[0].scheme])
            | .profiles.defaults += $wt[0].defaults
            | .actions = ([.actions[]? | select(.keys as $k | $wt[0].actions | map(.keys) | index($k) | not)] + $wt[0].actions)' "$WT_SETTINGS" > "$wt_tmp"; then
        cp "$WT_SETTINGS" "$WT_SETTINGS.bak"
        cat "$wt_tmp" > "$WT_SETTINGS"
        log "  scheme and font applied (the old file is settings.json.bak)"
    else
        log "  jq cannot read $WT_SETTINGS - skipping"
    fi
    rm -f "${wt_tmp:-}"
fi

# The .deb files apt keeps after installing are worth hundreds of megabytes on
# a machine that installs Docker and Node. Nothing reads them again.
if [ "$OS" = Linux ]; then
    log "clearing the apt cache"
    as_root apt-get clean
fi

log "done. Open a new shell to pick up zsh and PATH."
[ "$OS" = Linux ] && log "log out and in again for the docker group, or run: newgrp docker"
exit 0
