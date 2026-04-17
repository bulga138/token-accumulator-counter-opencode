#!/bin/bash
# =============================================================================
# install.sh — Install taco (Token Accumulator Counter)
# https://github.com/bulga138/token-accumulator-counter-opencode
#
# This script installs the TypeScript-based taco CLI
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/bulga138/token-accumulator-counter-opencode/master/install.sh | bash
#   ./install.sh --system   # System-wide install (requires sudo)
#   ./install.sh --local    # Local install only (default)
# =============================================================================

set -euo pipefail

# --- Remote bootstrap: detect piped execution (curl | bash) ---
# When piped, BASH_SOURCE[0] is empty — no local repo files exist.
# Download the latest release archive and re-exec from the extracted dir.
if [[ -z "${BASH_SOURCE[0]:-}" ]] || [[ "${BASH_SOURCE[0]}" == "bash" ]]; then
  REPO="bulga138/token-accumulator-counter-opencode"
  GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

  command -v curl &>/dev/null || { echo "Error: curl is required"; exit 1; }
  command -v tar  &>/dev/null || { echo "Error: tar is required"; exit 1; }

  echo "Fetching latest TACO release..."
  LATEST_TAG=$(curl -fsSL "$GITHUB_API" | grep -o '"tag_name": "[^"]*"' | cut -d'"' -f4)
  if [[ -z "$LATEST_TAG" ]]; then
    echo "Error: Could not determine latest release from GitHub"
    exit 1
  fi

  ARCHIVE_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/taco-release-${LATEST_TAG}.tar.gz"
  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TEMP_DIR"' EXIT

  echo "Downloading TACO ${LATEST_TAG}..."
  curl -fsSL "$ARCHIVE_URL" | tar xz -C "$TEMP_DIR"

  # Re-exec from the extracted archive — BASH_SOURCE[0] will be a real path
  exec bash "$TEMP_DIR/install.sh" "$@"
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Colors ---
if [[ -t 1 ]]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  CYAN="\033[0;36m"
  RED="\033[0;31m"
  RESET="\033[0m"
else
  BOLD='' GREEN='' YELLOW='' CYAN='' RED='' RESET=''
fi

info()    { echo -e "${CYAN}  ->${RESET} $*"; }
success() { echo -e "${GREEN}  [OK]${RESET} $*"; }
warn()    { echo -e "${YELLOW}  [WARN]${RESET} $*"; }
error()   { echo -e "${RED}  [ERROR]${RESET} $*" >&2; exit 1; }

