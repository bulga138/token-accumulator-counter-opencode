# Migration Roadmap: TS → Node.js + JS (Hybrid Bun Architecture)

## Objective

Migrate TACO from a TypeScript architecture to a pure JavaScript (ES Module) architecture while adopting a Hybrid Runtime Strategy. The goal is to aggressively minimize external dependencies, drop native C++ compilation issues (`better-sqlite3`), and retain Bun as the primary high-performance driver (given its importance to the OpenCode plugin ecosystem).

## Motivation & Architecture Strategy

- **Why?** TACO acts as a lightweight telemetry tool. The OpenCode ecosystem naturally relies on Bun, so retaining native Bun features ensures 10x performance improvements remain intact. However, by making the fallback Node.js path fully independent and dropping bloated dependencies, TACO becomes universally installable without friction.
- **Node.js Built-in SQLite:** Node.js v22.5.0+ introduced a native `node:sqlite` module. We can drop `better-sqlite3` entirely and use `node:sqlite` as the primary fallback, with `sql.js` (WASM) acting as the final universal fallback for Node 20.
- **Zero-Build Goal:** Migrating to standard ES Modules (`.js`) means eliminating `tsc` (TypeScript) build steps. The code runs exactly as authored across both Node and Bun.
- **Dependency Minimization Strategy:**
  - `commander`: **KEEP** — essential for complex CLI argument parsing.
  - `asciichart`: **KEEP** — zero dependency and essential for visualizing token metrics.
  - `better-sqlite3`: DROP — replaced by native `node:sqlite`.
  - `chalk`: DROP — replaced with Node's `util.inspect.colors` or a tiny 50-line custom ANSI wrapper.
  - `dayjs`: DROP — replaced with native `Intl.DateTimeFormat` and standard JS Date math.

---

## Phase 1: Database Layer Hybridization

Currently, `src/data/db.ts` tries Bun > better-sqlite3 > sql.js.

- [ ] Task 1.1: Remove `better-sqlite3` from package.json `optionalDependencies` entirely to prevent install friction.
- [ ] Task 1.2: Update DB layer to adopt the new hybrid probe sequence:
  1. `bun:sqlite` (Fastest, priority if running within Bun/OpenCode context).
  2. `node:sqlite` (Fast, native to modern Node.js v22.5+).
  3. `sql.js` (Universal fallback for old Node.js).
- [ ] Task 1.3: Refactor the abstract Database driver wrapper to support `node:sqlite` API `DatabaseSync`.

## Phase 2: Dependency Pruning & Native Replacements

Reduce the `package.json` weight by dropping `chalk` and `dayjs`.

- [ ] Task 2.1: **Color Output:** Create `src/utils/colors.js` using `process.stdout.hasColors()` and standard ANSI codes, systematically removing `chalk` imports from the project.
- [ ] Task 2.2: **Date Manipulation:** Replace `dayjs` usage in `src/utils/dates.ts` and `src/format/*.ts` with `Intl.DateTimeFormat` or custom vanilla JS functions.

## Phase 3: TypeScript to ES Modules Transition

Transition to raw JS for zero-config maintainability.

- [ ] Task 3.1: Convert all `.ts` files to `.js` files.
- [ ] Task 3.2: Replace inline TypeScript interfaces with JSDoc `@typedef` blocks in `src/types/` and reference them via `/** @type {import(...)} */`.
- [ ] Task 3.3: Downgrade `typescript` to purely structural linting via `tsc --noEmit` based strictly on JSDocs.
- [ ] Task 3.4: Update `eslint.config.js` to clear TypeScript rules and only lint JavaScript.

## Phase 4: Test Suite & CI Updates

- [ ] Task 4.1: Ensure CI/CD maintains workflows testing both the "Bun path" and the "Node path".
- [ ] Task 4.2: Audit tests and optionally transition from `vitest` to Node 20's native test runner (`node:test`) to eliminate further dev dependencies.
- [ ] Task 4.3: Simplify package.json scripts to remove `build` phases, replacing them with simple entry point execution.

---

**Impact Estimate:**
By removing `chalk`, `dayjs`, and `better-sqlite3` and adopting ES Modules, TACO's external signature is minimized. Leaving Bun native capabilities preserves maximum local query speed while ensuring TACO works reliably out-of-the-box on every system natively.
