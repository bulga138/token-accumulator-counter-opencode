import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { Database } from './fixtures/create-fixture-db.js'
import { createFixtureDbAsync } from './fixtures/create-fixture-db.js'
import { loadUsageEvents, loadSessions } from '../src/data/queries.js'
import {
  computeOverview,
  computeModelStats,
  computeProviderStats,
  computeAgentStats,
  computeDailyStats,
  computeProjectStats,
  computeSessionStats,
  computeTrends,
  computeHeatmap,
} from '../src/aggregator/index.js'
import { toDateString } from '../src/utils/dates.js'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { resetPricingCache, _setConfigPathForTesting } from '../src/data/opencode-pricing.js'
import type { UsageEvent } from '../src/data/types.js'

// ─── Pricing test helpers ─────────────────────────────────────────────────────

const PRICING_TEMP_DIR = join(tmpdir(), `taco-aggregator-pricing-test-${process.pid}`)
const PRICING_TEMP_CONFIG = join(PRICING_TEMP_DIR, 'opencode.json')

function setPricingConfig(
  models: Record<
    string,
    { input: number; output: number; cache_read?: number; cache_write?: number }
  >
): void {
  mkdirSync(PRICING_TEMP_DIR, { recursive: true })
  // The pricing loader expects models[name].cost.{input,output,...}
  const wrapped: Record<string, { cost: unknown }> = {}
  for (const [name, rates] of Object.entries(models)) {
    wrapped[name] = { cost: rates }
  }
  writeFileSync(PRICING_TEMP_CONFIG, JSON.stringify({ provider: { litellm: { models: wrapped } } }))
  _setConfigPathForTesting(PRICING_TEMP_CONFIG)
}

function clearPricingConfig(): void {
  if (existsSync(PRICING_TEMP_CONFIG)) rmSync(PRICING_TEMP_CONFIG)
  // Restore to the real opencode.json path
  _setConfigPathForTesting(join(homedir(), '.config', 'opencode', 'opencode.json'))
  resetPricingCache()
}

let db: Database

beforeAll(async () => {
  db = await createFixtureDbAsync()
})

afterAll(() => {
  db.close()
})

describe('computeOverview', () => {
  it('totals all tokens and cost', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)

    expect(stats.tokens.total).toBeGreaterThan(0)
    expect(stats.cost).toBeGreaterThan(0)
    expect(stats.sessionCount).toBe(7)
    expect(stats.messageCount).toBeGreaterThan(0)
  })

  it('sets favoriteModel to the model with most messages', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    // claude-sonnet-4-6 has the most assistant messages in the fixture
    expect(stats.favoriteModel).toBe('claude-sonnet-4-6')
  })

  it('computes active days correctly', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    expect(stats.activedays).toBeGreaterThan(0)
    expect(stats.activedays).toBeLessThanOrEqual(stats.totalDays)
  })

  it('computes longestSession from session durations', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    expect(stats.longestSessionMs).toBeGreaterThan(0)
  })

  it('returns non-negative streaks', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeOverview(events, sessions)
    expect(stats.currentStreak).toBeGreaterThanOrEqual(0)
    expect(stats.longestStreak).toBeGreaterThanOrEqual(0)
  })
})

describe('computeModelStats', () => {
  it('returns one entry per unique model', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const modelIds = stats.map(s => s.modelId)
    expect(new Set(modelIds).size).toBe(modelIds.length) // no duplicates
  })

  it('sorts by total tokens descending', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1]!.tokens.total).toBeGreaterThanOrEqual(stats[i]!.tokens.total)
    }
  })

  it('percentages sum to ~1', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const total = stats.reduce((s, m) => s + m.percentage, 0)
    expect(total).toBeCloseTo(1, 2)
  })

  it('computes medianOutputTps when timestamps available', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const sonnet = stats.find(s => s.modelId === 'claude-sonnet-4-6')
    expect(sonnet).toBeDefined()
    expect(sonnet!.medianOutputTps).not.toBeNull()
    expect(sonnet!.medianOutputTps!).toBeGreaterThan(0)
  })

  it('populates daily series', () => {
    const events = loadUsageEvents(db)
    const stats = computeModelStats(events)
    const sonnet = stats.find(s => s.modelId === 'claude-sonnet-4-6')
    expect(sonnet!.dailySeries.length).toBeGreaterThan(0)
    for (const d of sonnet!.dailySeries) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.tokens).toBeGreaterThan(0)
    }
  })
})

