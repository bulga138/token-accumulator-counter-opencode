#!/usr/bin/env bash
# =============================================================================
# TACO — Token Accumulator Counter for OpenCode
# Uninstall script
# =============================================================================

set -euo pipefail

# --- Colors ---
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RESET="\033[0m"

info()    { echo -e "${CYAN}  ->${RESET} $*"; }
success() { echo -e "${GREEN}  [OK]${RESET} $*"; }
warn()    { echo -e "${YELLOW}  [WARN]${RESET} $*"; }

# --- Parse args ---
SYSTEM=false
for arg in "$@"; do
  case "$arg" in
    --system|-s) SYSTEM=true ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --system, -s   Uninstall system-wide installation"
      echo "  --help, -h     Show this help"
      exit 0
      ;;
  esac
done

echo ""
echo -e "${BOLD}🌮 TACO — Uninstall${RESET}"
echo ""

# Determine installation directory
if [[ "$SYSTEM" == "true" ]]; then
  if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    TACO_DIR="/c/Program Files/taco"
  else
    TACO_DIR="/usr/local/bin"
  fi
else
  TACO_DIR="${HOME}/.taco"
fi

# Remove TACO installation directory
if [[ -d "$TACO_DIR" ]]; then
  rm -rf "$TACO_DIR"
  success "Removed TACO directory → $TACO_DIR"
else
  info "TACO directory not found — skipping"
fi

# Remove from PATH in shell rc files (user install only)
if [[ "$SYSTEM" != "true" ]]; then
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [[ -f "$rc" ]] && grep -q "\.taco" "$rc" 2>/dev/null; then
      sed -i '/\.taco/d' "$rc" 2>/dev/null || true
      info "Removed ~/.taco from PATH in $rc"
    fi
  done
fi

# Remove cache directory
CACHE_DIR="${HOME}/.cache/taco"
if [[ -d "$CACHE_DIR" ]]; then
  rm -rf "$CACHE_DIR"
  success "Removed TACO cache → $CACHE_DIR"
fi

# Remove config directory (ask first)
CONFIG_DIR="${HOME}/.config/taco"
if [[ -d "$CONFIG_DIR" ]]; then
  if [[ -t 0 ]]; then
    read -rp "Remove TACO configuration? [y/N] " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
      rm -rf "$CONFIG_DIR"
      success "Removed TACO configuration → $CONFIG_DIR"
    else
      info "Keeping configuration at $CONFIG_DIR"
    fi
  else
    info "Keeping configuration at $CONFIG_DIR (non-interactive mode)"
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}Uninstall complete.${RESET}"
echo ""
echo "Note: TACO data in OpenCode's database is preserved."
echo "To remove that data, delete OpenCode's opencode.db file."
echo ""
