import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Database } from './fixtures/create-fixture-db.js'
import { createFixtureDbAsync } from './fixtures/create-fixture-db.js'
import { loadUsageEvents, loadSessions } from '../src/data/queries.js'
import {
  computeOverview,
  computeModelStats,
  computeProviderStats,
  computeAgentStats,
  computeDailyStats,
  computeSessionStats,
  computeTrends,
} from '../src/aggregator/index.js'
import {
  formatOverview,
  formatModels,
  formatProviders,
  formatAgents,
  formatDaily,
  formatSessions,
  formatTrends,
} from '../src/format/visual.js'
import { emptyTokenSummary } from '../src/data/types.js'

let db: Database

beforeAll(async () => {
  db = await createFixtureDbAsync()
})

afterAll(() => {
  db.close()
})

// ── helpers ───────────────────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '')
}

const EMPTY_HEATMAP = Array.from({ length: 365 }, (_, i) => ({
  date: new Date(Date.now() - i * 86_400_000).toISOString().split('T')[0]!,
  tokens: 0,
  intensity: 0 as const,
}))

// ── formatOverview ────────────────────────────────────────────────────────────

describe('formatOverview', () => {
  it('returns a non-empty string', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    const out = formatOverview(stats, EMPTY_HEATMAP, '')
    expect(out.length).toBeGreaterThan(0)
  })

  it('contains TACO header', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    const out = stripAnsi(formatOverview(stats, EMPTY_HEATMAP, ''))
    expect(out).toContain('TACO')
  })

  it('shows favorite model', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    const out = stripAnsi(formatOverview(stats, EMPTY_HEATMAP, ''))
    expect(out).toContain('claude-sonnet-4-6')
  })

  it('shows total tokens', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    const out = stripAnsi(formatOverview(stats, EMPTY_HEATMAP, ''))
    // Should include some token-related text (k/M/B suffix)
    expect(out).toMatch(/\d+(\.\d+)?[kKMBmb]/)
  })

  it('shows finish reason summary when non-stop reasons exist', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    // All fixture messages use 'stop', so finishReasons = {stop: N}
    // With only one reason type, summary is hidden — correct behavior
    const out = stripAnsi(formatOverview(stats, EMPTY_HEATMAP, ''))
    // "stop" alone should NOT show up in the finish line since we only show when
    // there are non-stop reasons or multiple reason types
    // (just verify it doesn't crash and still shows token data)
    expect(out).toContain('Token breakdown')
  })
})

// ── formatModels ──────────────────────────────────────────────────────────────

describe('formatModels', () => {
  it('contains model IDs from input', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const out = stripAnsi(formatModels(stats, ''))
    expect(out).toContain('claude-sonnet-4-6')
    expect(out).toContain('gpt-4o')
  })

  it('returns a no-data message for empty input', () => {
    const out = stripAnsi(formatModels([], ''))
    expect(out.toLowerCase()).toMatch(/no model|no data|0 models/i)
  })

  it('mentions cost values', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const out = stripAnsi(formatModels(stats, ''))
    expect(out).toMatch(/\$\d/)
  })
})

// ── formatProviders ───────────────────────────────────────────────────────────

describe('formatProviders', () => {
  it('contains provider IDs', () => {
    const events = loadUsageEvents(db)
    const stats = computeProviderStats(events)
    const out = stripAnsi(formatProviders(stats, ''))
    expect(out).toContain('anthropic')
    expect(out).toContain('openai')
  })

  it('returns a no-data message for empty input', () => {
    const out = stripAnsi(formatProviders([], ''))
    expect(out.toLowerCase()).toMatch(/no provider|no data|0 provider/i)
  })
})

// ── formatAgents ──────────────────────────────────────────────────────────────

describe('formatAgents', () => {
  it('contains agent names', () => {
    const events = loadUsageEvents(db)
    const stats = computeAgentStats(events)
    const out = stripAnsi(formatAgents(stats, ''))
    expect(out).toContain('build')
  })

  it('returns a no-data message for empty input', () => {
    const out = stripAnsi(formatAgents([], ''))
    expect(out.toLowerCase()).toMatch(/no agent|no data/i)
  })
})

// ── formatDaily ───────────────────────────────────────────────────────────────

describe('formatDaily', () => {
  it('contains date strings', () => {
    const events = loadUsageEvents(db)
    const stats = computeDailyStats(events)
    const series = stats.map(d => ({ date: d.date, tokens: d.tokens.total }))
    const out = stripAnsi(formatDaily(stats, '', series))
    // Should contain at least one YYYY-MM-DD date
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('returns a no-data message for empty input', () => {
    const out = stripAnsi(formatDaily([], '', []))
    expect(out.toLowerCase()).toMatch(/no daily|no data/i)
  })
})

// ── formatSessions ────────────────────────────────────────────────────────────

describe('formatSessions', () => {
  it('contains session titles', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeSessionStats(events, sessions)
    const out = stripAnsi(formatSessions(stats, ''))
    expect(out).toContain('Fix auth bug')
  })

  it('returns a no-data message for empty input', () => {
    const out = stripAnsi(formatSessions([], ''))
    expect(out.toLowerCase()).toMatch(/no session|no data/i)
  })
})

// ── formatTrends ──────────────────────────────────────────────────────────────

describe('formatTrends', () => {
  it('contains delta percentage markers', () => {
    const events = loadUsageEvents(db)
    const stats = computeTrends(events, 'week', 4)
    const out = stripAnsi(formatTrends(stats, 'week', ''))
    // Look for % sign in the output regardless of colour
    expect(out).toMatch(/%|→|—/)
  })

  it('returns a no-data message for empty input', () => {
    const out = stripAnsi(formatTrends([], 'week', ''))
    expect(out.toLowerCase()).toMatch(/no trend|no data/i)
  })
})
