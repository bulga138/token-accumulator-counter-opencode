#!/bin/bash
# =============================================================================
# update.sh — Update taco to the latest version
# https://github.com/bulga138/token-accumulator-counter-opencode
#
# This script fetches the latest release from GitHub and updates the
# local installation.
#
# Usage:
#   ./update.sh              # Update to latest release
#   ./update.sh --check      # Check for updates only
#   ./update.sh --force      # Force update even if same version
# =============================================================================

set -euo pipefail

REPO="bulga138/token-accumulator-counter-opencode"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"
GITHUB_DOWNLOAD="https://github.com/${REPO}/releases/latest/download"

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

# --- Parse args ---
CHECK_ONLY=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --check|-c) CHECK_ONLY=true ;;
    --force|-f) FORCE=true ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --check, -c    Check for updates only (don't install)"
      echo "  --force, -f    Force update even if same version"
      echo "  --help, -h     Show this help"
      exit 0
      ;;
  esac
done

echo ""
echo -e "${BOLD}🌮 TACO — Update${RESET}"
echo ""

# --- Check for taco installation ---
TACO_PATH=$(command -v taco || true)
if [[ -z "$TACO_PATH" ]]; then
  error "taco not found in PATH. Please install first with ./install.sh"
fi

info "Current installation: $TACO_PATH"

# --- Get current version ---
CURRENT_VERSION=""
if command -v taco &> /dev/null; then
  CURRENT_VERSION=$(taco --version 2>/dev/null || echo "unknown")
fi

if [[ "$CURRENT_VERSION" == "unknown" ]] || [[ -z "$CURRENT_VERSION" ]]; then
  warn "Could not determine current version"
  CURRENT_VERSION="0.0.0"
else
  info "Current version: $CURRENT_VERSION"
fi

# --- Check for updates ---
info "Checking for latest release..."

# Check if curl is available
if ! command -v curl &> /dev/null; then
  error "curl is required but not installed"
fi

# Fetch latest release info
LATEST_INFO=$(curl -s "$GITHUB_API" 2>/dev/null || echo "")

if [[ -z "$LATEST_INFO" ]]; then
  error "Failed to fetch release information from GitHub"
fi

LATEST_VERSION=$(echo "$LATEST_INFO" | grep -o '"tag_name": "[^"]*"' | cut -d'"' -f4)
LATEST_VERSION=${LATEST_VERSION#v}  # Remove 'v' prefix if present

if [[ -z "$LATEST_VERSION" ]]; then
  error "Could not parse latest version from GitHub API"
fi

info "Latest version: $LATEST_VERSION"

# --- Compare versions ---
version_compare() {
  local v1="$1"
  local v2="$2"
  
  # Simple version comparison
  if [[ "$v1" == "$v2" ]]; then
    echo "equal"
  else
    # Convert to sortable format and compare
    local sorted=$(printf "%s\n%s\n" "$v1" "$v2" | sort -V | head -n1)
    if [[ "$sorted" == "$v1" ]]; then
      echo "older"
    else
      echo "newer"
    fi
  fi
}

COMPARE_RESULT=$(version_compare "$CURRENT_VERSION" "$LATEST_VERSION")

if [[ "$COMPARE_RESULT" == "equal" ]] && [[ "$FORCE" == "false" ]]; then
  success "Already up to date (version $CURRENT_VERSION)"
  exit 0
elif [[ "$COMPARE_RESULT" == "newer" ]] && [[ "$FORCE" == "false" ]]; then
  success "You have a newer version than the latest release ($CURRENT_VERSION > $LATEST_VERSION)"
  exit 0
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
  if [[ "$COMPARE_RESULT" == "older" ]]; then
    echo ""
    echo -e "${YELLOW}Update available: $CURRENT_VERSION → $LATEST_VERSION${RESET}"
    echo "Run './update.sh' to update"
  fi
  exit 0
fi

# --- Download and install ---
echo ""
echo -e "${BOLD}Updating to version $LATEST_VERSION...${RESET}"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Detect OS for download
OS="linux"
case "$OSTYPE" in
  darwin*) OS="macos" ;;
  linux*) OS="linux" ;;
  msys*|win32*|cygwin*) OS="windows" ;;
esac

# Download latest release
DOWNLOAD_URL="${GITHUB_DOWNLOAD}/taco-${OS}.zip"
info "Downloading from: $DOWNLOAD_URL"

if ! curl -L -o "$TEMP_DIR/taco.zip" "$DOWNLOAD_URL" 2>/dev/null; then
  # Try generic zip as fallback
  DOWNLOAD_URL="${GITHUB_DOWNLOAD}/taco.zip"
  info "Trying: $DOWNLOAD_URL"
  curl -L -o "$TEMP_DIR/taco.zip" "$DOWNLOAD_URL" || error "Download failed"
fi

success "Downloaded successfully"

# Extract
info "Extracting..."
cd "$TEMP_DIR"
unzip -q taco.zip || error "Failed to extract archive"

# Find install directory
INSTALL_DIR=$(dirname "$TACO_PATH")
if [[ "$OS" == "windows" ]] && [[ "$TACO_PATH" == *.bat ]]; then
  INSTALL_DIR=$(dirname "$TACO_PATH")
fi

# Backup current installation
if [[ -d "$INSTALL_DIR/dist" ]]; then
  BACKUP_DIR="${INSTALL_DIR}/dist.backup.$(date +%Y%m%d%H%M%S)"
  info "Creating backup: $BACKUP_DIR"
  cp -r "$INSTALL_DIR/dist" "$BACKUP_DIR"
fi

# Install new version
info "Installing to: $INSTALL_DIR"

# Copy new files
if [[ -d "$TEMP_DIR/dist" ]]; then
  rm -rf "$INSTALL_DIR/dist"
  cp -r "$TEMP_DIR/dist" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true
elif [[ -d "$TEMP_DIR/taco/dist" ]]; then
  rm -rf "$INSTALL_DIR/dist"
  cp -r "$TEMP_DIR/taco/dist" "$INSTALL_DIR/"
  chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true
fi

# Copy wrapper script if present
if [[ -f "$TEMP_DIR/taco" ]] && [[ "$OS" != "windows" ]]; then
  cp "$TEMP_DIR/taco" "$INSTALL_DIR/taco"
  chmod +x "$INSTALL_DIR/taco"
fi

success "Installation complete"

# --- Verify ---
echo ""
info "Verifying installation..."

NEW_VERSION=$(taco --version 2>/dev/null || echo "unknown")
if [[ "$NEW_VERSION" == "$LATEST_VERSION" ]]; then
  success "Updated successfully to version $NEW_VERSION"
else
  warn "Version mismatch: expected $LATEST_VERSION, got $NEW_VERSION"
  warn "The update may still be successful"
fi

echo ""
echo -e "${GREEN}${BOLD}Update complete!${RESET}"
echo ""
echo "Run 'taco' to get started"
echo ""
