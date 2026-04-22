# TACO Proactive Features TODO

## Overview

TACO is currently **reactive** - reads from OpenCode's SQLite database to show what has already happened. This TODO outlines adding **proactive** features that analyze data _before_ OpenCode executes queries.

**Constraints:**

- Zero new runtime dependencies
- Memory-efficient (streaming, SQLite-native aggregations)
- Privacy-first with user consent
- Offline-first with optional network mode

---

## Phase 1: Reactive Architecture Enhancements

These features fit naturally into the existing data pipeline by expanding SQLite queries and gateway fetches.

### 1.1 Granular Category Breakdown

**Priority:** High
**Complexity:** Low

**Description:** Add breakdowns for Tool Calls, Cache, System Prompts, etc. to existing commands.

**Implementation:**

- [ ] Update `src/data/queries.ts` to parse event JSON for context breakdowns
- [ ] Add SQLite-native aggregations (e.g., `SUM(json_extract(payload, '$.tool_tokens'))`)
- [ ] Pass breakdown data to `taco today` and `taco daily` formatters
- [ ] Update all formatters in `src/format/` (visual, json, csv, markdown)

**Files to modify:**

- `src/data/queries.ts`
- `src/format/*.ts`

---

### 1.2 Budgeting & Threshold Alerts

**Priority:** High
**Complexity:** Low

**Description:** Add warnings when spend approaches budget limits.

**Implementation:**

- [ ] Add threshold calculation in `src/cli/commands/overview.ts`
- [ ] Add threshold calculation in `src/cli/commands/today.ts`
- [ ] Use `chalk.red.bold` for warnings when `totalSpend > 90%` of `budgetLimit`
- [ ] Add to TUI Overview tab

**Files to modify:**

- `src/cli/commands/overview.ts`
- `src/cli/commands/today.ts`
- `src/cli/commands/tui.ts`

---

## Phase 2: Proactive Module - New Command Group

Create a new isolated command group for preflight checks and file analysis.

### 2.1 Configuration Schema Updates

**Priority:** High
**Complexity:** Low

**Description:** Add counting preferences to config schema.

**Implementation:**

- [ ] Add `CountingConfig` interface to `src/config/index.ts`:
  ```typescript
  export interface CountingConfig {
    mode: 'exact' | 'heuristic'
    exactCountConsent: boolean | null // null = never asked
  }
  ```
- [ ] Update default config generation
- [ ] Add config validation

**Files to modify:**

- `src/config/index.ts`

---

### 2.2 Provider-API Delegation (Preflight Counting)

**Priority:** High
**Complexity:** Medium

**Description:** Use gateway API for exact token counts via `taco count <file-or-string>`.

**Implementation:**

- [ ] Create `src/data/gateway-tokenize.ts`
- [ ] Implement `fetchTokenCount()` using native `fetch()`
- [ ] Create `src/cli/commands/count.ts` command
- [ ] Add CLI flags: `--exact`, `--offline`
- [ ] Implement two-path logic (heuristic vs exact)
- [ ] Add to `bin/taco.ts` command registration

**Files to create:**

- `src/data/gateway-tokenize.ts`
- `src/cli/commands/count.ts`

**Files to modify:**

- `bin/taco.ts`

---

### 2.3 Codebase & Directory Analysis

**Priority:** Medium
**Complexity:** Medium

**Description:** Scan local files and estimate token sizes using heuristic math.

**Implementation:**

