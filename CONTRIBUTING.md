# Contributing to TACO 🌮

Thanks for your interest in contributing! This document will help you get started.

## Prerequisites

- **Node.js** 22+ (required)
- **Package manager** — any of these work:
  - **pnpm** (recommended - `npm install -g pnpm`)
  - **npm** (comes with Node.js)
  - **yarn** (`npm install -g yarn`)
- **Bun** (optional, for fastest development - 10x faster SQLite via `bun:sqlite`)
- **Git**

## Setup

1. **Fork and clone:**

   ```bash
   git clone https://github.com/bulga138/taco.git
   cd taco
   ```

2. **Install dependencies:**

   ```bash
   # With pnpm (recommended)
   pnpm install

   # Or with npm
   npm install

   # Or with yarn
   yarn install

   # Or with Bun (fastest)
   bun install
   ```

3. **Verify setup:**
   ```bash
   pnpm run typecheck
   pnpm run lint
   pnpm test
   ```

## Development Workflow

### Running locally

```bash
# Development mode (with Bun)
bun run dev

# Or with Node
pnpm run dev
```

### Building

```bash
pnpm run build
```

The build compiles all `src/**/*.ts` to `dist/`. This is what gets shipped to users — the install scripts copy the `dist/` tree directly, so all new source files must be added under `src/` and will be included automatically.

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm run test:watch

# Coverage
pnpm run test:coverage
```

### Code quality

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint
pnpm run lint:fix  # Auto-fix issues

# Formatting
pnpm run format        # Format all files
pnpm run format:check  # Check formatting without fixing
```

## Git Hooks and Code Quality

We use **lefthook** to enforce code quality and commit message standards.

### Pre-commit Hooks

- **Format check**: Ensures code is properly formatted with Prettier
- **Auto-format**: Automatically fixes formatting issues

### Pre-push Hooks

- **Type check**: Ensures TypeScript types are correct
- **Lint**: Ensures code follows ESLint rules
- **Tests**: Runs all tests before pushing

### Commit Message Hooks

- **Conventional commits**: Enforces commit message format
  - `feat:` - New feature
  - `fix:` - Bug fix
  - `docs:` - Documentation
  - `refactor:` - Code restructuring
  - `test:` - Tests
  - `chore:` - Maintenance

### Installing Git Hooks

After cloning the repository:

```bash
pnpm install
lefthook install
```

## Release Process

We use automated version management with PR labels.

### Creating a Release

1. Create a PR with your changes
2. Add the `RELEASE` label to the PR
3. Add one of these labels to specify the version bump:
   - `MAJOR` - Breaking changes (1.0.0 → 2.0.0)
   - `MINOR` - New features (1.0.0 → 1.1.0)
   - `PATCH` - Bug fixes (1.0.0 → 1.0.1) - default if none specified
4. Merge the PR to master
5. GitHub Actions will:
   - Bump the version in package.json
   - Create a git tag
   - Build cross-platform binaries
   - Generate a changelog from commits
   - Create a GitHub release

### Example

```bash
# Create PR with labels: RELEASE, MINOR
# Merge to master
# → Version bumps from 0.1.4 to 0.1.5
# → Tag v0.1.5 created
# → Release created with auto-generated changelog
```

### Commit Message Format

Follow conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:

- `feat:` - New feature (triggers MINOR bump)
- `fix:` - Bug fix (triggers PATCH bump)
- `docs:` - Documentation only
- `refactor:` - Code restructuring
- `test:` - Tests
- `chore:` - Maintenance

Breaking changes:

- Add `!` after type: `feat!: breaking change`
- Or add `BREAKING CHANGE:` in footer

## Project Structure

```
├── bin/              # CLI entry point (taco.ts)
├── src/
│   ├── aggregator/   # Data computation logic (streaming, per-model, per-day, etc.)
│   ├── cli/          # Command-line interface
│   │   ├── commands/ # One file per taco subcommand
│   │   │   ├── config-cmd.ts   # taco config (gateway --setup/--test/--status)
│   │   │   ├── daily.ts        # taco daily  (+ gateway daily section)
│   │   │   ├── models.ts       # taco models (+ gateway cost column)
│   │   │   ├── overview.ts     # taco overview (+ gateway metrics)
│   │   │   ├── today.ts        # taco today (+ gateway spend)
│   │   │   └── tui.ts          # TUI dashboard
│   │   └── filters.ts          # Shared --from/--to/--format filter helpers
│   ├── config/       # Configuration (TacoConfig, GatewayConfig, all types)
│   ├── data/         # Database queries + gateway integration
│   │   ├── db.ts               # Multi-driver SQLite (Bun > better-sqlite3 > sql.js)
│   │   ├── queries.ts          # All SQLite query functions
│   │   ├── gateway.ts          # Primary gateway fetch (JSONPath mappings, any endpoint)
│   │   ├── gateway-litellm.ts  # LiteLLM auto-discovery (/spend/logs, /user/daily/activity)
│   │   ├── gateway-cache.ts    # Multi-layer cache (live TTL + date-range + daily snapshots)
│   │   └── gateway-types.ts    # All gateway type definitions
│   ├── format/       # Output formatting (visual, JSON, CSV, markdown)
│   ├── utils/        # Shared utilities
│   │   ├── jsonpath.ts         # Zero-dep JSONPath resolver + env var resolution
│   │   ├── model-names.ts      # Model name normalization + aggregation across providers
│   │   ├── formatting.ts       # Number/cost/token formatters
│   │   └── dates.ts            # Date filter helpers
│   └── viz/          # ASCII charts and heatmap rendering
├── tests/            # Vitest test files
└── dist/             # Compiled output (generated — do not edit)
```

