#!/bin/bash
#===============================================================================
# setup-developer-environment.sh
#
# Installs developer tools: git, zsh, oh-my-zsh, node, docker, go, shist, etc.
# Designed to be idempotent - safe to run multiple times.
#
# Usage:
#   Linux:  sudo ./setup-developer-environment.sh
#   macOS:  ./setup-developer-environment.sh
#===============================================================================
set -euo pipefail
IFS=$'\n\t'

OS="$(uname)"  # "Darwin" or "Linux"
[ "$OS" = "Linux" ] && export DEBIAN_FRONTEND=noninteractive

#-------------------------------------------------------------------------------
# Configuration
#-------------------------------------------------------------------------------
NODE_VERSION="20"
YARN_VERSION="4.8.1"
ZSH_PLUGINS="git docker node yarn zsh-autosuggestions zsh-syntax-highlighting"

#-------------------------------------------------------------------------------
# Logging setup
#-------------------------------------------------------------------------------
SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/${SCRIPT_NAME}.log"
STEP_COUNT=0
FAILED_STEPS=()

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

log_step() {
    STEP_COUNT=$((STEP_COUNT + 1))
    log "=== STEP $STEP_COUNT: $1 ==="
}

log_success() {
    log "✓ $1 - COMPLETE"
}

log_skip() {
    log "⊘ $1 - SKIPPED (already configured)"
}

log_fail() {
    log "✗ $1 - FAILED"
    FAILED_STEPS+=("Step $STEP_COUNT: $1")
}

#-------------------------------------------------------------------------------
# Helpers
#-------------------------------------------------------------------------------
command_exists() {
    command -v "$1" &>/dev/null
}

get_orig_user() {
    if [ -n "${SUDO_USER:-}" ]; then
        echo "$SUDO_USER"
    else
        echo "$USER"
    fi
}

get_passwd_field() {
    # Cross-platform replacement for: getent passwd "$user" | cut -d: -f<field>
    # field 6 = home directory, field 7 = shell
    local user="$1"
    local field="$2"
    if command -v getent >/dev/null 2>&1; then
        getent passwd "$user" | cut -d: -f"$field"
    elif [ "$OS" = "Darwin" ]; then
        case "$field" in
            6) dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2}' ;;
            7) dscl . -read "/Users/$user" UserShell 2>/dev/null | awk '{print $2}' ;;
        esac
    else
        grep "^${user}:" /etc/passwd | cut -d: -f"$field"
    fi
}

get_user_home() {
    local user="$1"
    get_passwd_field "$user" 6
}

run_as_user() {
    local user="$1"
    shift
    if [ "$(id -u)" -eq 0 ]; then
        sudo -u "$user" bash -c "$*"
    else
        bash -c "$*"
    fi
}

