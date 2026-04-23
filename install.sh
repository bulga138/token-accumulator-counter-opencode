#!/bin/bash
# =============================================================================
# install.sh — Install taco (Token Accumulator Counter)
# https://github.com/bulga138/taco
#
# This script installs the TypeScript-based taco CLI
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/bulga138/taco/master/install.sh | bash
#   ./install.sh --system   # System-wide install (requires sudo)
#   ./install.sh --local    # Local install only (default)
# =============================================================================

set -uo pipefail

REPO="bulga138/taco"

# --- OS / Architecture detection (used by both piped and local paths) ---
detect_os() {
  case "$OSTYPE" in
    darwin*)  echo "macos" ;;
    linux*)   echo "linux" ;;
    msys*|win32*|cygwin*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

detect_arch() {
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "unknown" ;;
  esac
}

# --- Remote bootstrap: detect piped execution (curl | bash) ---
# When piped, BASH_SOURCE[0] is empty — no local repo files exist.
# Try binary download first; only fall back if unavailable.
#
# Install specific version:
#   curl -sSL https://raw.githubusercontent.com/bulga138/taco/master/install.sh | bash -s -- --version v0.1.4
# Install latest:
#   curl -sSL https://raw.githubusercontent.com/bulga138/taco/master/install.sh | bash
if [[ -z "${BASH_SOURCE[0]:-}" ]] || [[ "${BASH_SOURCE[0]}" == "bash" ]]; then
  command -v curl &>/dev/null || { echo "Error: curl is required"; exit 1; }
  command -v tar  &>/dev/null || { echo "Error: tar is required"; exit 1; }

  # Allow caller to pin a version: --version v0.1.4
  REQUESTED_VERSION=""
  for _arg in "$@"; do
    case "$_arg" in
      --version=*) REQUESTED_VERSION="${_arg#--version=}" ;;
    esac
  done
  _prev=""
  for _arg in "$@"; do
    [[ "$_prev" == "--version" ]] && { REQUESTED_VERSION="$_arg"; break; }
    _prev="$_arg"
  done

  if [[ -n "$REQUESTED_VERSION" ]]; then
    [[ "$REQUESTED_VERSION" == v* ]] || REQUESTED_VERSION="v${REQUESTED_VERSION}"
    LATEST_TAG="$REQUESTED_VERSION"
    echo "Installing TACO ${LATEST_TAG} (pinned)..."
  else
    echo "Fetching latest TACO release..."
    LATEST_TAG=$(git ls-remote --tags "https://github.com/${REPO}.git" 2>/dev/null \
      | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' \
      | sort -V \
      | tail -1 || true)
    if [[ -z "$LATEST_TAG" ]]; then
      echo "  [ERROR] Could not determine latest release. Check your internet connection."
      echo "  To install a specific version, run:"
      echo "    curl -sSL https://raw.githubusercontent.com/${REPO}/master/install.sh | bash -s -- --version v0.1.4"
      exit 1
    fi
    echo "Latest release: ${LATEST_TAG}"
  fi

  VERSION="${LATEST_TAG#v}"
  OS=$(detect_os)
  ARCH=$(detect_arch)

  # Determine install directory from args
  _SYSTEM=false
  for _arg in "$@"; do
    case "$_arg" in --system|-s) _SYSTEM=true ;; esac
  done
  if [[ "$_SYSTEM" == "true" ]]; then
    _INSTALL_DIR="/usr/local/bin"
  else
    _INSTALL_DIR="${HOME}/.taco"
  fi
  mkdir -p "$_INSTALL_DIR"

  # Construct binary name — Windows gets .exe
  BINARY_NAME="taco-${VERSION}-${OS}-${ARCH}"
  [[ "$OS" == "windows" ]] && BINARY_NAME="${BINARY_NAME}.exe"
  BINARY_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${BINARY_NAME}"

  TARGET="${_INSTALL_DIR}/taco"
  [[ "$OS" == "windows" ]] && TARGET="${TARGET}.exe"

  echo "Downloading TACO ${LATEST_TAG} for ${OS}-${ARCH}..."
  if curl -fsSL -H "User-Agent: Mozilla/5.0" --connect-timeout 30 --max-time 300 \
      "$BINARY_URL" -o "${TARGET}.tmp" 2>/dev/null; then

    # Optional checksum verification
    CHECKSUM_URL="${BINARY_URL}.sha256"
    if curl -fsSL -H "User-Agent: Mozilla/5.0" --connect-timeout 10 -m 30 \
        "$CHECKSUM_URL" -o "${TARGET}.sha256" 2>/dev/null; then
      _expected=$(awk '{print $1}' "${TARGET}.sha256")
      if command -v sha256sum >/dev/null 2>&1; then
        _actual=$(sha256sum "${TARGET}.tmp" | awk '{print $1}')
      else
        _actual=$(shasum -a 256 "${TARGET}.tmp" | awk '{print $1}')
      fi
      if [[ "$_expected" == "$_actual" ]]; then
        echo "  [OK] Checksum verified"
      else
        echo "  [WARN] Checksum mismatch — binary may be corrupted, aborting"
        rm -f "${TARGET}.tmp" "${TARGET}.sha256"
        exit 1
      fi
      rm -f "${TARGET}.sha256"
    fi

    mv "${TARGET}.tmp" "$TARGET"
    chmod +x "$TARGET" 2>/dev/null || true

    # Add to PATH
    if [[ "$_SYSTEM" != "true" ]] && [[ "$_INSTALL_DIR" == "${HOME}/.taco" ]]; then
      export PATH="${HOME}/.taco:$PATH"
      SHELL_RC=""
      if [[ -f "$HOME/.bashrc" ]]; then
        SHELL_RC="$HOME/.bashrc"
      elif [[ -f "$HOME/.zshrc" ]]; then
        SHELL_RC="$HOME/.zshrc"
      fi
      if [[ -n "$SHELL_RC" ]] && ! grep -q '\.taco' "$SHELL_RC" 2>/dev/null; then
        echo 'export PATH="$HOME/.taco:$PATH"' >> "$SHELL_RC"
      fi
      # Shell completions
      if [[ -n "$SHELL_RC" ]] && ! grep -q 'taco completion' "$SHELL_RC" 2>/dev/null; then
        echo '' >> "$SHELL_RC"
        echo '# taco shell completions' >> "$SHELL_RC"
        echo 'eval "$(taco completion)" 2>/dev/null || true' >> "$SHELL_RC"
      fi
      # Fish shell completions
      if [[ "$SHELL" == *fish* ]] || command -v fish &>/dev/null; then
        FISH_COMP_DIR="$HOME/.config/fish/completions"
        if [[ -d "$FISH_COMP_DIR" ]] || mkdir -p "$FISH_COMP_DIR" 2>/dev/null; then
          "$TARGET" completion --fish > "$FISH_COMP_DIR/taco.fish" 2>/dev/null || true
        fi
      fi
    fi

    echo ""
    echo "  [OK] TACO ${LATEST_TAG} installed to ${TARGET}"
    echo ""
    echo "Try: taco --help"
    if ! command -v taco &>/dev/null; then
      echo "Restart your terminal or run: source ${SHELL_RC:-~/.bashrc}"
    fi

    # Warm the cache
    "$TARGET" overview --format json >/dev/null 2>&1 || true
    exit 0
  else
    echo "  [ERROR] No pre-built binary available for ${OS}-${ARCH}."
    echo ""
    echo "  To install from source, clone and build:"
    echo "    git clone https://github.com/${REPO}.git"
    echo "    cd taco"
    echo "    ./install.sh"
    exit 1
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Local execution path (./install.sh from a cloned repo)
# ═══════════════════════════════════════════════════════════════════════════════

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
  command -v bun &>/dev/null && return 0
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

  if [[ -d "$HOME/.bun/bin" ]]; then
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi

  if command -v bun &>/dev/null; then
    success "Bun $(bun --version) installed successfully"
  else
    warn "Bun installation may have failed — continuing with Node.js"
    warn "You can install Bun manually: https://bun.com/docs/installation"
  fi
}