describe('computeProviderStats', () => {
  it('groups by providerId', () => {
    const events = loadUsageEvents(db)
    const stats = computeProviderStats(events)
    const providerIds = stats.map(s => s.providerId)
    expect(providerIds).toContain('anthropic')
    expect(providerIds).toContain('openai')
  })

  it('percentages sum to ~1', () => {
    const events = loadUsageEvents(db)
    const stats = computeProviderStats(events)
    const total = stats.reduce((s, p) => s + p.percentage, 0)
    expect(total).toBeCloseTo(1, 2)
  })
})

describe('computeAgentStats', () => {
  it('identifies build, plan, and explore agents', () => {
    const events = loadUsageEvents(db)
    const stats = computeAgentStats(events)
    const agents = stats.map(s => s.agent)
    expect(agents).toContain('build')
    expect(agents).toContain('plan')
    expect(agents).toContain('explore')
  })

  it('percentages sum to ~1', () => {
    const events = loadUsageEvents(db)
    const stats = computeAgentStats(events)
    const total = stats.reduce((s, a) => s + a.percentage, 0)
    expect(total).toBeCloseTo(1, 2)
  })
})

describe('computeDailyStats', () => {
  it('groups by date in descending order', () => {
    const events = loadUsageEvents(db)
    const stats = computeDailyStats(events)
    expect(stats.length).toBeGreaterThan(0)
    // Sorted most-recent first
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1]!.date >= stats[i]!.date).toBe(true)
    }
  })

  it('dates are valid YYYY-MM-DD strings', () => {
    const events = loadUsageEvents(db)
    const stats = computeDailyStats(events)
    for (const d of stats) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('computeProjectStats', () => {
  it('groups by directory', () => {
    const events = loadUsageEvents(db)
    const stats = computeProjectStats(events)
    const dirs = stats.map(s => s.directory)
    expect(dirs).toContain('/home/user/work/api')
    expect(dirs).toContain('/home/user/work/frontend')
  })

  it('sorts by cost descending', () => {
    const events = loadUsageEvents(db)
    const stats = computeProjectStats(events)
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1]!.cost).toBeGreaterThanOrEqual(stats[i]!.cost)
    }
  })
})

describe('computeSessionStats', () => {
  it('returns one entry per unique session', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeSessionStats(events, sessions)
    const ids = stats.map(s => s.sessionId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes session title and directory', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeSessionStats(events, sessions)
    const s = stats.find(s => s.sessionId === 'ses_001')
    expect(s).toBeDefined()
    expect(s!.title).toBe('Fix auth bug')
    expect(s!.directory).toBe('/home/user/work/api')
  })

  it('computes duration from session record', () => {
    const events = loadUsageEvents(db)
    const sessions = loadSessions(db)
    const stats = computeSessionStats(events, sessions)
    for (const s of stats) {
      if (s.durationMs !== null) {
        expect(s.durationMs).toBeGreaterThan(0)
      }
    }
  })
})

describe('computeTrends', () => {
  it('returns exactly numPeriods entries', () => {
    const events = loadUsageEvents(db)
    const trends = computeTrends(events, 'week', 4)
    expect(trends).toHaveLength(4)
  })

  it('last entry has null deltaPercent', () => {
    const events = loadUsageEvents(db)
    const trends = computeTrends(events, 'week', 4)
    expect(trends[trends.length - 1]!.deltaPercent).toBeNull()
  })

  it('supports day/week/month periods', () => {
    const events = loadUsageEvents(db)
    expect(computeTrends(events, 'day', 3)).toHaveLength(3)
    expect(computeTrends(events, 'month', 2)).toHaveLength(2)
  })
})

// ─── Cost estimation via opencode.json pricing ────────────────────────────────

