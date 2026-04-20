#!/bin/bash
# =============================================================================
# update.sh — Update taco to the latest version
# https://github.com/bulga138/taco
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

REPO="bulga138/taco"
GITHUB_DOWNLOAD="https://github.com/${REPO}/releases/download"

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
TARGET_VERSION=""

for arg in "$@"; do
  case "$arg" in
    --check|-c) CHECK_ONLY=true ;;
    --force|-f) FORCE=true ;;
    --version=*) TARGET_VERSION="${arg#--version=}" ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --check, -c          Check for updates only (don't install)"
      echo "  --force, -f          Force update even if same version"
      echo "  --version <tag>      Update to a specific version (e.g. v0.1.4)"
      echo "  --help, -h           Show this help"
      exit 0
      ;;
  esac
done
# Handle --version <value> (two-argument form)
_prev=""
for arg in "$@"; do
  [[ "$_prev" == "--version" ]] && { TARGET_VERSION="$arg"; break; }
  _prev="$arg"
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
# Check if curl/git is available
if ! command -v curl &> /dev/null; then
  error "curl is required but not installed"
fi

if [[ -n "$TARGET_VERSION" ]]; then
  # Normalise: ensure it starts with 'v'
  [[ "$TARGET_VERSION" == v* ]] || TARGET_VERSION="v${TARGET_VERSION}"
  LATEST_VERSION="${TARGET_VERSION#v}"
  info "Target version: $LATEST_VERSION (pinned)"
else
  info "Checking for latest release..."
  # Use git ls-remote — no API rate limits
  LATEST_TAG=$(git ls-remote --tags "https://github.com/${REPO}.git" 2>/dev/null \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -1 || true)

  if [[ -z "$LATEST_TAG" ]]; then
    error "Could not determine latest release. Check your internet connection or pin a version with --version v0.1.4"
  fi

  LATEST_VERSION="${LATEST_TAG#v}"
  info "Latest version: $LATEST_VERSION"
fi

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

# Download release archive (tar.gz format, same as install.sh)
TAG="v${LATEST_VERSION}"
VERSION="${TAG#v}"
DOWNLOAD_URL="${GITHUB_DOWNLOAD}/${TAG}/taco-release-${VERSION}.tar.gz"
info "Downloading from: $DOWNLOAD_URL"

if ! curl -fsSL -H "User-Agent: Mozilla/5.0" -o "$TEMP_DIR/taco.tar.gz" "$DOWNLOAD_URL" 2>/dev/null; then
  error "Download failed. Check your internet connection or try a different version with --version <tag>"
fi

success "Downloaded successfully"

# Extract
info "Extracting..."
tar xz -C "$TEMP_DIR" -f "$TEMP_DIR/taco.tar.gz" || error "Failed to extract archive"

# Find install directory
INSTALL_DIR=$(dirname "$TACO_PATH")

# The archive contains an install.sh — re-run it to do the update properly.
# This reuses all the same logic as a fresh install (build, copy, wrapper creation).
EXTRACTED_INSTALLER="$TEMP_DIR/install.sh"
if [[ -f "$EXTRACTED_INSTALLER" ]]; then
  info "Running installer from archive..."
  export LATEST_TAG="v${LATEST_VERSION}"
  export REPO
  bash "$EXTRACTED_INSTALLER" "$@"
else
  # Fallback: manually copy dist/ if installer is not in archive
  info "Installing to: $INSTALL_DIR"

  if [[ -d "$INSTALL_DIR/dist" ]]; then
    BACKUP_DIR="${INSTALL_DIR}/dist.backup.$(date +%Y%m%d%H%M%S)"
    info "Creating backup: $BACKUP_DIR"
    cp -r "$INSTALL_DIR/dist" "$BACKUP_DIR"
  fi

  if [[ -d "$TEMP_DIR/dist" ]]; then
    rm -rf "$INSTALL_DIR/dist"
    cp -r "$TEMP_DIR/dist" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/dist/bin/taco.js" 2>/dev/null || true
  else
    error "Could not find dist/ in the downloaded archive"
  fi
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