# Cross-platform sed -i (macOS requires an explicit backup suffix)
sed_inplace() {
    if [ "$OS" = "Darwin" ]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# Cross-platform package install
pkg_install() {
    if [ "$OS" = "Darwin" ]; then
        run_as_user "$ORIG_USER" "brew install $*"
    else
        apt-get install -y "$@"
    fi
}

#-------------------------------------------------------------------------------
# Preflight checks
#-------------------------------------------------------------------------------
if [ "$OS" = "Linux" ] && [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run with sudo on Linux"
    exit 1
fi

ORIG_USER="$(get_orig_user)"
USER_HOME="$(get_user_home "$ORIG_USER")"

log "========================================"
log "Developer Environment Setup"
log "Started: $(date)"
log "OS: $OS"
log "User: $ORIG_USER"
log "Home: $USER_HOME"
log "========================================"

#-------------------------------------------------------------------------------
# Step: Homebrew (macOS only)
#-------------------------------------------------------------------------------
if [ "$OS" = "Darwin" ]; then
    log_step "Homebrew installation"
    {
        if ! command_exists brew; then
            run_as_user "$ORIG_USER" \
                '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
            log_success "Homebrew installed"
        else
            run_as_user "$ORIG_USER" "brew update"
            log_skip "Homebrew already installed (updated)"
        fi
    } || log_fail "Homebrew installation"
fi

#-------------------------------------------------------------------------------
# Step: System update and base packages
#-------------------------------------------------------------------------------
log_step "System update and base packages"
{
    if [ "$OS" = "Darwin" ]; then
        pkg_install git curl wget gnupg jq htop tree unzip
    else
        apt-get update -y
        apt-get dist-upgrade -y
        apt-get install -y \
            git curl wget ca-certificates gnupg lsb-release \
            build-essential make unzip jq htop tree
    fi
    log_success "Base packages installed"
} || log_fail "Base packages"

#-------------------------------------------------------------------------------
# Step: Git configuration
#-------------------------------------------------------------------------------
log_step "Git configuration"
{
    if [ ! -f "$USER_HOME/.gitconfig" ]; then
        run_as_user "$ORIG_USER" "git config --global init.defaultBranch main"
        run_as_user "$ORIG_USER" "git config --global pull.rebase false"
        log_success "Git configured"
    else
        log_skip "Git already configured"
    fi
} || log_fail "Git configuration"

#-------------------------------------------------------------------------------
# Step: Zsh installation
#-------------------------------------------------------------------------------
log_step "Zsh installation"
{
    if ! command_exists zsh; then
        pkg_install zsh
        log_success "Zsh installed"
    else
        log_skip "Zsh already installed"
    fi
} || log_fail "Zsh installation"

#-------------------------------------------------------------------------------
# Step: Set Zsh as default shell
#-------------------------------------------------------------------------------
log_step "Set Zsh as default shell"
{
    CURRENT_SHELL=$(get_passwd_field "$ORIG_USER" 7)
    ZSH_PATH=$(command -v zsh)
    if [ "$CURRENT_SHELL" != "$ZSH_PATH" ]; then
        if [ "$OS" = "Darwin" ]; then
            # macOS: ensure zsh is in /etc/shells before chsh
            if ! grep -qF "$ZSH_PATH" /etc/shells; then
                echo "$ZSH_PATH" | sudo tee -a /etc/shells >/dev/null
            fi
        fi
        chsh -s "$ZSH_PATH" "$ORIG_USER"
        log_success "Zsh set as default shell"
    else
        log_skip "Zsh already default shell"
    fi
} || log_fail "Set Zsh as default shell"

#-------------------------------------------------------------------------------
# Step: Oh-My-Zsh installation
#-------------------------------------------------------------------------------
log_step "Oh-My-Zsh installation"
{
    if [ ! -d "$USER_HOME/.oh-my-zsh" ]; then
        export RUNZSH=no CHSH=no
        run_as_user "$ORIG_USER" \
            'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"'
        log_success "Oh-My-Zsh installed"
    else
        log_skip "Oh-My-Zsh already installed"
    fi
} || log_fail "Oh-My-Zsh installation"

#-------------------------------------------------------------------------------
# Step: Zsh plugins
#-------------------------------------------------------------------------------
log_step "Zsh plugins"
{
    ZSH_CUSTOM="${ZSH_CUSTOM:-$USER_HOME/.oh-my-zsh/custom}"

    # zsh-autosuggestions
    if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
        run_as_user "$ORIG_USER" \
            "git clone https://github.com/zsh-users/zsh-autosuggestions '$ZSH_CUSTOM/plugins/zsh-autosuggestions'"
        log "  - zsh-autosuggestions installed"
    fi

    # zsh-syntax-highlighting
    if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
        run_as_user "$ORIG_USER" \
            "git clone https://github.com/zsh-users/zsh-syntax-highlighting '$ZSH_CUSTOM/plugins/zsh-syntax-highlighting'"
        log "  - zsh-syntax-highlighting installed"
    fi

    # Update plugins list in .zshrc if not already set
    if [ -f "$USER_HOME/.zshrc" ]; then
        if ! grep -q "zsh-autosuggestions" "$USER_HOME/.zshrc"; then
            sed_inplace "s/plugins=(git)/plugins=($ZSH_PLUGINS)/" "$USER_HOME/.zshrc"
            log "  - Plugins configured in .zshrc"
        fi
    fi

    log_success "Zsh plugins configured"
} || log_fail "Zsh plugins"

#-------------------------------------------------------------------------------
# Step: Custom Zsh prompt
#-------------------------------------------------------------------------------
log_step "Custom Zsh prompt"
{
    PROMPT_MARKER="# Custom prompt configuration (depth-based path display)"
    if [ -f "$USER_HOME/.zshrc" ] && ! grep -q "$PROMPT_MARKER" "$USER_HOME/.zshrc"; then
        cat >> "$USER_HOME/.zshrc" <<'ZSHRC_EOF'

# Custom prompt configuration (depth-based path display)
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
ZSHRC_EOF
        [ "$OS" = "Linux" ] && chown "$ORIG_USER:$ORIG_USER" "$USER_HOME/.zshrc"
        log_success "Custom prompt added"
    else
        log_skip "Custom prompt already configured"
    fi
} || log_fail "Custom Zsh prompt"

#-------------------------------------------------------------------------------
# Step: Local bin directory
#-------------------------------------------------------------------------------
log_step "Local bin directory setup"
{
    LOCAL_BIN="$USER_HOME/.local/bin"
    run_as_user "$ORIG_USER" "mkdir -p '$LOCAL_BIN'"

    PATH_EXPORT='export PATH="$HOME/.local/bin:$PATH"'

    # Add to .profile if not present
    if [ -f "$USER_HOME/.profile" ] && ! grep -qF "$PATH_EXPORT" "$USER_HOME/.profile"; then
        echo "$PATH_EXPORT" >> "$USER_HOME/.profile"
    fi

    # Add to .zshrc if not present
    if [ -f "$USER_HOME/.zshrc" ] && ! grep -qF "$PATH_EXPORT" "$USER_HOME/.zshrc"; then
        echo "$PATH_EXPORT" >> "$USER_HOME/.zshrc"
    fi

    log_success "Local bin directory configured"
} || log_fail "Local bin directory setup"

#-------------------------------------------------------------------------------
# Step: Add auto-load completions to zsh
#-------------------------------------------------------------------------------
log_step "Add auto-load completions to zsh"
{
    COMPLETION_SCRIPT='[[ -f ./completions.zsh ]] && source ./completions.zsh'

    # Add to .profile if not present
    if [ -f "$USER_HOME/.profile" ] && ! grep -qF "$COMPLETION_SCRIPT" "$USER_HOME/.profile"; then
        echo "$COMPLETION_SCRIPT" >> "$USER_HOME/.profile"
    fi

    # Add to .zshrc if not present
    if [ -f "$USER_HOME/.zshrc" ] && ! grep -qF "$COMPLETION_SCRIPT" "$USER_HOME/.zshrc"; then
        echo "$COMPLETION_SCRIPT" >> "$USER_HOME/.zshrc"
    fi

    log_success "Add auto-load completions to zsh"
} || log_fail "Add auto-load completions to zsh"

#-------------------------------------------------------------------------------
# Step: Custom Zsh aliases and functions
#-------------------------------------------------------------------------------
log_step "Custom Zsh aliases and functions"
{
    ALIASES_MARKER="# Custom aliases and functions"
    if [ -f "$USER_HOME/.zshrc" ] && ! grep -q "$ALIASES_MARKER" "$USER_HOME/.zshrc"; then
        cat >> "$USER_HOME/.zshrc" <<'ZSHRC_EOF'

# Custom aliases and functions
alias cls=clear

hist() {
  local lines=100
  local file="$HOME/.zsh_history"
  local green='\033[0;32m'
  local yellow='\033[1;33m'
  local reset='\033[0m'

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        cat <<EOF
Usage: hist [N] [--file <path>]

Options:
  N            Show last N entries (use -1 to show all)
  -f, --file   Use specified file instead of ~/.zsh_history
  -h, --help   Show this help message

Examples:
  hist            # show last 100 entries
  hist 50         # show last 50 entries
  hist -1         # show entire history
  hist -f ~/.bash_history
EOF
        return 0
        ;;
      -f|--file)
        shift
        file="$1"
        ;;
      -*)
        if [[ "$1" =~ ^-[0-9]+$ ]]; then
          lines="$1"
        else
          echo "Unknown option: $1" >&2
          return 1
        fi
        ;;
      *)
        lines="$1"
        ;;
    esac
    shift
  done

  if [ "$lines" -eq 0 ]; then
    echo "No output (0 lines requested)."
    return 0
  fi

  # tac is GNU coreutils; fall back to tail -r on macOS/BSD
  _reverse() { command -v tac >/dev/null 2>&1 && tac || tail -r; }

  local total_lines input
  total_lines=$(wc -l < "$file")

  if [ "$lines" -lt 0 ]; then
    input=$(_reverse < "$file")
  else
    input=$(_reverse < "$file" | head -n "$lines")
  fi

  echo "$input" | awk -v total="$total_lines" '
    BEGIN { line = 0 }
    {
      rawline[++line] = $0
    }
    END {
      for (i = line; i >= 1; i--) {
        l = rawline[i]
        idx = total - (i - 1)
        if (l ~ /^: [0-9]+:0;/) {
          split(l, a, ";")
          raw = substr(a[1], 3)
          split(raw, tsParts, ":")
          timestamp = tsParts[1]
          cmd = a[2]
          printf "%s|%d|%s\n", timestamp, idx, cmd
        } else {
          printf "0|%d|%s\n", idx, l
        }
      }
    }
  ' | while IFS='|' read -r ts line cmd; do
    if [ "$ts" -ne 0 ] 2>/dev/null; then
      if date -d "@$ts" >/dev/null 2>&1; then
        dt=$(date -d "@$ts" +"%Y-%m-%d %H:%M")   # Linux
      else
        dt=$(date -r "$ts" +"%Y-%m-%d %H:%M")     # macOS/BSD
      fi
      printf "${green}%s${reset} | ${yellow}%d${reset}\t| %s\n" "$dt" "$line" "$cmd"
    else
      printf "\t | ${yellow}%d${reset}\t| %s\n" "$line" "$cmd"
    fi
  done
}
ZSHRC_EOF
        [ "$OS" = "Linux" ] && chown "$ORIG_USER:$ORIG_USER" "$USER_HOME/.zshrc"
        log_success "Custom aliases and functions added"
    else
        log_skip "Custom aliases and functions already configured"
    fi
} || log_fail "Custom Zsh aliases and functions"