# Offer to install Bun if not already present
prompt_install_bun() {
  # Already installed — nothing to do
  command -v bun &>/dev/null && return 0

  # Non-interactive (e.g. curl | bash) — skip silently
  [[ -t 0 ]] || return 0

  echo ""
  echo -e "${BOLD}Bun not detected${RESET}"
  echo -e "Bun provides faster startup and built-in SQLite (no native compilation needed)."
  echo ""
  read -rp "Would you like to install Bun? [Y/n] " INSTALL_BUN
  INSTALL_BUN="${INSTALL_BUN:-Y}"

  if [[ ! "$INSTALL_BUN" =~ ^[Yy]$ ]]; then
    info "Skipping Bun installation — continuing with Node.js"
    return 0
  fi

  echo ""
  echo -e "${BOLD}Choose install method:${RESET}"

  case "$OS" in
    macos)
      echo "  1) brew install oven-sh/bun/bun  (Recommended)"
      echo "  2) curl -fsSL https://bun.com/install | bash"
      echo "  3) npm install -g bun"
      read -rp "Select [1/2/3]: " BUN_METHOD
      BUN_METHOD="${BUN_METHOD:-1}"
      case "$BUN_METHOD" in
        1) brew install oven-sh/bun/bun ;;
        2) curl -fsSL https://bun.com/install | bash ;;
        3) npm install -g bun ;;
        *) warn "Invalid choice — skipping Bun install"; return 0 ;;
      esac
      ;;
    linux)
      echo "  1) curl -fsSL https://bun.com/install | bash  (Recommended)"
      echo "  2) npm install -g bun"
      read -rp "Select [1/2]: " BUN_METHOD
      BUN_METHOD="${BUN_METHOD:-1}"
      case "$BUN_METHOD" in
        1) curl -fsSL https://bun.com/install | bash ;;
        2) npm install -g bun ;;
        *) warn "Invalid choice — skipping Bun install"; return 0 ;;
      esac
      ;;
    windows)
      echo "  1) PowerShell installer  (Recommended)"
      echo "  2) npm install -g bun"
      read -rp "Select [1/2]: " BUN_METHOD
      BUN_METHOD="${BUN_METHOD:-1}"
      case "$BUN_METHOD" in
        1) powershell -c "irm bun.sh/install.ps1|iex" ;;
        2) npm install -g bun ;;
        *) warn "Invalid choice — skipping Bun install"; return 0 ;;
      esac
      ;;
    *)
      warn "Unknown OS — skipping Bun install"
      return 0
      ;;
  esac

  # Add freshly-installed Bun to current session PATH so runtime detection finds it
  if [[ -d "$HOME/.bun/bin" ]]; then
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi

  # Verify
  if command -v bun &>/dev/null; then
    success "Bun $(bun --version) installed successfully"
  else
    warn "Bun installation may have failed — continuing with Node.js"
    warn "You can install Bun manually: https://bun.com/docs/installation"
  fi
}

echo ""
echo -e "${BOLD}🌮 Installing TACO${RESET}"
echo ""

# --- Detect OS ---
detect_os() {
  case "$OSTYPE" in
    darwin*)  echo "macos" ;;
    linux*)   echo "linux" ;;
    msys*|win32*|cygwin*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

# --- Detect Architecture ---
detect_arch() {
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "unknown" ;;
  esac
}

# --- Try to download pre-built binary ---
download_binary() {
  local version="$1"
  local install_dir="$2"
  
  # Construct binary name: taco-{VERSION}-{OS}-{ARCH}
  local binary_name="taco-${version}-${OS}-${ARCH}"
  [[ "$OS" == "windows" ]] && binary_name="${binary_name}.exe"
  
  local binary_url="https://github.com/${REPO}/releases/download/${version}/${binary_name}"
  local checksum_url="https://github.com/${REPO}/releases/download/${version}/${binary_name}.sha256"
  
  info "Checking for pre-built binary: ${binary_name}..."
  
  # Check if binary exists (HEAD request with retry)
  local http_code
  http_code=$(curl -fsSL -o /dev/null -w "%{http_code}" -m 10 "$binary_url" 2>/dev/null) || http_code="000"
  
  if [[ "$http_code" == "200" ]]; then
    info "Downloading pre-built binary..."
    local tmp_file="${install_dir}/${binary_name}.tmp"
    
    if ! curl -fsSL --connect-timeout 30 --max-time 300 "$binary_url" -o "$tmp_file"; then
      warn "Download failed (HTTP $http_code), will build from source instead"
      rm -f "$tmp_file"
      return 1
    fi
    
    # Download and verify checksum if available
    local checksum_file="${install_dir}/${binary_name}.sha256"
    if curl -fsSL --connect-timeout 10 -m 30 "$checksum_url" -o "$checksum_file" 2>/dev/null; then
      info "Verifying checksum..."
      local expected_checksum=$(awk '{print $1}' "$checksum_file")
      local actual_checksum=$(sha256sum "$tmp_file" | awk '{print $1}')
      
      if [[ "$expected_checksum" == "$actual_checksum" ]]; then
        success "Checksum verified"
      else
        warn "Checksum mismatch! Expected: $expected_checksum, Got: $actual_checksum"
        warn "Binary may be corrupted, falling back to source build"
        rm -f "$tmp_file" "$checksum_file"
        return 1
      fi
      rm -f "$checksum_file"
    else
      info "No checksum file available, skipping verification"
    fi
    
    # Make executable
    chmod +x "$tmp_file" 2>/dev/null || true
    
    # Move to final location (without .tmp)
    local final_path="${install_dir}/taco"
    [[ "$OS" == "windows" ]] && final_path="${final_path}.exe"
    mv "$tmp_file" "$final_path"
    
    success "Binary installed: $final_path"
    return 0
  else
    info "No pre-built binary for ${OS}-${ARCH} (HTTP $http_code), building from source"
    return 1
  fi
}