- [ ] Create `src/cli/commands/analyze.ts`
- [ ] Use `fs.promises` to iterate directories (skip binaries)
- [ ] Implement Heuristic Fast-Mode: `Math.ceil(text.length / 4)` or `words / 0.75`
- [ ] Calculate total estimated tokens
- [ ] Compare against known context windows (e.g., Claude 3.5's 200k)
- [ ] Output percentage used
- [ ] Add to `bin/taco.ts` command registration

**Files to create:**

- `src/cli/commands/analyze.ts`

**Files to modify:**

- `bin/taco.ts`

---

### 2.4 Preflight Multimodal Checks

**Priority:** Medium
**Complexity:** Low

**Description:** Estimate tokens for images/audio using provider formulas.

**Implementation:**

- [ ] Extend `src/cli/commands/count.ts` to handle images
- [ ] Use `fs.statSync` to check resolution/filesize
- [ ] Apply provider token formulas (e.g., OpenAI 512x512 tile system)
- [ ] Add support for common image formats (PNG, JPG, WebP)

**Files to modify:**

- `src/cli/commands/count.ts`

---

### 2.5 Privacy Consent Flow

**Priority:** High
**Complexity:** Low

**Description:** Implement "Ask Once, Store in Config" pattern for network consent.

**Implementation:**

- [ ] Create `src/utils/consent.ts` utility
- [ ] Implement native `readline` prompt for Y/N confirmation
- [ ] Add consent check in `src/cli/commands/count.ts`
- [ ] Store consent in config after first prompt
- [ ] Add config toggle commands:
  - `taco config counting --revoke-consent`
  - `taco config counting --grant-consent`

**Files to create:**

- `src/utils/consent.ts`

**Files to modify:**

- `src/cli/commands/count.ts`
- `src/cli/commands/config-cmd.ts`

---

## Phase 3: Documentation & Testing

### 3.1 Documentation Updates

**Priority:** Medium
**Complexity:** Low

**Implementation:**

- [ ] Update `README.md` with new commands
- [ ] Document `taco count` usage and flags
- [ ] Document `taco analyze` usage
- [ ] Add privacy consent section
- [ ] Update `CONTEXT.md` with new architecture

**Files to modify:**

- `README.md`
- `CONTEXT.md`

---

### 3.2 Testing

**Priority:** High
**Complexity:** Medium

**Implementation:**

- [ ] Add unit tests for `src/data/gateway-tokenize.ts`
- [ ] Add unit tests for `src/utils/consent.ts`
- [ ] Add integration tests for `taco count` command
- [ ] Add integration tests for `taco analyze` command
- [ ] Test offline/heuristic mode
- [ ] Test exact/network mode with mock gateway
- [ ] Test consent flow

**Files to create:**

- `tests/gateway-tokenize.test.ts`
- `tests/consent.test.ts`
- `tests/count.test.ts`
- `tests/analyze.test.ts`

---

## Phase 4: Polish & Optimization

### 4.1 Performance Optimization

**Priority:** Medium
**Complexity:** Medium

**Implementation:**

- [ ] Ensure directory analysis uses streaming (not loading all files)
- [ ] Add progress indicators for large codebases
- [ ] Cache analysis results
- [ ] Optimize heuristic calculations

---

### 4.2 Error Handling

**Priority:** High
**Complexity:** Low

**Implementation:**

- [ ] Graceful fallback when gateway is offline
- [ ] Clear error messages for file access issues
- [ ] Handle binary files gracefully
- [ ] Sanitize error messages (remove sensitive data)

---

## Implementation Order

1. **Phase 1** (Reactive enhancements) - Quick wins, low risk
2. **Phase 2.1** (Config schema) - Foundation for proactive features
3. **Phase 2.2** (Preflight counting) - Core proactive feature
4. **Phase 2.5** (Privacy consent) - Critical for network mode
5. **Phase 2.3** (Codebase analysis) - Extends counting to directories
6. **Phase 2.4** (Multimodal) - Nice-to-have extension
7. **Phase 3** (Documentation & Testing) - Ensure quality
8. **Phase 4** (Polish) - Final touches

---

## Success Criteria

- [ ] All new commands work without gateway config (offline mode)
- [ ] Exact mode requires explicit user consent
- [ ] Memory constraints respected (streaming, no loading all data)
- [ ] Zero new runtime dependencies
- [ ] All formatters updated (visual, json, csv, markdown)
- [ ] All tests pass
- [ ] Documentation complete
- [ ] Typecheck and lint pass

---

## Open Questions

1. **Heuristic Accuracy:** Should we use `characters / 4` or `words / 0.75` as the default heuristic? (Recommend: configurable)

2. **Context Window Database:** Should we maintain a hardcoded list of context windows for common models, or fetch from gateway? (Recommend: hardcoded fallback, gateway override)

3. **Binary Detection:** How should we detect binary files during directory analysis? (Recommend: file extension whitelist + magic number detection)

4. **Cache Strategy:** Where should we cache analysis results? (Recommend: `~/.cache/taco/analysis/` with TTL)

---

## Estimated Timeline

- **Phase 1:** 1-2 days
- **Phase 2:** 3-5 days
- **Phase 3:** 2-3 days
- **Phase 4:** 1-2 days

**Total:** 7-12 days

---

## Notes

- All new features must respect the existing memory constraints
- Use SQLite-native aggregations where possible
- Streaming > loading all data
- Gateway integration is optional but must not crash
- Privacy is paramount - network calls require explicit consent
- Offline-first design with optional network enhancement