#-------------------------------------------------------------------------------
# Step: Node.js installation
#-------------------------------------------------------------------------------
log_step "Node.js $NODE_VERSION installation"
{
    CURRENT_NODE=""
    if command_exists node; then
        CURRENT_NODE=$(node --version 2>/dev/null | grep -oE '[0-9]+' | head -1)
    fi

    if [ "$CURRENT_NODE" != "$NODE_VERSION" ]; then
        if [ "$OS" = "Darwin" ]; then
            run_as_user "$ORIG_USER" "brew install node@$NODE_VERSION"
            run_as_user "$ORIG_USER" "brew link --overwrite --force node@$NODE_VERSION"
        else
            curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
            apt-get install -y nodejs
        fi
        log_success "Node.js $NODE_VERSION installed"
    else
        log_skip "Node.js $NODE_VERSION already installed"
    fi
} || log_fail "Node.js installation"

#-------------------------------------------------------------------------------
# Step: Corepack and Yarn
#-------------------------------------------------------------------------------
log_step "Corepack and Yarn $YARN_VERSION"
{
    # Enable corepack user-locally
    run_as_user "$ORIG_USER" "corepack enable --install-directory '$USER_HOME/.local/bin'" || true

    # Check if yarn is already at correct version
    CURRENT_YARN=""
    if run_as_user "$ORIG_USER" "command -v yarn" &>/dev/null; then
        CURRENT_YARN=$(run_as_user "$ORIG_USER" "yarn --version 2>/dev/null" || echo "")
    fi

    if [ "$CURRENT_YARN" != "$YARN_VERSION" ]; then
        run_as_user "$ORIG_USER" "corepack prepare yarn@$YARN_VERSION --activate"
        log_success "Yarn $YARN_VERSION configured"
    else
        log_skip "Yarn $YARN_VERSION already configured"
    fi
} || log_fail "Corepack and Yarn"

