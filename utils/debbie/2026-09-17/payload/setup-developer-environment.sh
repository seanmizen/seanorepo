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
#   3. Node and Yarn
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
#
# Output (the flag, or VERBOSITY=quiet|default|verbose):
#   (default)       one line per step and one line per result, with a
#                   timestamp. Command output goes to a log file.
#   -q, --quiet     warnings, errors and the last line only.
#   -v, --verbose   the full output of every command, as it runs.
# A failed command shows its last 20 lines and the path of the full log.
# On a terminal, colour marks what changed or went wrong: green for a change
# ("2 new", "cloned"), a yellow warning, a red error. A run that changes
# nothing has no colour. NO_COLOR=1 removes the colours.
set -euo pipefail
IFS=$'\n\t'

REPO_URL="${REPO_URL:-https://github.com/seanmizen/seanorepo.git}"

OS="$(uname -s)"
HERE="$(cd "$(dirname "$0")" && pwd)"
VERBOSITY="${VERBOSITY:-default}"
for arg in "$@"; do
    case "$arg" in
        -q | --quiet) VERBOSITY=quiet ;;
        -v | --verbose) VERBOSITY=verbose ;;
        -h | --help) sed -n '2,/^set -euo/{/^#/s/^# \{0,1\}//p}' "$0"; exit 0 ;;
        *) echo "[dev-setup] ERROR: unknown option: $arg (use --help)" >&2; exit 2 ;;
    esac
done

# Every command's output goes to this log, in all modes.
SETUP_LOG="$(mktemp "${TMPDIR:-/tmp}/dev-setup.XXXXXX")"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_OK=$'\033[32m' C_WARN=$'\033[33m' C_ERR=$'\033[31m' C_OFF=$'\033[0m'
else
    C_OK='' C_WARN='' C_ERR='' C_OFF=''
