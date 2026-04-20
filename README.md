# TACO

Token Accumulator Counter for OpenCode.

Tracks token usage and costs from your OpenCode sessions and shows charts in your terminal.

## Platform support

- Windows 10/11
- macOS 12+ (Intel and Apple Silicon)
- Linux (Ubuntu 20.04+, most distros)

[Bun](https://bun.sh) gives the best performance (10x faster database queries). Node.js 22+ works too, with automatic fallback to a pure WASM SQLite driver if needed.

## Installation

### Standalone binary

Download a pre-compiled binary for your platform from the
[releases page](https://github.com/bulga138/taco/releases/latest).
No runtime required.

**Available platforms:**

- Linux x64: `taco-vX.Y.Z-linux-x64`
- macOS x64 (Intel): `taco-vX.Y.Z-macos-x64`
- macOS arm64 (Apple Silicon): `taco-vX.Y.Z-macos-arm64`
- Windows x64: `taco-vX.Y.Z-windows-x64.exe`

Each binary includes a SHA256 checksum file (`.sha256`) for verification.

After downloading, make it executable and move it to `~/.taco/`:

```bash
mkdir -p ~/.taco
chmod +x taco-*
mv taco-* ~/.taco/taco
export PATH="$HOME/.taco:$PATH"
```

Add the `export` line to `~/.zshrc` or `~/.bashrc` for future sessions.

### Install script

The install script automatically detects your platform and architecture, then downloads the appropriate pre-built binary (fast, ~10 seconds). If a binary isn't available, it falls back to building from source (~60 seconds).

**macOS / Linux:**

```bash
# Default: Try binary first, fallback to source
curl -fsSL https://raw.githubusercontent.com/bulga138/taco/master/install.sh | bash

# Force source build (if you prefer)
curl -fsSL https://raw.githubusercontent.com/bulga138/taco/master/install.sh | bash -s -- --prefer-source
```

**Windows (PowerShell):**

```powershell
# Default: Try binary first, fallback to source
irm https://raw.githubusercontent.com/bulga138/taco/master/install.ps1 | iex

# Force source build (if you prefer)
irm https://raw.githubusercontent.com/bulga138/taco/master/install.ps1 | iex -PreferSource
```

**Install options:**

- `--system` / `-System` — System-wide install (requires admin)
- `--prefer-source` / `-PreferSource` — Build from source instead of downloading binary
- `--help` / `-Help` — Show help

The installer will prompt to install Bun if it's not already present.

### Build from source

TACO works with any of these package managers:

**pnpm (recommended):**

```bash
git clone https://github.com/bulga138/taco.git
cd taco
pnpm install
pnpm run build
./dist/bin/taco.js
```

**npm:**

```bash
git clone https://github.com/bulga138/taco.git
cd taco
npm install
npm run build
./dist/bin/taco.js
```

**yarn:**

```bash
git clone https://github.com/bulga138/taco.git
cd taco
yarn install
yarn build
./dist/bin/taco.js
```

**Bun (fastest):**

```bash
git clone https://github.com/bulga138/taco.git
cd taco
bun install
bun run build
./dist/bin/taco.js
```

## Commands

Run `taco` with no arguments to open the TUI dashboard, or use a subcommand directly:

```
taco              # TUI dashboard (default)
taco overview     # Text overview with heatmap
taco today        # Today's usage
taco models       # Breakdown by model
taco providers    # Breakdown by provider
taco sessions     # Recent sessions
taco daily        # Daily stats
taco projects     # Per-project breakdown
taco agents       # Agent type usage
taco trends       # Compare time periods
taco --plain      # No colors (useful in scripts)
taco --help       # Show all commands and options
```

## OpenCode integration

Prefix any `taco` command with `!` inside OpenCode to run it locally without consuming any LLM tokens:

```
!taco overview
!taco models
!taco sessions
```

Using `/` (slash commands) instead routes through the AI and costs tokens. Use `!` for stats.

## API Gateway Integration

If your AI traffic goes through a proxy (LiteLLM, OpenRouter, LangFuse, or any custom JSON endpoint), TACO can fetch real spend and budget data from it and display it alongside the local OpenCode estimates.

### Why this matters

OpenCode computes costs locally using standard per-token rates. Your gateway may use different rates (enterprise discounts, different cache pricing). This integration shows the gateway's actual figures so you know your real bill.

### Setup

```bash
taco config gateway --setup
```

The interactive wizard asks for the endpoint URL, auth credentials (via env var), and walks you through mapping the response fields using JSONPath expressions. You can paste a sample JSON response and it will auto-detect the paths for you.

### Manual config (`~/.config/taco/config.json`)

```json
{
  "gateway": {
    "endpoint": "https://ai-custom-gateway.com/user/info",
    "auth": {
      "type": "bearer",
      "tokenOrEnv": "${LITELLM_API_KEY}"
    },
    "mappings": {
      "totalSpend": "$.user_info.spend",
      "budgetLimit": "$.user_info.max_budget",
      "budgetResetAt": "$.user_info.budget_reset_at",
      "teamSpend": "$.teams[0].spend",
      "teamBudgetLimit": "$.teams[0].max_budget",
      "teamName": "$.teams[0].team_alias"
    },
    "cacheTtlMinutes": 15
  }
}
```

Works with **any** HTTP JSON endpoint — LiteLLM, OpenRouter (`$.data.usage`), LangFuse, or a custom proxy. No hard-coded format assumptions.

Auth supports: `bearer`, `basic`, and custom `header` types. API key values can be supplied as `"${ENV_VAR_NAME}"` references to avoid storing secrets in the config file.

### Commands

```bash
taco config gateway --setup        # Interactive configuration wizard
taco config gateway --status       # Show current config
taco config gateway --test         # Fetch and display live metrics
taco config gateway --validate     # Validate config without fetching live data
taco config gateway --clear-cache  # Force refresh on next run
taco config gateway --disable      # Remove gateway config
```

### Caching

- **Live data** is cached for `cacheTtlMinutes` (default: 15 min) so running `taco` frequently doesn't spam the gateway
- **Daily snapshots** (`~/.cache/taco/gateway-daily/YYYY-MM-DD.json`) are written after each successful fetch
- **Cache rotation:** Files older than 90 days are automatically deleted to prevent unbounded disk usage
- **Security:** Cache files use restrictive permissions (0600) so only you can read them

## How it works

TACO reads directly from OpenCode's SQLite database. No daemon, no background process.

```
OpenCode stores data in SQLite
         ↓
TACO reads it (auto-detects best driver: Bun > better-sqlite3 > sql.js)
         ↓
Charts in your terminal

(optional) API Gateway fetch
         ↓
Real spend/budget overlaid on local estimates
```

Database location (all platforms): `~/.local/share/opencode/opencode.db`

## Under the hood

TypeScript. Dependencies:

- `bun:sqlite` / `better-sqlite3`\* / `sql.js` — SQLite (auto-detected)
- commander — CLI args
- chalk — colors
- asciichart — line charts
- dayjs — date formatting
- Node `fetch()` — gateway HTTP calls (built-in, no extra dependency)

* better-sqlite3 returns a deprecated warning: `prebuild-install@7.1.3: No longer maintained. Please contact the author of the relevant native addon; alternatives are available`. It is a known issue: https://github.com/WiseLibs/better-sqlite3/issues/655, https://github.com/WiseLibs/better-sqlite3/issues/1209, https://github.com/WiseLibs/better-sqlite3/pull/1446,

## Project layout

```
taco/
├── bin/taco.ts         # Entry point
├── src/
│   ├── cli/            # Commands
│   ├── data/           # Database queries + gateway fetch/cache
│   ├── format/         # Output formatting
│   ├── viz/            # Charts and heatmaps
│   └── utils/          # Helpers (jsonpath, formatting, dates)
├── dist/               # Compiled JS
└── tests/              # Tests
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, code style, and PR guidelines.

### Git Hooks

We use lefthook to enforce code quality:

```bash
# Install git hooks
lefthook install
```

Pre-commit: Format check
Pre-push: Type check, lint, tests
Commit-msg: Conventional commits format

### Release Process

Releases are automated using PR labels:

1. Create PR with changes
2. Add `RELEASE` label
3. Add `MAJOR`/`MINOR`/`PATCH` label (default: PATCH)
4. Merge to master
5. GitHub Actions creates release automatically

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Updating

```bash
./update.sh
```

## Uninstall

**macOS / Linux:**

```bash
~/.taco/uninstall.sh

# Or from a local clone:
./uninstall.sh
```

**Windows (PowerShell):**

```powershell
# Using the uninstall script (recommended):
& "$env:USERPROFILE\.taco\uninstall.ps1"

# Or manually:
Remove-Item -Recurse -Force "$env:USERPROFILE\.taco"
```

**Uninstall options:**

- `--system` / `-System` — Uninstall system-wide installation
- `--help` / `-Help` — Show help

## License

MIT License - see [LICENSE](./LICENSE) file