OS=$(detect_os)
ARCH=$(detect_arch)
SYSTEM=false
LOCAL_INSTALL=true
PREFER_SOURCE=false
LATEST_TAG="${LATEST_TAG:-}"

# --- Parse args ---
for arg in "$@"; do
  case "$arg" in
    --system|-s) SYSTEM=true; LOCAL_INSTALL=false ;;
    --local|-l) LOCAL_INSTALL=true ;;
    --prefer-source) PREFER_SOURCE=true ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --system, -s       Install system-wide (requires sudo)"
      echo "  --local, -l        Install to ~/.local/bin (default)"
      echo "  --prefer-source     Build from source instead of downloading binary"
      echo "  --help, -h         Show this help"
      exit 0
      ;;
  esac
done

info "Detected platform: ${OS}-${ARCH}"

# --- Check Node.js version ---
info "Checking Node.js version..."

# Try to find node in PATH first
if ! command -v node &> /dev/null; then
  # On Windows Git Bash, try common Node.js locations
  if [[ "$OS" == "windows" ]]; then
    if [[ -f "/c/Program Files/nodejs/node.exe" ]]; then
      export PATH="/c/Program Files/nodejs:$PATH"
    elif [[ -f "/c/Program Files (x86)/nodejs/node.exe" ]]; then
      export PATH="/c/Program Files (x86)/nodejs:$PATH"
    elif [[ -f "$HOME/AppData/Roaming/npm/node.exe" ]]; then
      export PATH="$HOME/AppData/Roaming/npm:$PATH"
    fi
  fi
fi

# Check again after adding Windows paths
if ! command -v node &> /dev/null; then
  error "Node.js is required but not installed. Please install Node.js 18+ from https://nodejs.org"
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [[ "$NODE_MAJOR" -lt 18 ]]; then
  error "Node.js 18+ is required. Found: $NODE_VERSION"
fi

success "Node.js $NODE_VERSION detected"

# --- Offer Bun installation ---
prompt_install_bun

# --- Determine installation directory ---
if [[ "$SYSTEM" == "true" ]]; then
  if [[ "$OS" == "windows" ]]; then
    INSTALL_DIR="/c/Program Files/taco"
  else
    INSTALL_DIR="/usr/local/bin"
  fi
else
  # User install - use ~/.taco directory
  INSTALL_DIR="${HOME}/.taco"
fi

# --- Try binary download first ---
BINARY_INSTALLED=false
if [[ "$PREFER_SOURCE" != "true" ]] && [[ -n "$LATEST_TAG" ]]; then
  mkdir -p "$INSTALL_DIR"
  if download_binary "$LATEST_TAG" "$INSTALL_DIR"; then
    BINARY_INSTALLED=true
  fi
fi

# --- Build from source (fallback) ---
# Skip if binary was already installed
if [[ "$BINARY_INSTALLED" == "true" ]]; then
  info "Using pre-built binary, skipping source build"
elif [[ -f "$REPO_DIR/tsconfig.json" ]]; then
  info "Building from source..."

  if ! command -v pnpm &> /dev/null; then
    warn "pnpm not found, trying npm..."
    if ! command -v npm &> /dev/null; then
      error "Neither pnpm nor npm found. Please install pnpm: https://pnpm.io/installation"
    fi
    BUILD_CMD="npm run build"
  else
    BUILD_CMD="pnpm run build"
  fi

  cd "$REPO_DIR"
  $BUILD_CMD || error "Build failed"
  success "Built successfully"