#-------------------------------------------------------------------------------
# Step: Docker installation
#-------------------------------------------------------------------------------
log_step "Docker installation"
{
    if ! command_exists docker; then
        if [ "$OS" = "Darwin" ]; then
            # Docker Desktop is the standard on macOS - install via brew cask
            run_as_user "$ORIG_USER" "brew install --cask docker"
            log_success "Docker Desktop installed (launch it once to finish setup)"
        else
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/debian/gpg | \
                gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg

            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
                https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
                tee /etc/apt/sources.list.d/docker.list > /dev/null

            apt-get update
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            systemctl enable --now docker
            log_success "Docker installed"
        fi
    else
        log_skip "Docker already installed"
    fi

    # Ensure user is in docker group (Linux only - Docker Desktop handles this on macOS)
    if [ "$OS" = "Linux" ] && ! groups "$ORIG_USER" | grep -qw docker; then
        usermod -aG docker "$ORIG_USER"
        log "  - User added to docker group"
    fi
} || log_fail "Docker installation"

#-------------------------------------------------------------------------------
# Step: Go installation
#-------------------------------------------------------------------------------
log_step "Go installation"
{
    GO_LATEST=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -1)

    CURRENT_GO=""
    if command_exists go; then
        CURRENT_GO=$(go version 2>/dev/null | awk '{print $3}')
    fi

    if [ "$CURRENT_GO" != "$GO_LATEST" ]; then
        if [ "$OS" = "Darwin" ]; then
            run_as_user "$ORIG_USER" "brew install go"
        else
            ARCH=$(uname -m)
            case "$ARCH" in
                x86_64)  GO_ARCH="amd64" ;;
                aarch64) GO_ARCH="arm64" ;;
                *)        GO_ARCH="$ARCH" ;;
            esac
            curl -fsSL "https://go.dev/dl/${GO_LATEST}.linux-${GO_ARCH}.tar.gz" -o /tmp/go.tar.gz
            rm -rf /usr/local/go
            tar -C /usr/local -xzf /tmp/go.tar.gz
            rm /tmp/go.tar.gz
        fi
        log_success "Go $GO_LATEST installed"
    else
        log_skip "Go $GO_LATEST already installed"
    fi

    # Add Go to PATH in .zshrc (Linux tarball install needs explicit PATH; brew manages its own)
    if [ "$OS" = "Linux" ]; then
        GO_PATH_EXPORT='export PATH="$PATH:/usr/local/go/bin:$HOME/go/bin"'
        if [ -f "$USER_HOME/.zshrc" ] && ! grep -qF "/usr/local/go/bin" "$USER_HOME/.zshrc"; then
            echo "$GO_PATH_EXPORT" >> "$USER_HOME/.zshrc"
            log "  - Go PATH added to .zshrc"
        fi
    fi

    # On macOS, ~/go/bin still needs to be in PATH (brew puts go itself in PATH, not GOPATH/bin)
    GOBIN_EXPORT='export PATH="$PATH:$HOME/go/bin"'
    if [ -f "$USER_HOME/.zshrc" ] && ! grep -qF '$HOME/go/bin' "$USER_HOME/.zshrc"; then
        echo "$GOBIN_EXPORT" >> "$USER_HOME/.zshrc"
        log "  - GOPATH/bin added to .zshrc"
    fi
} || log_fail "Go installation"

