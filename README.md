# TACO

Token Accumulator Counter for OpenCode.

Tracks token usage and costs from your OpenCode sessions and shows charts in your terminal.

## Platform support

- Windows 10/11
- macOS 12+ (Intel and Apple Silicon)
- Linux (Ubuntu 20.04+, most distros)

[Bun](https://bun.sh) gives the best performance (10x faster database queries). Node.js 18+ works too, with automatic fallback to a pure WASM SQLite driver if needed.

## Installation

### Standalone binary

Download a pre-compiled binary for your platform from the
[releases page](https://github.com/bulga138/token-accumulator-counter-opencode/releases/latest).
No runtime required.

After downloading, make it executable and move it to `~/.taco/`:

```bash
mkdir -p ~/.taco
chmod +x taco-*
mv taco-* ~/.taco/taco
export PATH="$HOME/.taco:$PATH"
```

Add the `export` line to `~/.zshrc` or `~/.bashrc` for future sessions.

### Install script

macOS / Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/bulga138/token-accumulator-counter-opencode/main/install.sh | bash
```

Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/bulga138/token-accumulator-counter-opencode/main/install.ps1 | iex
```

The installer will prompt to install Bun if it's not already present.

### Build from source

```bash
git clone https://github.com/bulga138/token-accumulator-counter-opencode.git
cd token-accumulator-counter-opencode
pnpm install
pnpm run build
./dist/bin/taco.js
```

## Commands

Run `taco` with no arguments to open the TUI dashboard, or use a subcommand directly:

```
taco              # TUI dashboard (default)
taco overview     # Text overview with heatmap
taco models       # Breakdown by model
taco providers    # Breakdown by provider
taco sessions     # Recent sessions
taco daily        # Daily stats
taco projects     # Per-project breakdown
taco agents       # Agent type usage
taco trends       # Compare time periods
taco --plain      # No colors (useful in scripts)
```

## OpenCode integration

Prefix any `taco` command with `!` inside OpenCode to run it locally without consuming any LLM tokens:

```
!taco overview
!taco models
!taco sessions
```

Using `/` (slash commands) instead routes through the AI and costs tokens. Use `!` for stats.

## How it works

TACO reads directly from OpenCode's SQLite database. No daemon, no background process.

```
OpenCode stores data in SQLite
         ↓
TACO reads it (auto-detects best driver: Bun > better-sqlite3 > sql.js)
         ↓
Charts in your terminal
```

Database location (all platforms): `~/.local/share/opencode/opencode.db`

## Under the hood

TypeScript. Dependencies:

- `bun:sqlite` / `better-sqlite3` / `sql.js` — SQLite (auto-detected)
- commander — CLI args
- chalk — colors
- asciichart — line charts
- dayjs — date formatting

## Project layout

```
token-accumulator-counter-opencode/
├── bin/taco.ts         # Entry point
├── src/
│   ├── cli/            # Commands
│   ├── data/           # Database queries
│   ├── format/         # Output formatting
│   ├── viz/            # Charts and heatmaps
│   └── utils/          # Helpers
├── dist/               # Compiled JS
└── tests/              # Tests
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, code style, and PR guidelines.

## Updating

```bash
./update.sh
```

## Uninstall

macOS / Linux:
```bash
~/.taco/uninstall.sh
```

Windows (PowerShell):
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.taco"
```

From a local clone:
```bash
./uninstall.sh
```

## License

MIT.
