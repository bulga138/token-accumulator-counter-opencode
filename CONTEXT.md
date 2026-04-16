# TACO Project Context

**Token Accumulator Counter for OpenCode** 🌮

**Version:** 0.1.1  
**Last Updated:** April 16, 2026

---

## What TACO Is

A CLI tool that tracks your OpenCode token usage, costs, and shows pretty charts in your terminal. No background processes, no configuration, just run it and see your stats.

## How It Works

TACO reads OpenCode's SQLite database directly using multiple database drivers for optimal performance:

1. **Bun** (if available): Native `bun:sqlite` - fastest, 10x performance
2. **better-sqlite3** (optional): Native C++ bindings - fast
3. **sql.js** (fallback): SQLite compiled to WASM - universal compatibility

**Database locations:**

- All platforms: `~/.local/share/opencode/opencode.db` (XDG path, same as Linux)

## Usage

### In Your Terminal

```bash
taco              # Interactive TUI dashboard (default)
taco overview     # Plain text overview with heatmap
taco models       # Model breakdown
taco today        # Today's usage
taco sessions     # Recent sessions
taco --help       # All commands
```

### In OpenCode (Zero LLM Tokens!)

```
!taco overview     # Show usage stats
!taco today        # Today's usage
!taco sessions     # Recent sessions
!taco view         # Full dashboard
```

The `!` prefix runs commands locally without sending data to the AI.

## Installation

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/bulga138/token-accumulator-counter-opencode/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/bulga138/token-accumulator-counter-opencode/main/install.ps1 | iex
```

Or download from GitHub releases.

## Architecture

**Current Implementation:** Pure TypeScript CLI with memory optimizations

- Entry: `bin/taco.ts`
- Database: Multi-driver support (Bun > better-sqlite3 > sql.js)
- Output: Terminal charts via asciichart + chalk
- Memory: Streaming queries, SQLite aggregations, query limits
- No runtime dependencies beyond Node.js 18+

**Key Memory Optimizations:**

- SQLite-native aggregations (COUNT, SUM) instead of loading all data
- Streaming with `.iterate()` for large datasets
- Default 90-day query window
- Hard limit of 100k rows per query
- Cache stores aggregates, not full events

**Original Design (Deprecated):**

- TypeScript plugin → TCP → Go daemon → SQLite
- Abandoned because reading OpenCode's DB directly is simpler

## Project Structure

```
token-accumulator-counter-opencode/
├── bin/taco.ts              # CLI entry point
├── src/
│   ├── aggregator/          # Data computation (streaming + aggregations)
│   ├── cli/                 # Command implementations
│   ├── config/              # Configuration management
│   ├── data/                # Database queries (multi-driver)
│   ├── format/              # Output formatting (visual, JSON, CSV, markdown)
│   └── utils/               # Helper functions
├── tests/                   # Unit tests (Vitest)
├── dist/                    # Compiled JavaScript
├── install.sh               # Main installer
├── install.ps1              # PowerShell installer
├── uninstall.sh             # Uninstaller
├── update.sh                # Updater script
├── eslint.config.js         # ESLint configuration
├── .prettierrc              # Prettier configuration
├── CONTRIBUTING.md          # Contribution guidelines
└── README.md                # User documentation
```

## Features

- **Token Tracking:** Input/output tokens, cache reads/writes, reasoning tokens
- **Cost Analysis:** Daily summaries, projections by provider, budget warnings
- **Visualizations:** ASCII charts, heatmaps, TUI dashboard
- **Cross-Platform:** Windows, macOS, Linux (zero native deps)
- **Memory Efficient:** Handles millions of rows without overflow
- **Zero Configuration:** Works out of the box

## Technical Stack

- **Runtime:** Node.js 18+ or Bun
- **Database:** sql.js (WASM), better-sqlite3 (optional), bun:sqlite (Bun)
- **CLI:** Commander.js
- **Colors:** Chalk
- **Charts:** asciichart
- **Testing:** Vitest
- **Build:** TypeScript compiler
- **Linting:** ESLint 10 + TypeScript ESLint
- **Formatting:** Prettier

## Development

```bash
pnpm install           # Install dependencies
pnpm run build         # Compile TypeScript
pnpm test              # Run tests
pnpm run typecheck     # Check types
pnpm run lint          # Run ESLint
pnpm run lint:fix      # Fix ESLint issues
pnpm run format        # Format with Prettier
pnpm run dev           # Run locally (with Bun)
```

## CI/CD

- **Test Matrix:** Ubuntu, Windows, macOS × Node.js 18, 20, 22
- **Build:** Cross-platform executables (Linux x64, Windows x64, macOS x64/ARM64)
- **Release:** GitHub releases with binaries and source archive
- **Publish:** npm registry

## Release Checklist

- [x] All CLI commands working
- [x] Cross-platform testing
- [x] Install scripts tested
- [x] Documentation complete
- [x] GitHub release ready
- [x] ESLint + Prettier configured
- [x] Memory optimizations implemented

## Future Ideas (Not Critical)

- Sixel pixel art for creature
- Multi-currency support
- MCP server integration
- More creature species
- Real-time monitoring mode

## Historical Context

This project started as a two-component system (TypeScript plugin + Go daemon) but was simplified to a single TypeScript CLI that reads OpenCode's database directly. The original design docs (REQUIREMENT.md, ROADMAP.md, etc.) are preserved in git history but removed from the working tree to reduce clutter.

**Key Decision:** Reading the DB directly is simpler than maintaining a daemon and plugin architecture. No TCP sockets, no IPC, no background processes. Just a CLI tool that queries data and shows charts.

**Memory Crisis Resolution:** A 32GB memory overflow led to major refactoring:
- Replaced `.all()` with `.iterate()` for streaming
- Added SQLite-native aggregations
- Implemented query limits and default date windows
- Cache now stores aggregates instead of full events

---

**Status:** Production ready! 🚀