describe('computeModelStats — cost estimation', () => {
  // Use a model name whose normalised form matches what we put in the pricing file
  const MODEL_ID = 'azure/gpt-5.2-codex' // normalises to gpt-5-2-codex
  const RATES = { input: 0.00000175, output: 0.000014 }

  const baseEvent: UsageEvent = {
    messageId: 'msg_est_001',
    sessionId: 'ses_est',
    sessionTitle: null,
    sessionDirectory: null,
    sessionParentId: null,
    projectId: null,
    timeCreated: Date.now() - 1000,
    timeCompleted: Date.now(),
    modelId: MODEL_ID,
    providerId: 'litellm',
    agent: 'build',
    tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1200 },
    cost: 0,
    finish: 'stop',
  }

  afterEach(() => {
    clearPricingConfig()
  })

  it('leaves cost unchanged when DB already recorded a non-zero cost', () => {
    // Even with pricing available, a non-zero DB cost must not be touched.
    setPricingConfig({ [MODEL_ID]: RATES })

    const event: UsageEvent = { ...baseEvent, cost: 0.42 }
    const stats = computeModelStats([event])
    const model = stats[0]!
    expect(model.cost).toBe(0.42)
    expect(model.costEstimated).toBeFalsy()
    expect(model.billedExternally).toBe(false)
  })

  it('estimates cost when DB cost is 0 and pricing is available', () => {
    setPricingConfig({ [MODEL_ID]: RATES })

    const stats = computeModelStats([baseEvent])
    const model = stats.find(s => s.modelId === MODEL_ID)!
    expect(model).toBeDefined()
    // 1000 * 0.00000175 + 200 * 0.000014 = 0.00175 + 0.0028 = 0.00455
    expect(model.cost).toBeCloseTo(0.00455, 5)
    expect(model.costEstimated).toBe(true)
    expect(model.billedExternally).toBe(false)
  })

  it('leaves billedExternally=true when cost is 0 and no pricing entry exists', () => {
    // Empty config — no pricing for the model
    setPricingConfig({})
    // But the file must actually exist and parse with at least one valid model
    // for the pricing map to be non-null. To simulate "map exists but no match",
    // we add a different model's pricing.
    setPricingConfig({ 'anthropic.claude-sonnet-4-6': { input: 0.000003, output: 0.000015 } })

    const event: UsageEvent = { ...baseEvent, modelId: 'unknown-model-xyz' }
    const stats = computeModelStats([event])
    const model = stats.find(s => s.modelId === 'unknown-model-xyz')!
    expect(model.cost).toBe(0)
    expect(model.billedExternally).toBe(true)
    expect(model.costEstimated).toBeFalsy()
  })

  it('does not estimate when all events have cost: 0 and tokens.total: 0', () => {
    // Pricing is available but estimation guard (total > 0) prevents it
    setPricingConfig({ [MODEL_ID]: RATES })

    const event: UsageEvent = {
      ...baseEvent,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
      cost: 0,
    }
    const stats = computeModelStats([event])
    const model = stats[0]!
    expect(model.cost).toBe(0)
    expect(model.costEstimated).toBeFalsy()
  })

  it('handles cache tokens in cost estimation', () => {
    setPricingConfig({
      [MODEL_ID]: { ...RATES, cache_read: 1.75e-7, cache_write: 0 },
    })

    const event: UsageEvent = {
      ...baseEvent,
      tokens: {
        input: 1000,
        output: 200,
        cacheRead: 4000,
        cacheWrite: 0,
        reasoning: 0,
        total: 5200,
      },
      cost: 0,
    }
    const stats = computeModelStats([event])
    const model = stats[0]!
    // 1000*0.00000175 + 200*0.000014 + 4000*1.75e-7
    // = 0.00175 + 0.0028 + 0.0007 = 0.00525
    expect(model.cost).toBeCloseTo(0.00525, 5)
    expect(model.costEstimated).toBe(true)
  })
})

describe('computeHeatmap', () => {
  it('returns exactly 365 days', () => {
    const events = loadUsageEvents(db)
    const heatmap = computeHeatmap(events)
    expect(heatmap).toHaveLength(365)
  })

  it('intensity is 0–4', () => {
    const events = loadUsageEvents(db)
    const heatmap = computeHeatmap(events)
    for (const d of heatmap) {
      expect(d.intensity).toBeGreaterThanOrEqual(0)
      expect(d.intensity).toBeLessThanOrEqual(4)
    }
  })

  it('active days have intensity > 0', () => {
    const events = loadUsageEvents(db)
    const heatmap = computeHeatmap(events)
    const activeDates = new Set(events.map(e => toDateString(e.timeCreated)))
    for (const d of heatmap) {
      if (activeDates.has(d.date)) {
        expect(d.intensity).toBeGreaterThan(0)
      }
    }
  })
})
