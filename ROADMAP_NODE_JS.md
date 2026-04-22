# Migration Roadmap: Bun + TS → Node.js + JS

## Objective

Migrate TACO from a Bun + TypeScript architecture to a pure Node.js + Vanilla JavaScript (ES Module) architecture. The goal is to aggressively minimize external dependencies, eliminate the proprietary Bun runtime, and maintain a tiny footprint with exceptional performance.

## Motivation & Architecture Strategy

- **Why?** TACO acts as a lightweight telemetry tool. Relying on an entire separate JS runtime (Bun) or native C++ add-ons (`better-sqlite3`) bloats the application for users. Moving to raw Node.js + JS ensures TACO works seamlessly where `npm` works.
- **Node.js Built-in SQLite:** Node.js v22.5.0+ introduced a native `node:sqlite` module. Older supported Node.js versions (v20+) can fall back to the existing `sql.js` WASM implementation or we can gracefully degrade.
- **Zero-Build Goal:** Migrating to ES Modules (`.js`) means eliminating `tsc` (TypeScript) and `bun build`. The code runs exactly as it's authored.
- **Dependency Minimization:**
  - `commander` → Replace with Node's native `util.parseArgs()`.
  - `better-sqlite3` and `bun:sqlite` → Replace with Node's `node:sqlite` (for fast performance on recent Node versions) and fallback to `sql.js` for universal compatibility.
  - `chalk` → Replace with Node's native `util.inspect.colors` or a tiny custom ANSI formatter to reduce node_modules size.
  - `dayjs` → Replace with native `Intl.DateTimeFormat` or vanilla JS Date operations.
  - `asciichart` → Retain (it's a very small zero-dependency library crucial for visual output).

---

## Phase 1: Database Layer Modernization (Driver Migration)

Currently, `src/data/db.ts` acts as a multi-driver orchestrator trying Bun > better-sqlite3 > sql.js.

- [ ] Task 1.1: Remove `bun-types` and any Bun-specific `import('bun:sqlite')` logic from `src/data/db.ts`.
- [ ] Task 1.2: Remove `better-sqlite3` from package.json `optionalDependencies` to eliminate native compilation issues on installation.
- [ ] Task 1.3: Update DB layer to probe for `node:sqlite` API (for Node v22.5.0+):
  ```javascript
  try {
    const { DatabaseSync } = await import('node:sqlite')
    return { type: 'node:sqlite', module: DatabaseSync }
  } catch {
    // fallback to sql.js
  }
  ```
- [ ] Task 1.4: Maintain the WASM `sql.js` fallback handler for Node 20.x users without `node:sqlite`.

## Phase 2: Dependency Pruning & Native Replacements

Reduce the `package.json` weight by utilizing Node 20+ standard library APIs.

- [ ] Task 2.1: **CLI Args:** Refactor `src/cli/**/*.ts` files to use `util.parseArgs` instead of `commander`.
- [ ] Task 2.2: **Color Output:** Create `src/utils/colors.js` using `process.stdout.hasColors()` and standard ANSI codes, entirely removing `chalk`.
- [ ] Task 2.3: **Date Manipulation:** Replace `dayjs` usage in `src/utils/dates.ts` and `src/format/*.ts` with `Intl.DateTimeFormat` and vanilla JS Date logic.

## Phase 4: TypeScript to ES Modules Transition

Since we are aiming for minimal footprint and build complexity, move from TS to raw JS with JSDoc typing.

- [ ] Task 4.1: Convert all `.ts` files to `.js` files. Update local imports from `.js` (they currently are) but remove type annotations.
- [ ] Task 4.2: Replace inline TypeScript interfaces with JSDoc `@typedef` blocks in `src/types/` and reference them using `/** @type {import(...)} */`.
- [ ] Task 4.3: Retain `typescript` solely as a devDependency to run `tsc --noEmit` as a linter checking JSDoc validity.
- [ ] Task 4.4: Update `eslint.config.js` to only lint JavaScript.

## Phase 5: Build System & Binary Output Automation

Moving away from `bun build --compile` requires a new approach to executable creation if we want to retain standalone binaries.

- [ ] Task 5.1: Explore relying purely on the `npm` global installation path (meaning the "binary" is just the Node.js script executed via `#!/usr/bin/env node`). This is the smallest option.
- [ ] Task 5.2 (Alternative): If standalone binaries are strictly required, update `ci-cd.yml` to use Node's Single Executable Applications (SEA) feature (`node --experimental-sea`) or `esbuild` to compress into a single `.js` file, avoiding external binary packagers.
- [ ] Task 5.3: Remove Bun and `actions/setup-bun` from `.github/workflows/ci-cd.yml` & install scripts.

## Phase 6: Code Quality & Test Updates

- [ ] Task 6.1: Transition from `vitest` (which adds significant dev dependencies) to Node 20's native test runner (`node:test` and `node:assert`).
- [ ] Task 6.2: Ensure all tests execute strictly in Node via `npm test -> node --test tests/**/*.test.js`.
- [ ] Task 6.3: Clean up `package.json` to only contain development scripts, eliminating redundant build directives.

---

**File Size Impact Estimate:**
By removing `commander`, `chalk`, `dayjs`, and `better-sqlite3`, we drop down to essentially _zero_ runtime dependencies other than `sql.js` (which is small) and `asciichart`. The entire application will exist as a heavily optimized raw JS utility heavily leveraging the native platform.
