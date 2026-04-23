# TACO Project Context

**Token Accumulator Counter for OpenCode** 🌮

**Last Updated:** April 20, 2026

---

## What TACO Is

A CLI tool that tracks your OpenCode token usage, costs, and shows pretty charts in your terminal. No background processes, no configuration, just run it and see your stats.

## AI Agent Guidelines

When modifying this codebase:

**Always:**

- Run `pnpm run typecheck` and `pnpm run lint` after changes
- Follow existing patterns in neighboring files
- Add error handling for all async operations
- Respect memory constraints (streaming > loading all data)
- Update CONTEXT.md if architecture changes

**Never:**

- Add new runtime dependencies without explicit approval
- Break gateway integration (it's optional but must not crash)
- Use `.all()` for large queries (use `.iterate()` instead)
- Hardcode paths - use the path utilities in `src/utils/`

**Testing:**

- Unit tests: `pnpm test`
- All commands must work without gateway config
- Cross-platform: Windows (PowerShell), macOS, Linux

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
taco models       # Model breakdown (with gateway cost column if configured)
taco today        # Today's usage
taco daily        # Daily breakdown (with gateway column if configured)
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

## Architecture

**Current Implementation:** Pure TypeScript CLI with memory optimizations

- Entry: `bin/taco.ts`
- Database: Multi-driver support (Bun > better-sqlite3 > sql.js)
- Output: Terminal charts via asciichart + chalk
- Memory: Streaming queries, SQLite aggregations, query limits
- Dependencies: Fixed versions (see package.json), Node.js 22+

**Key Memory Optimizations:**

- SQLite-native aggregations (COUNT, SUM) instead of loading all data
- Streaming with `.iterate()` for large datasets
- Default 90-day query window
- Hard limit of 100k rows per query
- Cache stores aggregates, not full events

**Gateway Data Flow:**

```
config.gateway.endpoint (e.g. https://custom-gateway.com/user/info)
       │
       ├─ Primary fetch (JSONPath mappings, gateway.ts)
       │    → GatewayMetrics: totalSpend, budgetLimit, teamSpend, budgetResetAt
       │    → Used by: taco overview, taco today, TUI Overview tab
       │
       └─ Auto-derived baseUrl (gateway-litellm.ts, no extra config needed)
            ├─ /spend/logs?start_date=...&end_date=...
            │    → Per-model actual spend aggregated across all providers
            │    → Used by: taco models (Gateway Cost column)
            │
            ├─ /user/daily/activity?start_date=...&end_date=...
            │    → Per-day spend + token counts + per-model breakdown
            │    → Used by: taco daily (Gateway $ column in main table)
            │
            └─ /model/info
                 → Per-model pricing rates (input/output/cache cost per token)
                 → Used by: taco config gateway --test (discovery probe)
```

## Project Structure

```
taco/
├── bin/taco.ts                  # CLI entry point
├── src/
│   ├── aggregator/              # Data computation (streaming + aggregations)
│   ├── cli/                     # Command implementations
│   │   └── commands/
│   │       ├── config-cmd.ts    # taco config (incl. gateway --setup/--test/--status)
│   │       ├── daily.ts         # taco daily (+ gateway $ column in main table)
│   │       ├── models.ts        # taco models (+ gateway cost column)
│   │       ├── overview.ts      # taco overview (+ gateway metrics section)
│   │       ├── today.ts         # taco today (+ gateway spend + per-model gateway cost)
│   │       ├── tui.ts           # TUI dashboard (+ gateway on all tabs)
│   │       ├── update.ts        # taco update (binary self-replacement via git ls-remote)
│   │       ├── uninstall.ts     # taco uninstall (removes binary, PATH entries, cache/config)
│   │       └── completion.ts    # taco completion (bash/zsh/fish script generator)
│   ├── config/                  # Configuration management
│   │   └── index.ts             # TacoConfig, GatewayConfig, GatewayAuth,
│   │                            # GatewayFieldMapping — all config types here
│   ├── data/                    # Database queries + gateway integration
│   │   ├── db.ts                # Multi-driver SQLite loader
│   │   ├── queries.ts           # All SQLite query functions
│   │   ├── gateway.ts           # Primary gateway fetch (JSONPath-based, any endpoint)
│   │   ├── gateway-litellm.ts   # LiteLLM auto-discovery (/spend/logs, /user/daily/activity)
│   │   ├── gateway-cache.ts     # Multi-layer cache (live TTL + date-range + daily snapshots)
│   │   └── gateway-types.ts     # All gateway type definitions
│   ├── format/                  # Output formatting (visual, JSON, CSV, markdown)
│   ├── utils/                   # Helper functions
│   │   ├── jsonpath.ts          # Zero-dep JSONPath resolver ($a.b[0].c) + env var resolver
│   │   └── model-names.ts       # Model name normalization + aggregation across providers
│   └── viz/                     # ASCII charts and heatmap rendering
│       └── chart.ts             # renderModelPanels accepts optional gatewaySpend
├── tests/                       # Unit tests (Vitest)
├── dist/                        # Compiled JavaScript (auto-generated by tsc)
├── install.sh                   # Main installer (macOS/Linux) — binary-first, source fallback
├── install.ps1                  # PowerShell installer (Windows) — binary-first, source fallback
├── uninstall.sh                 # Uninstaller (source-based installs / broken binary fallback)
├── uninstall.ps1                # PowerShell uninstaller (source-based installs)
├── eslint.config.js             # ESLint configuration
├── .prettierrc                  # Prettier configuration
├── CONTRIBUTING.md              # Contribution guidelines
└── README.md                    # User documentation
```

**Cross-Reference Guide:**

When modifying these files, also update:

- `src/cli/commands/*.ts` → All formatters in `src/format/`
- `src/config/index.ts` → Commands that use the new config option
- `src/data/gateway*.ts` → Commands in `src/cli/commands/` for integration
- `src/format/*.ts` → Keep all 4 formatters consistent (visual, json, csv, markdown)

## Features

- **Token Tracking:** Input/output tokens, cache reads/writes, reasoning tokens
- **Cost Analysis:** Daily summaries, projections by provider, budget warnings
- **Gateway Integration:** Real spend/budget from any LiteLLM/OpenRouter/custom proxy
  - Configurable JSONPath mappings for primary endpoint (any JSON shape)
  - LiteLLM auto-discovery: `/spend/logs`, `/user/daily/activity`, `/model/info` probed automatically
  - Per-model gateway cost column in `taco models`
  - Gateway `$` column merged into `taco daily` main table
  - Gateway costs inline in TUI Models, Providers, and Overview tabs
  - Model name normalization across provider prefixes (bedrock, azure_ai, vertex_ai, etc.)
- **Visualizations:** ASCII charts, heatmaps, TUI dashboard
- **Cross-Platform:** Windows, macOS, Linux (zero native deps)
- **Memory Efficient:** Handles millions of rows without overflow
- **Zero Configuration:** Works out of the box

## Known Issues & Constraints

**OpenCode Bugs We Work Around:**

- Cost shows $0 for dot-format model IDs (e.g., `claude-sonnet-4.6`) - gateway integration provides correct values

**Hard Constraints:**

- Node.js 22+ only (no older versions)
- Dependencies are pinned to fixed versions (see package.json)
- Must handle 32GB+ datasets without memory overflow
- Gateway fetch failures must not crash the CLI (graceful degradation)
- All file paths must use cross-platform utilities (no hardcoded `/` or `\`)
- **Package Manager Support:** Must work with pnpm, npm, and yarn (no lockfile-specific features)

**Security & Privacy:**

- **Error Sanitization:** All error messages are sanitized to remove sensitive data (URLs, API keys, tokens). Use `sanitizeErrorMessage()` from `src/utils/error-sanitization.js` when displaying errors.
- **Cache Permissions:** Cache files use restrictive permissions (0600) to prevent other users from reading spend data.
- **Database Retry:** Automatic retry with exponential backoff for "database is locked" errors (3 attempts: 100ms, 500ms, 1000ms).
- **Schema Detection:** Database schema is validated on startup to detect OpenCode schema changes that might affect TACO.

## API Gateway Integration

TACO can fetch real cost data from an API gateway (LiteLLM, OpenRouter, or any custom JSON endpoint) and display it alongside OpenCode's local estimates.

**Why:** OpenCode computes costs locally using standard per-token list prices. Gateways may use different rates — the integration shows the gateway's actual figures so you know your real bill.

### Quick Reference: Adding Gateway Support

To add gateway data to a command:

1. Import from `src/data/gateway.js` and/or `src/data/gateway-litellm.js`
2. Fetch metrics (returns `null` if unavailable - always handle this case)
3. Merge gateway data with local data
4. Update all formatters in `src/format/`

**Key Functions:**

- `fetchGatewayMetrics(config)` - Primary endpoint (total spend, budget)
- `fetchModelSpend(baseUrl, auth, startDate, endDate)` - Per-model spend from `/spend/logs`
- `fetchDailyActivity(baseUrl, auth, startDate, endDate)` - Daily breakdown from `/user/daily/activity`
- `normalizeModelName(name)` - Strip provider prefixes for aggregation

### Cost Discrepancy

OpenCode writes `cost: 0` for model IDs in "dot format" (e.g. `claude-sonnet-4.6`) — a known OpenCode bug where its pricing table doesn't recognize the dot-format names. TACO reads these zeros verbatim. The gateway integration shows the correct costs.

OpenCode also uses standard list rates for dash-format models, while gateways may use negotiated pricing. This causes local estimates to be higher than actual gateway spend.

### Primary Gateway (Any Endpoint)

Configured via `taco config gateway --setup`. Uses JSONPath mappings so it works with any JSON shape:

```json
{
  "gateway": {
    "endpoint": "https://custom-gateway.com/user/info",
    "auth": { "type": "bearer", "tokenOrEnv": "${API_KEY}" },
    "mappings": {
      "totalSpend": "$.user_info.spend",
      "budgetLimit": "$.user_info.max_budget",
      "budgetResetAt": "$.user_info.budget_reset_at",
      "budgetDuration": "$.user_info.budget_duration",
      "teamSpend": "$.teams[0].spend",
      "teamBudgetLimit": "$.teams[0].max_budget",
      "teamName": "$.teams[0].team_alias"
    },
    "cacheTtlMinutes": 15
  }
}
```

Auth supports: `bearer`, `basic`, custom `header`. API key values use `"${ENV_VAR}"` references so secrets are never stored.

### Configuration Validation

Gateway configuration is validated before saving to catch errors early:

**Validation checks:**

- Endpoint URL format (must be valid HTTP/HTTPS)
- Auth type and required fields
- JSONPath syntax (must start with `$.`, no wildcards/filters)
- Cache TTL (must be non-negative number)

**Commands:**

- `taco config gateway --setup` - Interactive wizard with validation
- `taco config gateway --validate` - Validate existing config without fetching live data
- `taco config gateway --test` - Validate + test with live endpoint

**Key Functions:**

- `validateGatewayConfig(config)` - Validates complete config structure
- `testJsonPathMappings(mappings, sampleData)` - Tests mappings against sample JSON
- `formatValidationErrors(errors)` - Formats errors for display

### LiteLLM Auto-Discovery

When the gateway is LiteLLM-compliant (LiteLLM proxy, OpenRouter, or compatible), TACO automatically derives the base URL from the configured endpoint and probes standard paths — no additional configuration needed:

| Endpoint               | Data                                         | Used By                             |
| ---------------------- | -------------------------------------------- | ----------------------------------- |
| `/spend/logs`          | Per-model actual spend by date range         | `taco models` (Gateway Cost column) |
| `/user/daily/activity` | Per-day spend + tokens + per-model breakdown | `taco daily` (Gateway $ column)     |
| `/model/info`          | Per-model pricing rates                      | `taco config gateway --test`        |

Both `/spend/logs` and `/user/daily/activity` accept `start_date` and `end_date` query parameters — TACO automatically uses the current billing period (1st of month → today).

**OpenRouter example:**

```json
{
  "gateway": {
    "endpoint": "https://openrouter.ai/api/v1/auth/key",
    "auth": { "type": "bearer", "tokenOrEnv": "${OPENROUTER_API_KEY}" },
    "mappings": {
      "totalSpend": "$.data.usage",
      "budgetLimit": "$.data.limit"
    }
  }
}
```

### Model Name Normalization

The gateway returns model names with provider prefixes (e.g. `vertex_ai/claude-opus-4-6`, `bedrock/global.anthropic.claude-opus-4-6-v1`, `azure_ai/Claude-Opus-4.6`). TACO normalizes all variants to a canonical form and aggregates spend across providers:

```
vertex_ai/claude-opus-4-6                    → $29.16
bedrock/global.anthropic.claude-opus-4-6-v1  → $6.09
azure_ai/Claude-Opus-4.6                     → $0.77
─────────────────────────────────────────────────────
claude-opus-4-6 (aggregated)                 → $36.02
```

Normalization steps: strip provider prefix → strip version suffix → replace dots with dashes → strip trailing wildcards.

### Caching Strategy

```
~/.cache/taco/
├── gateway-metrics.json         TTL: 15 min  Primary endpoint response
├── gateway-model-spend.json     TTL: 60 min  /spend/logs per-model spend
│                                             (past date ranges: 24h — immutable)
├── gateway-daily-activity.json  TTL: 60 min  /user/daily/activity breakdown
│                                             (past date ranges: 24h — immutable)
└── gateway-daily/
    └── YYYY-MM-DD.json          90 days     Daily aggregate snapshots (auto-rotated)
```

**Cache Rotation:** Daily snapshots older than 90 days are automatically deleted to prevent unbounded disk usage. Rotation runs asynchronously after each write.

**File Permissions:** Cache directory is created with `0o700` (owner-only), files with `0o600` (owner read/write only) for security.

## Common Modification Patterns

**Adding a new command:**

1. Create file in `src/cli/commands/`
2. Register in `bin/taco.ts`
3. Update formatters in `src/format/`
4. Add tests in `tests/`

**Adding gateway support to existing command:**

1. Import `fetchGatewayMetrics` from `src/data/gateway.js`
2. Import LiteLLM helpers if needed (`src/data/gateway-litellm.js`)
3. Gracefully handle null (gateway unavailable)
4. Update all formatters (visual, json, csv, markdown)

**Modifying database queries:**

1. Use SQLite-native aggregations (COUNT, SUM)
2. Add LIMIT clauses (default 100k max)
3. Use date range filters (default 90 days)
4. Test with `.iterate()` for large datasets

**Adding a new config option:**

1. Add type to `src/config/index.ts`
2. Update `getConfig()` and `saveConfig()` if needed
3. Add to `taco config` command in `src/cli/commands/config-cmd.ts`
4. Document in README.md

**Adding cache functionality:**

1. Use `ensureDir()` from `src/data/gateway-cache.ts` for directory creation (handles permissions)
2. Set file permissions to 0600 after writing sensitive data
3. Implement rotation logic for cleanup of old files
4. Use `setImmediate()` for async cleanup to avoid blocking

**Adding error handling:**

1. Use `sanitizeErrorMessage()` from `src/utils/error-sanitization.js` when displaying errors
2. Use `sanitizeError()` to sanitize Error objects while preserving stack traces
3. Never log full URLs, API keys, or tokens in error messages

**Adding database functionality:**

1. Use `verifyDatabaseAccess()` to test DB connectivity before operations
2. Use `getDbAsync()` with retry logic for automatic handling of locked DB
3. Use `detectSchema()` to validate OpenCode schema compatibility
4. Check for column existence with `hasColumn()` before using new fields

**Adding gateway validation:**

1. Use `validateGatewayConfig()` before saving config
2. Use `testJsonPathMappings()` to test against sample responses
3. Provide clear error messages with `formatValidationErrors()`
4. Test connectivity after validation passes

## Technical Stack

- **Runtime:** Node.js 22+ or Bun
- **Database:** sql.js (WASM), better-sqlite3 (optional), bun:sqlite (Bun)
- **CLI:** Commander.js
- **Colors:** Chalk
- **Charts:** asciichart
- **HTTP:** Node built-in `fetch()` (gateway integration, no added dependency)
- **Testing:** Vitest
- **Build:** TypeScript compiler
- **Linting:** ESLint 10 + TypeScript ESLint
- **Formatting:** Prettier

## Release Checklist

- [x] All CLI commands working
- [x] Cross-platform testing
- [x] Install scripts tested
- [x] Documentation complete
- [x] GitHub release ready
- [x] ESLint + Prettier configured
- [x] Memory optimizations implemented
- [x] Gateway integration (primary + LiteLLM auto-discovery)
- [x] Per-model gateway cost in `taco models`
- [x] Gateway `$` column merged into `taco daily`
- [x] Gateway costs inline in TUI (Overview, Models, Providers tabs)

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

## Install Script Architecture

The install scripts (`install.sh` / `install.ps1`) use a binary-first two-path strategy:

**Remote install (`curl | bash` / `irm | iex`):**

1. Fetch latest release tag via `git ls-remote`
2. Detect OS and architecture
3. Download standalone binary directly from GitHub Releases (e.g. `taco-1.0.2-macos-arm64`)
4. Verify SHA-256 checksum (if available)
5. Install binary to `~/.taco/`, add to PATH, set up completions
6. If no binary exists for the platform: print instructions to clone and build, exit

**Local install (from source clone):**

1. Try binary download first (same as above)
2. If binary unavailable: detect `tsconfig.json` → run `pnpm run build` (or `npm run build`)
3. Copy `dist/` to `~/.taco/`, run `npm install --omit=dev`, create launcher script

**Update and Uninstall:**

- `taco update` — downloads replacement binary, performs atomic self-replacement
- `taco uninstall` — removes install dir, cleans PATH from shell rc files, removes cache/config
- `uninstall.sh` / `uninstall.ps1` remain available for source-based installs or broken binaries

**No source archive needed** — releases are standalone binaries only. No `taco-release-*.tar.gz`.

## CI/CD

- **Test Matrix:** Ubuntu, Windows, macOS × Node.js 22, 24
- **Build:** Cross-platform executables (Linux x64, Windows x64, macOS x64/ARM64)
- **Release:** GitHub releases with standalone binaries (Linux x64/arm64, Windows x64, macOS x64/ARM64)
- **Manual Release:** GitHub Actions supports `workflow_dispatch` with a version input