elif [[ ! -d "$REPO_DIR/dist" ]]; then
  error "No dist/ folder and no source to build from. Please build first: pnpm run build"
fi

# --- Install ---
echo ""
echo -e "${BOLD}[1/2] Installing taco...${RESET}"

# Create install directory
mkdir -p "$INSTALL_DIR"

# If we have a standalone binary, we're done
if [[ "$BINARY_INSTALLED" == "true" ]]; then
  info "Pre-built binary installed, setting up runtime..."
  
  # Copy minimal files needed for the binary to work
  cp "$REPO_DIR/package.json" "$INSTALL_DIR/" 2>/dev/null || true
  cp "$REPO_DIR/uninstall.sh" "$INSTALL_DIR/" 2>/dev/null || true
  
  # Install runtime dependencies non-interactively
  if command -v npm &>/dev/null; then
    (cd "$INSTALL_DIR" && npm install --omit=dev --silent --no-audit --no-fund) 2>/dev/null || true
  fi
  
  if [[ "$OS" == "windows" ]]; then
    success "Installed to $INSTALL_DIR/taco.exe"
  else
    success "Installed to $INSTALL_DIR/taco"
  fi
else
  # Need runtime wrapper (Node.js/Bun)

  # Detect runtime (prefer Bun for speed)
  if command -v bun &> /dev/null; then
    info "Bun detected - using Bun for faster performance"
    RUNTIME="bun"
    RUNCMD="bun run"
  elif command -v node &> /dev/null; then
    RUNTIME="node"
    RUNCMD="node"
  else
    error "Neither Bun nor Node.js found. Please install Bun: https://bun.sh or Node.js: https://nodejs.org"
  fi

  # Create wrapper script
  TACO_WRAPPER="$INSTALL_DIR/taco"

if [[ "$OS" == "windows" ]]; then
  # Windows batch wrapper (for CMD)
  cat > "$TACO_WRAPPER.bat" << EOF
@echo off
$RUNCMD "%~dp0\dist\bin\taco.js" %*
EOF
  
  # PowerShell wrapper
  cat > "$TACO_WRAPPER.ps1" << EOF
#!/usr/bin/env pwsh
$RUNCMD '$INSTALL_DIR\dist\bin\taco.js' @args
EOF
  
  # Shell wrapper for Git Bash (no extension)
  cat > "$TACO_WRAPPER" << EOF
#!/bin/sh
exec $RUNCMD "$INSTALL_DIR/dist/bin/taco.js" "\$@"
EOF
  chmod +x "$TACO_WRAPPER"
  
  # Remove stale dist before copying so no old compiled files survive a rename/delete.
  rm -rf "$INSTALL_DIR/dist"
  cp -r "$REPO_DIR/dist" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true
  if [[ -f "$REPO_DIR/uninstall.sh" ]]; then
    cp "$REPO_DIR/uninstall.sh" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/uninstall.sh"
  fi
  
  success "Installed to $INSTALL_DIR/taco.bat, taco.ps1, and taco (shell)"
else
  # Unix wrapper script
  cat > "$TACO_WRAPPER" << EOF
#!/bin/sh
exec $RUNCMD "$INSTALL_DIR/dist/bin/taco.js" "\$@"
EOF
  chmod +x "$TACO_WRAPPER"
  
  # Remove stale dist before copying so no old compiled files survive a rename/delete.
  rm -rf "$INSTALL_DIR/dist"
  cp -r "$REPO_DIR/dist" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true

  # Copy package.json, uninstall script, and install dependencies
  cp "$REPO_DIR/package.json" "$INSTALL_DIR/"
  if [[ -f "$REPO_DIR/uninstall.sh" ]]; then
    cp "$REPO_DIR/uninstall.sh" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/uninstall.sh"
  fi
  info "Installing dependencies..."
  (cd "$INSTALL_DIR" && npm install --omit=dev --silent) || warn "Failed to install dependencies, TACO may not work properly"

  # Verify SQLite driver availability (better-sqlite3 is optional — native build may fail)
  if [ "$RUNTIME" = "node" ]; then
    if node -e "const m = require('better-sqlite3'); const db = new m(':memory:'); db.close()" 2>/dev/null; then
      info "SQLite driver: better-sqlite3 (native)"
    else
      warn "better-sqlite3 native addon not available — falling back to sql.js (WASM)"
      warn "This is normal on some systems. TACO will work correctly but may be slightly slower."
    fi
  fi

  success "Installed to $INSTALL_DIR/taco"
  fi