#-------------------------------------------------------------------------------
# Step: Shist installation
#-------------------------------------------------------------------------------
log_step "Shist installation"
{
    # Resolve go binary path for this shell (may not be in PATH yet if just installed)
    GO_BIN=""
    if command_exists go; then
        GO_BIN="go"
    elif [ -x /usr/local/go/bin/go ]; then
        GO_BIN="/usr/local/go/bin/go"
    elif command_exists brew; then
        GO_BIN="$(brew --prefix go 2>/dev/null)/bin/go" || GO_BIN=""
    fi

    if [ -z "$GO_BIN" ]; then
        log "  - go not found in PATH, skipping shist (re-run after opening a new shell)"
        log_fail "Shist installation"
    else
        GOPATH_BIN="$USER_HOME/go/bin"
        if [ ! -x "$GOPATH_BIN/shist" ]; then
            run_as_user "$ORIG_USER" \
                "export PATH=\"\$PATH:$(dirname "$GO_BIN")\" && go install github.com/seanmizen/shist@latest"
            log_success "shist installed"
        else
            log_skip "shist already installed"
        fi

        # Add SHIST_DEFAULT_MIN_INDEX to .zshrc
        SHIST_CONFIG='export SHIST_DEFAULT_MIN_INDEX=4000'
        if [ -f "$USER_HOME/.zshrc" ] && ! grep -qF "SHIST_DEFAULT_MIN_INDEX" "$USER_HOME/.zshrc"; then
            echo "$SHIST_CONFIG" >> "$USER_HOME/.zshrc"
            log "  - SHIST_DEFAULT_MIN_INDEX set in .zshrc"
        fi
    fi
} || log_fail "Shist installation"