## Making Changes

### 1. Create a branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Write code

- Follow existing code style
- Add types (TypeScript strict mode)
- Keep functions small and focused
- Add comments for complex logic

### 3. Test your changes

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Tests
pnpm test
```

**All three must pass** before submitting a PR.

### 4. Commit

Use clear commit messages:

```bash
git commit -m "feat: add streaming support for large datasets"
git commit -m "fix: resolve memory overflow in overview command"
git commit -m "docs: update README with new examples"
```

**Commit message format:**

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `refactor:` — Code restructuring
- `test:` — Tests
- `chore:` — Maintenance

### 5. Push and create PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## Pull Request Guidelines

- **One feature/fix per PR**
- **Include tests** for new functionality
- **Update documentation** if needed (README.md and CONTEXT.md)
- **Ensure CI passes** (typecheck + lint + tests)
- **Reference issues** (e.g., "Fixes #123")

## CI/CD Workflows

We have three GitHub Actions workflows:

### CI (`.github/workflows/ci.yml`)

**Runs on:**

- Every push to master
- Every PR opened/updated to master
- Manual workflow_dispatch

**Jobs:**

- Test (pnpm + Node 20 on Ubuntu)
- Test (Bun)
- Package manager compatibility (npm, pnpm, yarn across Node 20, 22, 24)

### Version Bump (`.github/workflows/version-bump.yml`)

**Runs on:** PR merged to master with `RELEASE` label

**Jobs:**

- Detect bump type from labels (MAJOR/MINOR/PATCH)
- Bump version in package.json
- Commit and push version bump
- Create git tag
- Remove labels from PR

### Release (`.github/workflows/release.yml`)

**Runs on:** Git tags matching `v*`

**Jobs:**

- Build cross-platform binaries (linux-x64, windows-x64, macos-x64, macos-arm64)
- Create source archive
- Generate changelog from commits
- Create GitHub release with binaries and changelog

## Code Style

We use **ESLint** and **Prettier** to enforce code style automatically.

- **TypeScript** — Strict mode enabled
- **2 spaces** indentation
- **No semicolons** (enforced by Prettier)
- **Single quotes** for strings
- **Trailing commas** in multi-line objects/arrays
- **100 character** line width

Run `pnpm run format` before committing to auto-format your code.

Example:

```typescript
export function computeStats(events: UsageEvent[]): Stats {
  const map = new Map<
    string,
    {
      tokens: TokenSummary
      cost: number
    }
  >()

  for (const e of events) {
    // ...
  }

  return map
}
```

## Testing Guidelines

- Test files: `tests/**/*.test.ts`
- Use **Vitest** (test framework)
- Mock database when possible
- Test edge cases (empty data, large datasets)

Example:

```typescript
import { test, expect } from 'vitest'
import { computeOverview } from '../src/aggregator'

test('computeOverview handles empty events', () => {
  const result = computeOverview([], [])
  expect(result.messageCount).toBe(0)
  expect(result.cost).toBe(0)
})
```

## Performance Considerations

TACO handles potentially large datasets. Keep these in mind:

- **Use streaming** for large data processing (`.iterate()` not `.all()`)
- **Add query limits** to prevent unbounded memory usage
- **Prefer SQLite aggregations** over loading data into Node.js
- **Test with large datasets** (100k+ rows)

See `src/data/queries.ts` for examples of memory-efficient patterns.

## Gateway Integration Development

The gateway integration is split across several modules. Here's how they fit together:

### Architecture overview

```
User configures:
  gateway.endpoint = "https://gateway.example.com/user/info"
  gateway.auth     = { type: "bearer", tokenOrEnv: "${MY_KEY}" }

TACO uses:
  gateway.ts          → fetches primary endpoint, applies JSONPath mappings
  gateway-litellm.ts  → derives base URL, probes /spend/logs + /user/daily/activity
  gateway-cache.ts    → caches all responses (TTL + date-range-aware)
  model-names.ts      → normalizes gateway model names to match local DB names
