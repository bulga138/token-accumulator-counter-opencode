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
  formatOverviewCsv,
  formatModelsCsv,
  formatProvidersCsv,
  formatAgentsCsv,
  formatDailyCsv,
  formatSessionsCsv,
  formatTrendsCsv,
} from '../src/format/csv.js'
import { emptyTokenSummary } from '../src/data/types.js'

let db: Database

beforeAll(async () => {
  db = await createFixtureDbAsync()
})

afterAll(() => {
  db.close()
})

// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse CSV string into array of row objects (keyed by header). */
function parseCsv(s: string): Record<string, string>[] {
  const lines = s.trim().split('\n')
  if (lines.length === 0) return []
  const headers = lines[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
}

// ── formatOverviewCsv ─────────────────────────────────────────────────────────

describe('formatOverviewCsv', () => {
  it('produces valid CSV with correct headers', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    const csv = formatOverviewCsv(stats)
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveProperty('tokens_total')
    expect(rows[0]).toHaveProperty('cost_usd')
    expect(rows[0]).toHaveProperty('session_count')
    expect(rows[0]).toHaveProperty('message_count')
  })

  it('contains numeric token values', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    const rows = parseCsv(formatOverviewCsv(stats))
    expect(Number(rows[0]!.tokens_total)).toBeGreaterThan(0)
  })
})

// ── formatModelsCsv ───────────────────────────────────────────────────────────

describe('formatModelsCsv', () => {
  it('has correct headers', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const rows = parseCsv(formatModelsCsv(stats))
    expect(rows[0]).toHaveProperty('model_id')
    expect(rows[0]).toHaveProperty('tokens_total')
    expect(rows[0]).toHaveProperty('cost_usd')
  })

  it('includes all models', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const rows = parseCsv(formatModelsCsv(stats))
    const ids = rows.map(r => r.model_id)
    expect(ids).toContain('claude-sonnet-4-6')
    expect(ids).toContain('gpt-4o')
  })

  it('returns empty CSV for empty input', () => {
    const csv = formatModelsCsv([])
    // csv-stringify with empty data produces empty string
    expect(csv.trim()).toBe('')
  })
})

// ── formatProvidersCsv ────────────────────────────────────────────────────────

describe('formatProvidersCsv', () => {
  it('has provider_id column', () => {
    const events = loadUsageEvents(db)
    const stats = computeProviderStats(events)
    const rows = parseCsv(formatProvidersCsv(stats))
    expect(rows[0]).toHaveProperty('provider_id')
  })

  it('includes all providers', () => {
    const events = loadUsageEvents(db)
    const stats = computeProviderStats(events)
    const rows = parseCsv(formatProvidersCsv(stats))
    const ids = rows.map(r => r.provider_id)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('openai')
  })
})

// ── formatAgentsCsv ───────────────────────────────────────────────────────────

describe('formatAgentsCsv', () => {
  it('has agent column', () => {
    const events = loadUsageEvents(db)
    const stats = computeAgentStats(events)
    const rows = parseCsv(formatAgentsCsv(stats))
    expect(rows[0]).toHaveProperty('agent')
  })

  it('includes build agent', () => {
    const events = loadUsageEvents(db)
    const stats = computeAgentStats(events)
    const rows = parseCsv(formatAgentsCsv(stats))
    expect(rows.map(r => r.agent)).toContain('build')
  })
})

// ── formatDailyCsv ────────────────────────────────────────────────────────────

describe('formatDailyCsv', () => {
  it('has date and cost_usd columns', () => {
    const events = loadUsageEvents(db)
    const stats = computeDailyStats(events)
    const rows = parseCsv(formatDailyCsv(stats))
    expect(rows[0]).toHaveProperty('date')
    expect(rows[0]).toHaveProperty('cost_usd')
  })

  it('dates are in YYYY-MM-DD format', () => {
    const events = loadUsageEvents(db)
    const stats = computeDailyStats(events)
    const rows = parseCsv(formatDailyCsv(stats))
    for (const row of rows) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

// ── formatSessionsCsv ─────────────────────────────────────────────────────────

describe('formatSessionsCsv', () => {
  it('has session_id and title columns', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeSessionStats(events, sessions)
    const rows = parseCsv(formatSessionsCsv(stats))
    expect(rows[0]).toHaveProperty('session_id')
    expect(rows[0]).toHaveProperty('title')
  })

  it('includes session titles', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeSessionStats(events, sessions)
    const rows = parseCsv(formatSessionsCsv(stats))
    const titles = rows.map(r => r.title)
    expect(titles.join(',')).toContain('Fix auth bug')
  })
})

// ── formatTrendsCsv ───────────────────────────────────────────────────────────

describe('formatTrendsCsv', () => {
  it('has label and tokens_total columns', () => {
    const events = loadUsageEvents(db)
    const stats = computeTrends(events, 'week', 4)
    const rows = parseCsv(formatTrendsCsv(stats))
    expect(rows[0]).toHaveProperty('label')
    expect(rows[0]).toHaveProperty('tokens_total')
  })

  it('returns 4 rows for numPeriods=4', () => {
    const events = loadUsageEvents(db)
    const stats = computeTrends(events, 'week', 4)
    const rows = parseCsv(formatTrendsCsv(stats))
    expect(rows).toHaveLength(4)
  })
})