fi
# say MESSAGE: one output line, with the prefix and a timestamp. The prefix
# and the timestamp never have colour.
say() { printf '[dev-setup] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
# green TEXT: the TEXT in green, for the part of a line that is a change.
green() { printf '%s%s%s' "$C_OK" "$*" "$C_OFF"; }
# count N WORD: "N WORD", green when N is more than 0.
count() { if [ "$1" -gt 0 ]; then green "$1 $2"; else printf '%s %s' "$1" "$2"; fi; }
log() { [ "$VERBOSITY" = quiet ] || say "$*"; }
note() { log "  $*"; }
warn() { say "${C_WARN}WARNING: $*${C_OFF}" >&2; }
die() { say "${C_ERR}ERROR: $*${C_OFF}" >&2; say "${C_ERR}Full log: $SETUP_LOG${C_OFF}" >&2; exit 1; }
trap 'say "${C_ERR}ERROR: line $LINENO failed. Full log: $SETUP_LOG${C_OFF}" >&2' ERR

# Run a command and keep its output in the log. In verbose mode the output is
# also shown. Otherwise it is shown only when the command fails. stdin is
# closed, so a command that asks a question fails and does not wait for an
# answer that nobody sees. RUN_OUT holds the output of the last command.
RUN_OUT="$(mktemp)"
run() {
    local rc=0
    echo "\$ $*" >> "$SETUP_LOG"
    if [ "$VERBOSITY" = verbose ]; then
        "$@" < /dev/null 2>&1 | tee "$RUN_OUT" || rc=$?
    else
        "$@" < /dev/null > "$RUN_OUT" 2>&1 || rc=$?
    fi
    cat "$RUN_OUT" >> "$SETUP_LOG"
    if [ "$rc" -ne 0 ]; then
        if [ "$VERBOSITY" != verbose ]; then
            say "${C_ERR}The last lines of: $*${C_OFF}" >&2
            tail -n 20 "$RUN_OUT" | sed 's/^/    /' >&2
        fi
        die "command failed (exit $rc): $*"
    fi
}

# Install packages and log what changed. apt states the counts itself: one
# "is already the newest version" line for each package that is current. brew
# does not, so the count of new packages is the change in the installed list.
pkg_install() {
    local before after
    if [ "$OS" = Darwin ]; then
        before="$(brew list -1 | wc -l)"
        run brew install "$@"
        after="$(brew list -1 | wc -l)"
        note "$# packages: $(count $(( after - before )) new), $(( $# - (after - before) )) already installed or upgraded"
    else
        run as_root apt-get install -y "$@"
        local new upgraded current
        new="$(grep -Eo '[0-9]+ newly installed' "$RUN_OUT" | grep -Eo '^[0-9]+' || echo 0)"
        upgraded="$(grep -Eo '^[0-9]+ upgraded' "$RUN_OUT" | grep -Eo '^[0-9]+' || echo 0)"
        current="$(grep -c 'is already the newest version' "$RUN_OUT" || true)"
        note "$# packages: $(count "$new" new), $(count "$upgraded" upgraded), $current already up to date"
    fi
}
export HOMEBREW_NO_ENV_HINTS=1

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

# Run a command as DEV_USER. Quoting note: the argument is one shell string.
# As root, a login shell gives DEV_USER its own environment. As the current
# user, the command keeps this script's PATH. A login shell would load the
# profile again, which can put an old Node in front of the one installed here.
as_user() {
    if [ "$(id -u)" -eq 0 ]; then
        sudo -H -u "$DEV_USER" bash -lc "$*"
    else
        bash -c "$*"
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
if [ "$OS" = Darwin ]; then
    OS_NAME="macOS $(sw_vers -productVersion)"
else
    OS_NAME="$(. /etc/os-release && echo "$PRETTY_NAME")"
    [ "$IS_WSL" = 0 ] || OS_NAME="$OS_NAME, WSL"
fi
log "Setting up user $DEV_USER on $OS_NAME, home $USER_HOME"
log "Full log: $SETUP_LOG"

#------------------------------------------------------------------------------
# 1. Packages
#------------------------------------------------------------------------------
if [ "$OS" = Darwin ]; then
    log "Installing Homebrew packages"
    if ! command -v brew > /dev/null 2>&1 && [ ! -x /opt/homebrew/bin/brew ]; then
        warn "Installing Homebrew - it asks for your password"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    BREW="$(command -v brew || echo /opt/homebrew/bin/brew)"
    eval "$("$BREW" shellenv)"
    pkg_install git curl wget gnupg jq htop tree unzip zsh gh
else
    log "Installing apt packages"
    run as_root apt-get update -y
    pkg_install git curl wget ca-certificates gnupg jq htop tree unzip zsh gh
fi

#------------------------------------------------------------------------------
# 2. zsh, oh-my-zsh and the shell config
#
# oh-my-zsh's own installer is not used: it writes its own .zshrc from a
# template, which would fight the file written below on every run.
#------------------------------------------------------------------------------
log "Installing oh-my-zsh and its plugins"
OMZ="$USER_HOME/.oh-my-zsh"
clone_once() {
    if as_user "[ -d '$2/.git' ]"; then
        note "${2##*/}: already cloned"
    else
        run as_user "git clone -q --depth 1 '$1' '$2'"
        note "$(green "${2##*/}: cloned")"
    fi
}
clone_once https://github.com/ohmyzsh/ohmyzsh.git "$OMZ"
clone_once https://github.com/zsh-users/zsh-autosuggestions.git "$OMZ/custom/plugins/zsh-autosuggestions"
clone_once https://github.com/zsh-users/zsh-syntax-highlighting.git "$OMZ/custom/plugins/zsh-syntax-highlighting"

log "Writing the zsh config and login shell"
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
if cmp -s "$zshrc_tmp" "$USER_HOME/.zshrc"; then
    note "~/.zshrc is current (managed: put local settings in ~/.zshrc.local)"
else
    install -m 0644 -o "$DEV_USER" -g "$USER_GROUP" "$zshrc_tmp" "$USER_HOME/.zshrc"
    note "$(green "~/.zshrc updated") (managed: put local settings in ~/.zshrc.local)"
fi
rm -f "$zshrc_tmp"
# An empty ~/.hushlogin silences the login text for this user: the uname line
# from /etc/update-motd.d, /etc/motd, and sshd's last-login line. The login
# animation in the .zshrc above shows the hostname and uptime instead.
as_user "touch '$USER_HOME/.hushlogin'"
as_user "mkdir -p '$USER_HOME/.local/bin'"

ZSH_PATH="$(command -v zsh)"
if [ "$(getent passwd "$DEV_USER" 2> /dev/null | cut -d: -f7 || dscl . -read "/Users/$DEV_USER" UserShell | awk '{print $2}')" != "$ZSH_PATH" ]; then
    note "$(green "Login shell changed to zsh")"
    if [ "$OS" = Darwin ]; then
        grep -qxF "$ZSH_PATH" /etc/shells || echo "$ZSH_PATH" | sudo tee -a /etc/shells > /dev/null
        chsh -s "$ZSH_PATH"
    else
        as_root chsh -s "$ZSH_PATH" "$DEV_USER"
    fi
else
    note "Login shell is already zsh"
fi

#------------------------------------------------------------------------------
# 3. Node and Yarn
#
# No Node version is pinned. Each system takes the Node that its package
# manager ships: the latest release from Homebrew, and the release's Node from
# Debian's apt. The package manager then keeps it updated.
#
# There is no corepack. The repository carries its own Yarn release, and
# .yarnrc.yml names it in yarnPath. Any `yarn` on the PATH gives control to
# that release, so the system Yarn must only exist:
# - macOS: Homebrew's yarn formula (Yarn 1).
# - Debian: the yarnpkg package (Yarn 4). It installs the command as yarnpkg
#   only, so /usr/local/bin/yarn links to it. deploy.sh finds yarn there.
#
# A machine that an older version of this script set up has corepack and its
# yarn shims. The shims come first on the PATH, so this step removes them, and
# removes corepack.
#------------------------------------------------------------------------------
log "Installing node and yarn"
# remove_corepack_shims OWNER DIR: remove each package manager link in DIR
# that points into corepack. OWNER is user or root, for who owns DIR.
remove_corepack_shims() {
    local f
    for f in "$2"/yarn "$2"/yarnpkg "$2"/pnpm "$2"/pnpx; do
        if [ -L "$f" ] && readlink "$f" | grep -q corepack; then
            if [ "$1" = root ]; then
                run as_root rm -f "$f"
            else
                run as_user "rm -f '$f'"
            fi
            note "$(green "Removed the corepack shim $f")"
        fi
    done
}
if [ "$OS" = Darwin ]; then
    remove_corepack_shims user "$USER_HOME/.local/bin"
    # The corepack formula conflicts with the yarn formula.
    if brew list corepack > /dev/null 2>&1; then
        run brew uninstall corepack
        note "$(green "Removed the corepack formula")"
    fi
    pkg_install node yarn
else
    remove_corepack_shims root /usr/bin
    if dpkg-query -W -f='${Status}' node-corepack 2> /dev/null | grep -q "^install ok installed"; then
        run as_root apt-get purge -y node-corepack
        note "$(green "Removed the node-corepack package")"
    fi
    pkg_install nodejs yarnpkg
    if [ "$(readlink /usr/local/bin/yarn 2> /dev/null || true)" != /usr/bin/yarnpkg ]; then
        run as_root ln -sfn /usr/bin/yarnpkg /usr/local/bin/yarn
        note "$(green "Linked /usr/local/bin/yarn to yarnpkg")"
    fi
fi
note "Node $(node --version), system Yarn $(cd / && yarn --version)"

#------------------------------------------------------------------------------
# 4. Docker
#------------------------------------------------------------------------------
log "Installing docker"
if [ "$OS" = Darwin ]; then
    if [ ! -d /Applications/Docker.app ]; then
        run brew install --cask docker
        warn "Start Docker Desktop once to finish its setup"
    fi
else
    DOCKER_KEYRING=/etc/apt/keyrings/docker.gpg
    DOCKER_LIST=/etc/apt/sources.list.d/docker.list
    as_root install -d -m 0755 /etc/apt/keyrings
    if [ ! -s "$DOCKER_KEYRING" ]; then
        note "$(green "Fetching Docker's apt signing key")"
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
        note "$(green "Writing $DOCKER_LIST")"
        printf '%s\n' "$docker_deb_line" | as_root tee "$DOCKER_LIST" > /dev/null
        docker_repo_changed=1
    fi
    # Refresh the package lists only when there is a reason to. The second test
    # covers a machine whose previous run wrote the source and then failed
    # before installing.
    if [ "$docker_repo_changed" = 1 ] \
        || ! dpkg-query -W -f='${Status}' docker-ce 2> /dev/null | grep -q "^install ok installed"; then
        run as_root apt-get update -y
    fi
    pkg_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    # A WSL install without systemd=true in /etc/wsl.conf has no systemd.
    if [ -d /run/systemd/system ]; then
        run as_root systemctl enable --now docker
    else
        warn "No systemd - set systemd=true in /etc/wsl.conf, then run: wsl --shutdown"
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
log "Installing shist"
if [ "$OS" = Darwin ]; then
    run brew tap seanmizen/tap
    run brew trust --tap seanmizen/tap
    brew list shist > /dev/null 2>&1 || run brew install shist
elif [ -x "$USER_HOME/.local/bin/shist" ]; then
    note "Already installed: $(as_user "$USER_HOME/.local/bin/shist --version" 2>/dev/null || echo present)"
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
    note "Downloading $shist_tar"
    curl -fsSL "$shist_url/$shist_tar" -o "$shist_tmp/$shist_tar"
    curl -fsSL "$shist_url/checksums.txt" -o "$shist_tmp/checksums.txt"
    ( cd "$shist_tmp" && grep " $shist_tar\$" checksums.txt | sha256sum -c - ) \
        || die "the shist download does not match its published checksum"
    tar -xzf "$shist_tmp/$shist_tar" -C "$shist_tmp" shist
    install -m 0755 -o "$DEV_USER" -g "$USER_GROUP" "$shist_tmp/shist" "$USER_HOME/.local/bin/shist"
    rm -rf "$shist_tmp"
    note "$(green "Installed shist $shist_ver")"
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
log "Cloning seanorepo and applying the git config"
REPO_DIR="${REPO_DIR:-$USER_HOME/projects/seanorepo}"
clone_once "$REPO_URL" "$REPO_DIR"
if as_user "[ -f '$USER_HOME/.gitconfig' ]"; then
    note "~/.gitconfig exists, so it is kept. To apply config-anywhere, remove it and run again"
else
    note "$(green "Applying utils/config-anywhere/gitconfig.txt")"
    run as_user "cd '$REPO_DIR' && bash utils/config-anywhere/get-gitconfig.sh"
fi
note "Yarn $(as_user "cd '$REPO_DIR' && yarn --version") in the repository"

#------------------------------------------------------------------------------
# 7. iTerm2 (macOS only)
#------------------------------------------------------------------------------
if [ "$OS" = Darwin ]; then
    log "Installing iTerm2 and its preferences"
    if [ ! -d /Applications/iTerm.app ] && [ ! -d "$USER_HOME/Applications/iTerm.app" ]; then
        run brew install --cask iterm2
    fi
    ITERM_PLIST="$HERE/com.googlecode.iterm2.plist"
    if [ ! -f "$ITERM_PLIST" ]; then
        warn "No preferences file beside this script - skipping the import"
    elif pgrep -qx iTerm2 2> /dev/null; then
        warn "iTerm2 is running - quit it and run this again to import preferences"
    else
        run defaults import com.googlecode.iterm2 "$ITERM_PLIST"
        note "Preferences imported"
    fi
fi

#------------------------------------------------------------------------------
# 8. Windows Terminal (WSL only)
#
# windows-terminal.json holds the iTerm2 colours as a Windows Terminal scheme,
# the profile defaults that use it, and key actions. It uses the format that
# Windows Terminal writes back (upper-case colours, actions with an id and a
# separate keybindings list), so a second run finds no change. Shift+Enter sends ESC+CR,
# which Claude Code reads as a newline. Ctrl+Backspace sends ^W, which deletes
# one word in zsh and in Claude Code. Monaco is not on Windows, so the font
# is Cascadia Mono, which comes with Windows Terminal. The merge replaces the
# scheme of the same name and keeps all other settings. A settings.json that
# jq cannot read (it has comments) is not changed.
#------------------------------------------------------------------------------
if [ "$IS_WSL" = 1 ]; then
    log "Applying the Windows Terminal colours, font and keys"
    wt_appdata="$(as_user "cmd.exe /c 'echo %LOCALAPPDATA%' 2> /dev/null" | tr -d '\r' || true)"
    WT_SETTINGS="$(wslpath -u "$wt_appdata" 2> /dev/null || true)/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json"
    if [ ! -f "$WT_SETTINGS" ]; then
        warn "No Windows Terminal settings.json - skipping"
    # upsert(NEW; KEY): replace each entry of NEW in place where KEY matches,
    # and append the others. The order of the other entries does not change,
    # so a second run gives the same file.
    elif wt_tmp="$(mktemp)" && jq --slurpfile wt "$HERE/windows-terminal.json" '
            def upsert($new; f): reduce $new[] as $n (. // [];
                if any(.[]; f == ($n | f)) then map(if f == ($n | f) then $n else . end) else . + [$n] end);
            $wt[0] as $w
            | .schemes |= upsert([$w.scheme]; .name)
            | .profiles.defaults += $w.defaults
            | .actions |= upsert($w.actions; .id)
            | .keybindings |= upsert($w.keybindings; .keys)' "$WT_SETTINGS" > "$wt_tmp"; then
        # Compare the JSON, not the bytes: Windows Terminal reformats the file.
        if [ "$(jq -S . "$wt_tmp")" = "$(jq -S . "$WT_SETTINGS")" ]; then
            note "Already applied"
        else
            cp "$WT_SETTINGS" "$WT_SETTINGS.bak"
            cat "$wt_tmp" > "$WT_SETTINGS"
            note "$(green "Settings applied") (the old file is settings.json.bak)"
        fi
    else
        warn "Cannot read $WT_SETTINGS with jq - skipping"
    fi
    rm -f "${wt_tmp:-}"
fi

# The .deb files apt keeps after installing are worth hundreds of megabytes on
# a machine that installs Docker and Node. Nothing reads them again.
if [ "$OS" = Linux ]; then
    log "Clearing the apt cache"
    run as_root apt-get clean
    note "Cleared"
fi

rm -f "$RUN_OUT"
# The docker group applies to new logins only. The warning is for a user who
# runs this script as themself and is not in the group yet in this session.
if [ "$OS" = Linux ] && [ "$(id -un)" = "$DEV_USER" ] && ! id -nG | grep -qw docker; then
    warn "Log out and in again for the docker group, or run: newgrp docker"
fi
say "$(green Done.) Open a new shell to pick up zsh and PATH. Full log: $SETUP_LOG"
exit 0