```

### Primary gateway (`gateway.ts`)

Fetches a single endpoint using JSONPath mappings from `config.gateway.mappings`. Works with any JSON shape — not LiteLLM-specific. Handles bearer, basic, and custom header auth. All secret values use `${ENV_VAR}` syntax resolved at runtime.

To add a new mapped field:

1. Add the field to `GatewayFieldMapping` in `src/config/index.ts`
2. Add the field to `GatewayMetrics` in `src/data/gateway-types.ts`
3. Extract it in `parseMetrics()` in `src/data/gateway.ts`
4. Display it where appropriate in the CLI commands

### LiteLLM auto-discovery (`gateway-litellm.ts`)

Derives `baseUrl` from the primary endpoint URL and probes standard LiteLLM paths. Uses the same auth credentials. No extra config required — if the endpoints exist and return data, TACO uses them automatically.

Standard endpoints probed:

- `GET /spend/logs?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` → per-model actual spend
- `GET /user/daily/activity?start_date=...&end_date=...` → daily per-model breakdown
- `GET /model/info` → per-model pricing rates

To add support for a new LiteLLM endpoint:

1. Add function `fetchXxx(config, ...)` to `gateway-litellm.ts`
2. Add a cache read/write pair to `gateway-cache.ts`
3. Add the result type to `gateway-types.ts`
4. Call it from the relevant CLI command

### Caching (`gateway-cache.ts`)

Four cache layers under `~/.cache/taco/`:

- `gateway-metrics.json` — primary endpoint, TTL from config (default 15 min)
- `gateway-model-spend.json` — `/spend/logs`, 60 min for current period, 24h for past (immutable)
- `gateway-daily-activity.json` — `/user/daily/activity`, same TTL rules
- `gateway-daily/YYYY-MM-DD.json` — permanent daily snapshots of aggregate spend

The date-range-aware caching is important: past billing periods never change, so their data is cached for 24h. Today's partial data refreshes per the configured TTL.

### Model name normalization (`model-names.ts`)

The gateway returns model names with provider prefixes (`vertex_ai/claude-opus-4-6`, `bedrock/global.anthropic.claude-opus-4-6-v1`). OpenCode stores bare names (`claude-opus-4-6`). The `normalizeModelName()` function:

1. Strips provider prefixes: `bedrock/`, `azure_ai/`, `vertex_ai/`, `global.anthropic.`, etc.
2. Strips version suffixes: `-v1:0`, `-v1`, `@20250929`, `-20260115`
3. Replaces dots with dashes: `claude-opus-4.6` → `claude-opus-4-6`
4. Strips trailing wildcards: `claude-opus-4-6*` → `claude-opus-4-6`

`aggregateModelSpend()` sums all provider variants into one canonical name entry.

### Testing gateway changes

```bash
# After making changes, build and test interactively:
pnpm run build
node dist/bin/taco.js config gateway --test   # probes all endpoints, shows results
node dist/bin/taco.js models                  # shows local + gateway cost columns
node dist/bin/taco.js daily --from 7d         # shows gateway daily section
```

### Env vars TACO reads (never modifies)

| Var                    | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token for the AI gateway (same key OpenCode uses) |
| `ANTHROPIC_BASE_URL`   | Gateway base URL (injected by OpenCode at startup)       |

Both are resolved at fetch time via `resolveEnvVar()` in `jsonpath.ts`. The config stores `"${ANTHROPIC_AUTH_TOKEN}"` as a string reference — the secret value never touches disk.

## Key Architecture Decisions

| Decision                              | Rationale                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Read OpenCode's DB directly           | Simpler than maintaining a plugin + daemon. No IPC, no background process.       |
| Gateway integration is optional       | Users without a proxy still get full local functionality.                        |
| Contract-agnostic primary endpoint    | JSONPath mappings work with any JSON shape (LiteLLM, OpenRouter, custom).        |
| LiteLLM endpoints auto-discovered     | No extra config required. TACO tries the standard paths and degrades gracefully. |
| Model name normalization is a utility | Reused by `taco models`, `taco daily`, and `taco config gateway --test`.         |
| Cache is file-based JSON              | Simple, debuggable, cross-platform. No extra services needed.                    |
| Past date ranges cached 24h           | Gateway spend for completed days is immutable — no need to re-fetch.             |
| Secrets stored as env var refs        | `"${MY_KEY}"` in config.json resolves at runtime; secret never written to disk.  |
| Binary-first install strategy         | Pre-built binaries install in ~10s vs ~60s for source builds. Checksum verified. |
| Multi-arch support (x64 + arm64)      | Supports Intel and Apple Silicon Macs, plus ARM servers.                         |
| All package managers supported        | npm, pnpm, yarn, and Bun all tested in CI/CD. Users can choose their favorite.   |

## Reporting Issues

### Bugs

Include:

- TACO version (`taco --version`)
- Node.js/Bun version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Error messages (if any)

### Feature Requests

Include:

- Use case description
- Proposed solution (if you have one)
- Alternatives considered

## Questions?

- Open an issue for questions
- Check existing issues/PRs first
- Be respectful and constructive

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to TACO! 🌮**
