#!/bin/bash
#===============================================================================
# setup-developer-environment.sh
# 
# Installs developer tools: git, zsh, oh-my-zsh, node, docker, go, etc.
# Designed to be idempotent - safe to run multiple times.
#
# Usage: sudo ./setup-developer-environment.sh
#===============================================================================
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

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

get_user_home() {
    local user="$1"
    getent passwd "$user" | cut -d: -f6
}

run_as_user() {
    local user="$1"
    shift
    sudo -u "$user" bash -c "$*"
}

#-------------------------------------------------------------------------------
# Preflight checks
#-------------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run with sudo"
    exit 1
fi

ORIG_USER="$(get_orig_user)"
USER_HOME="$(get_user_home "$ORIG_USER")"

log "========================================"
log "Developer Environment Setup"
log "Started: $(date)"
log "User: $ORIG_USER"
log "Home: $USER_HOME"
log "========================================"

#-------------------------------------------------------------------------------
# Step: System update and base packages
#-------------------------------------------------------------------------------
log_step "System update and base packages"
{
    apt-get update -y
    apt-get dist-upgrade -y
    apt-get install -y \
        git curl wget ca-certificates gnupg lsb-release \
        build-essential make unzip jq htop tree
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
        apt-get install -y zsh
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
    CURRENT_SHELL=$(getent passwd "$ORIG_USER" | cut -d: -f7)
    ZSH_PATH=$(command -v zsh)
    if [ "$CURRENT_SHELL" != "$ZSH_PATH" ]; then
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
            sed -i "s/plugins=(git)/plugins=($ZSH_PLUGINS)/" "$USER_HOME/.zshrc"
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
        chown "$ORIG_USER:$ORIG_USER" "$USER_HOME/.zshrc"
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
    if [ -f "$USER_HOME/.zshrc" ] && ! grep -qF "$PATH_EXPORT" "$USER_HOME/.zshrc"; then
        echo "$COMPLETION_SCRIPT" >> "$USER_HOME/.zshrc"
    fi
    
    log_success "Local bin directory configured"
} || log_fail "Local bin directory setup"

#-------------------------------------------------------------------------------
# Step: Node.js installation
#-------------------------------------------------------------------------------
log_step "Node.js $NODE_VERSION installation"
{
    CURRENT_NODE=""
    if command_exists node; then
        CURRENT_NODE=$(node --version 2>/dev/null | grep -oP '\d+' | head -1)
    fi
    
    if [ "$CURRENT_NODE" != "$NODE_VERSION" ]; then
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
        apt-get install -y nodejs
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
    else
        log_skip "Docker already installed"
    fi
    
    # Ensure user is in docker group
    if ! groups "$ORIG_USER" | grep -qw docker; then
        usermod -aG docker "$ORIG_USER"
        log "  - User added to docker group"
    fi
} || log_fail "Docker installation"

#-------------------------------------------------------------------------------
# Step: Go installation
#-------------------------------------------------------------------------------
log_step "Go installation"
{
    if ! command_exists go; then
        apt-get install -y golang
        log_success "Go installed"
    else
        log_skip "Go already installed"
    fi
} || log_fail "Go installation"

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

    # Install gitconfig from repo
    run_as_user "$ORIG_USER" "cd '$REPO_DIR' && bash 'utils/config-anywhere/get-gitconfig.sh'"
    log_success "gitconfig installed"
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
    log "  - Log out and back in (or run: newgrp docker)"
    log "  - Start a new shell to use zsh"
    log ""
fi