fi

# --- Add to PATH ---
if [[ "$LOCAL_INSTALL" == "true" ]] && [[ "$INSTALL_DIR" == "${HOME}/.taco" ]]; then
  # Add to current session so it works immediately
  export PATH="$HOME/.taco:$PATH"
  info "Added ~/.taco to current session PATH - taco is ready to use now!"
  
  # Also add to shell config for future sessions
  SHELL_RC=""
  if [[ -f "$HOME/.bashrc" ]]; then
    SHELL_RC="$HOME/.bashrc"
  elif [[ -f "$HOME/.zshrc" ]]; then
    SHELL_RC="$HOME/.zshrc"
  fi
  
  if [[ -n "$SHELL_RC" ]] && ! grep -q "\.taco" "$SHELL_RC" 2>/dev/null; then
    echo 'export PATH="$HOME/.taco:$PATH"' >> "$SHELL_RC"
    info "Added ~/.taco to PATH in $SHELL_RC for future sessions"
  fi
fi

# --- OpenCode integration info ---
echo ""
echo -e "${BOLD}[2/2] OpenCode Integration${RESET}"
echo ""
echo -e "${CYAN}Use TACO in OpenCode with zero LLM tokens:${RESET}"
echo ""
echo "  !taco overview     # Show usage stats"
echo "  !taco today        # Today's usage"
echo "  !taco sessions     # Recent sessions"
echo "  !taco view         # Full dashboard"
echo ""
echo -e "${YELLOW}Note:${RESET} The '!' prefix runs commands locally without sending to AI."

# --- Done ---
echo ""
echo -e "${GREEN}${BOLD}All done!${RESET}"
echo ""
echo "Try these commands:"
echo "  taco           # Overview with charts"
echo "  taco models    # Which models you use"
echo "  taco today     # Today's usage"
echo "  taco --help    # All commands"
echo ""
echo -e "${CYAN}Use in OpenCode (zero LLM tokens):${RESET}"
echo "  !taco overview     # Show usage stats"
echo "  !taco today        # Today's usage"
echo "  !taco sessions     # Recent sessions"
echo "  !taco view         # Full dashboard"
echo ""

# --- Post-install verification ---
echo ""
echo -e "${BOLD}Post-install verification${RESET}"

if [[ -x "$INSTALL_DIR/taco" ]]; then
  TACO_VERSION=$("$INSTALL_DIR/taco" --version 2>/dev/null)
  if [[ -n "$TACO_VERSION" ]]; then
    success "taco $TACO_VERSION is working"
  else
    warn "taco installed but --version check failed"
  fi
else
  warn "taco wrapper not found or not executable at $INSTALL_DIR/taco"
fi

if command -v bun &>/dev/null; then
  info "Runtime: Bun $(bun --version)"
else
  info "Runtime: Node.js $(node --version)"
fi

# Warm the cache so the first real 'taco' run is instant.
# 'overview --format json' is the only command that writes ~/.cache/taco/ and
# takes the lightest code path (single SQLite aggregation, no streaming).
info "Warming cache..."
"$INSTALL_DIR/taco" overview --format json >/dev/null 2>&1 && success "Cache ready" || true

if ! command -v taco &>/dev/null; then
  info "Restart your terminal or run: source ${SHELL_RC:-~/.zshrc}"
  info "Then try: taco"
fi