#-------------------------------------------------------------------------------
# Step: Claude Code installation
#-------------------------------------------------------------------------------
log_step "Claude Code installation"
{
    if ! command_exists claude; then
        run_as_user "$ORIG_USER" "curl -fsSL https://claude.ai/install.sh | bash"
        log_success "Claude Code installed"
    else
        log_skip "Claude Code already installed"
    fi
} || log_fail "Claude Code installation"

#-------------------------------------------------------------------------------
# Step: Projects directory
#-------------------------------------------------------------------------------
log_step "Projects directory"
{
    PROJECTS_DIR="$USER_HOME/projects"
    if [ ! -d "$PROJECTS_DIR" ]; then
        run_as_user "$ORIG_USER" "mkdir -p '$PROJECTS_DIR'"
        log_success "Projects directory created"
    else
        log_skip "Projects directory exists"
    fi
} || log_fail "Projects directory"

#-------------------------------------------------------------------------------
# Step: Install seanorepo
#-------------------------------------------------------------------------------
log_step "Install seanorepo"
{
    PROJECTS_DIR="$USER_HOME/projects"
    REPO_DIR="$PROJECTS_DIR/seanorepo"

    # Clone repo if not already present
    if [ ! -d "$REPO_DIR/.git" ]; then
        run_as_user "$ORIG_USER" "git clone 'https://github.com/seanmizen/seanorepo' '$REPO_DIR'"
        log_success "seanorepo cloned"
    else
        log_skip "seanorepo already cloned"
    fi

    # Install gitconfig from repo (only if .gitconfig doesn't already exist)
    if [ ! -f "$USER_HOME/.gitconfig" ]; then
        run_as_user "$ORIG_USER" "cd '$REPO_DIR' && bash 'utils/config-anywhere/get-gitconfig.sh'"
        log_success "gitconfig installed"
    else
        log_skip "gitconfig already exists"
    fi
} || log_fail "Install seanorepo"

#-------------------------------------------------------------------------------
# Summary
#-------------------------------------------------------------------------------
log ""
log "========================================"
log "Developer Environment Setup Complete"
log "Finished: $(date)"
log "Total steps: $STEP_COUNT"
log "========================================"

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
    log ""
    log "⚠ FAILED STEPS:"
    for step in "${FAILED_STEPS[@]}"; do
        log "  - $step"
    done
    log ""
    log "Review log file for details: $LOG_FILE"
    exit 1
else
    log ""
    log "✓ All steps completed successfully!"
    log ""
    log "Next steps:"
    if [ "$OS" = "Linux" ]; then
        log "  - Log out and back in (or run: newgrp docker)"
    fi
    log "  - Open a new shell to pick up zsh and PATH changes"
    log ""
fi