# --- Try to download pre-built binary ---
download_binary() {
  local version="$1"
  local install_dir="$2"
  
  local version_no_v="${version#v}"
  local binary_name="taco-${version_no_v}-${OS}-${ARCH}"
  [[ "$OS" == "windows" ]] && binary_name="${binary_name}.exe"
  
  local binary_url="https://github.com/${REPO}/releases/download/${version}/${binary_name}"
  local checksum_url="${binary_url}.sha256"

  info "Checking for pre-built binary: ${binary_name}..."
  
  local http_code
  http_code=$(curl -fsSL -H "User-Agent: Mozilla/5.0" -o /dev/null -w "%{http_code}" -m 10 "$binary_url" 2>/dev/null) || http_code="000"
  
  if [[ "$http_code" == "200" ]]; then
    info "Downloading pre-built binary..."
    local tmp_file="${install_dir}/${binary_name}.tmp"
    
    if ! curl -fsSL -H "User-Agent: Mozilla/5.0" --connect-timeout 30 --max-time 300 "$binary_url" -o "$tmp_file"; then
      warn "Download failed, will build from source instead"
      rm -f "$tmp_file"
      return 1
    fi
    
    local checksum_file="${install_dir}/${binary_name}.sha256"
    if curl -fsSL -H "User-Agent: Mozilla/5.0" --connect-timeout 10 -m 30 "$checksum_url" -o "$checksum_file" 2>/dev/null; then
      info "Verifying checksum..."
      local expected_checksum
      expected_checksum=$(awk '{print $1}' "$checksum_file")
      local actual_checksum
      if command -v sha256sum >/dev/null 2>&1; then
        actual_checksum=$(sha256sum "$tmp_file" | awk '{print $1}')
      else
        actual_checksum=$(shasum -a 256 "$tmp_file" | awk '{print $1}')
      fi
      
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
    
    chmod +x "$tmp_file" 2>/dev/null || true
    
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

echo ""
echo -e "${BOLD}🌮 Installing TACO${RESET}"
echo ""

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

# --- Discover latest tag if not already set ---
if [[ -z "$LATEST_TAG" ]]; then
  info "Fetching latest TACO release..."
  LATEST_TAG=$(git ls-remote --tags "https://github.com/${REPO}.git" 2>/dev/null \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -1 || true)
  if [[ -z "$LATEST_TAG" ]]; then
    warn "Could not determine latest release — binary download will be skipped"
  else
    info "Latest release: ${LATEST_TAG}"
  fi
fi

info "Detected platform: ${OS}-${ARCH}"

# --- Check Node.js version ---
info "Checking Node.js version..."

if ! command -v node &> /dev/null; then
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
if [[ "$BINARY_INSTALLED" == "true" ]]; then
  info "Using pre-built binary, skipping source build"
elif [[ -f "$REPO_DIR/tsconfig.json" ]]; then
  info "Building from source..."

  if ! command -v pnpm &> /dev/null; then
    warn "pnpm not found, trying npm..."
    if ! command -v npm &> /dev/null; then
      error "Neither pnpm nor npm found. Please install pnpm: https://pnpm.io/installation"
    fi
    INSTALL_CMD="npm install"
    BUILD_CMD="npm run build"
  else
    INSTALL_CMD="pnpm install --frozen-lockfile"
    BUILD_CMD="pnpm run build"
  fi

  cd "$REPO_DIR"
  info "Installing build dependencies..."
  $INSTALL_CMD || error "Failed to install dependencies"
  $BUILD_CMD || error "Build failed"
  success "Built successfully"
elif [[ ! -d "$REPO_DIR/dist" ]]; then
  error "No dist/ folder and no source to build from. Please build first: pnpm run build"
fi

# --- Install ---
echo ""
echo -e "${BOLD}[1/2] Installing taco...${RESET}"

mkdir -p "$INSTALL_DIR"

if [[ "$BINARY_INSTALLED" == "true" ]]; then
  info "Pre-built binary installed successfully"
  
  # Binary installs are self-contained: taco update and taco uninstall handle maintenance
  if [[ "$OS" == "windows" ]]; then
    success "Installed to $INSTALL_DIR/taco.exe"
  else
    success "Installed to $INSTALL_DIR/taco"
  fi
else
  # Need runtime wrapper (Node.js/Bun)

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

  TACO_WRAPPER="$INSTALL_DIR/taco"
  
  if [[ "$OS" == "windows" ]]; then
    cat > "$TACO_WRAPPER.bat" << EOF
@echo off
$RUNCMD "%~dp0\dist\bin\taco.js" %*
EOF
  
  cat > "$TACO_WRAPPER.ps1" << EOF
#!/usr/bin/env pwsh
$RUNCMD '$INSTALL_DIR\dist\bin\taco.js' @args
EOF
  
  cat > "$TACO_WRAPPER" << EOF
#!/bin/sh
exec $RUNCMD "$INSTALL_DIR/dist/bin/taco.js" "\$@"
EOF
  chmod +x "$TACO_WRAPPER"

  rm -rf "$INSTALL_DIR/dist"
  cp -r "$REPO_DIR/dist" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true
  rm -f "$INSTALL_DIR/dist/package.json"
  
  if [[ -f "$REPO_DIR/uninstall.sh" ]]; then
      cp "$REPO_DIR/uninstall.sh" "$INSTALL_DIR/"
      chmod +x "$INSTALL_DIR/uninstall.sh"
    fi
    if [[ -f "$REPO_DIR/uninstall.ps1" ]]; then
      cp "$REPO_DIR/uninstall.ps1" "$INSTALL_DIR/"
fi
  success "Installed to $INSTALL_DIR/taco.bat, taco.ps1, and taco (shell)"
  else
    cat > "$TACO_WRAPPER" << EOF
#!/bin/sh
exec $RUNCMD "$INSTALL_DIR/dist/bin/taco.js" "\$@"
EOF
    chmod +x "$TACO_WRAPPER"

    rm -rf "$INSTALL_DIR/dist"
    cp -r "$REPO_DIR/dist" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true
    rm -f "$INSTALL_DIR/dist/package.json"

    cp "$REPO_DIR/package.json" "$INSTALL_DIR/"
    if [[ -f "$REPO_DIR/uninstall.sh" ]]; then
      cp "$REPO_DIR/uninstall.sh" "$INSTALL_DIR/"
      chmod +x "$INSTALL_DIR/uninstall.sh"
    fi
    info "Installing dependencies..."
    (cd "$INSTALL_DIR" && npm install --omit=dev --silent) || warn "Failed to install dependencies, TACO may not work properly"

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
  export PATH="$HOME/.taco:$PATH"
  info "Added ~/.taco to current session PATH - taco is ready to use now!"
  
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

 if [[ -n "$SHELL_RC" ]] && ! grep -q "taco completion" "$SHELL_RC" 2>/dev/null; then
    echo '' >> "$SHELL_RC"
    echo '# taco shell completions' >> "$SHELL_RC"
    echo 'eval "$(taco completion)" 2>/dev/null || true' >> "$SHELL_RC"
    success "Shell completions installed in $SHELL_RC"
    info "Run 'source $SHELL_RC' or open a new terminal to activate tab completion"
  elif [[ -n "$SHELL_RC" ]]; then
    info "Shell completions already present in $SHELL_RC"
  fi

  if [[ "$SHELL" == *fish* ]] || command -v fish &>/dev/null; then
    FISH_COMP_DIR="$HOME/.config/fish/completions"
    if [[ -d "$FISH_COMP_DIR" ]] || mkdir -p "$FISH_COMP_DIR" 2>/dev/null; then
      "$INSTALL_DIR/taco" completion --fish > "$FISH_COMP_DIR/taco.fish" 2>/dev/null && \
        success "Fish completions installed: $FISH_COMP_DIR/taco.fish"
    fi
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

info "Warming cache..."
"$INSTALL_DIR/taco" overview --format json >/dev/null 2>&1 && success "Cache ready" || true

if ! command -v taco &>/dev/null; then
  info "Restart your terminal or run: source ${SHELL_RC:-~/.zshrc}"
  info "Then try: taco"
fi
