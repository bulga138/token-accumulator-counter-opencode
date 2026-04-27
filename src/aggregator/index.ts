import dayjs from 'dayjs'
import type {
  UsageEvent,
  SessionRecord,
  OverviewStats,
  ModelStats,
  ProviderStats,
  AgentStats,
  DailyStats,
  ProjectStats,
  SessionStats,
  PeriodStats,
  DailySeries,
  TokenSummary,
  TrendPeriod,
} from '../data/types.js'
import { emptyTokenSummary, addTokens } from '../data/types.js'
import { toDateString } from '../utils/dates.js'
import { loadOpenCodePricing, estimateCostFromPricing } from '../data/opencode-pricing.js'
import { normalizeModelName } from '../utils/model-names.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? (sorted[mid] ?? null) : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function bumpFinish(map: Record<string, number>, finish: string | null): void {
  const key = finish ?? 'unknown'
  map[key] = (map[key] ?? 0) + 1
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export function computeOverview(events: UsageEvent[], sessions: SessionRecord[]): OverviewStats {
  const tokens = emptyTokenSummary()
  let cost = 0
  const modelSet = new Set<string>()
  const modelCounts: Record<string, number> = {}
  const activeDaySet = new Set<string>()
  const finishReasons: Record<string, number> = {}

  for (const e of events) {
    const t = addTokens(tokens, e.tokens)
    tokens.input = t.input
    tokens.output = t.output
    tokens.cacheRead = t.cacheRead
    tokens.cacheWrite = t.cacheWrite
    tokens.reasoning = t.reasoning
    tokens.total = t.total

    cost += e.cost
    modelSet.add(e.modelId)
    modelCounts[e.modelId] = (modelCounts[e.modelId] ?? 0) + 1
    activeDaySet.add(toDateString(e.timeCreated))
    bumpFinish(finishReasons, e.finish)
  }

  // Favorite model = most messages
  let favoriteModel: string | null = null
  let maxCount = 0
  for (const [model, count] of Object.entries(modelCounts)) {
    if (count > maxCount) {
      maxCount = count
      favoriteModel = model
    }
  }

  // Streaks
  const sortedDays = Array.from(activeDaySet).sort()
  const { currentStreak, longestStreak } = computeStreaks(sortedDays)

  // Most active day = day with most messages
  const dayMessages: Record<string, number> = {}
  for (const e of events) {
    const d = toDateString(e.timeCreated)
    dayMessages[d] = (dayMessages[d] ?? 0) + 1
  }
  let mostActiveDay: string | null = null
  let maxMessages = 0
  for (const [day, count] of Object.entries(dayMessages)) {
    if (count > maxMessages) {
      maxMessages = count
      mostActiveDay = day
    }
  }

  // Longest session
  let longestSessionMs = 0
  for (const s of sessions) {
    const dur = s.timeUpdated - s.timeCreated
    if (dur > longestSessionMs) longestSessionMs = dur
  }

  // Total days spanned
  let totalDays = 1
  if (sortedDays.length >= 2) {
    const first = dayjs(sortedDays[0])
    const last = dayjs(sortedDays[sortedDays.length - 1])
    totalDays = last.diff(first, 'day') + 1
  }

  const avgCostPerDay = activeDaySet.size > 0 ? cost / activeDaySet.size : 0

  return {
    tokens,
    cost,
    sessionCount: sessions.length,
    messageCount: events.length,
    activedays: activeDaySet.size,
    totalDays,
    modelsUsed: Array.from(modelSet),
    favoriteModel,
    currentStreak,
    longestStreak,
    mostActiveDay,
    longestSessionMs,
    avgCostPerDay,
    finishReasons,
  }
}

export function computeStreaks(sortedDays: string[]): {
  currentStreak: number
  longestStreak: number
} {
  if (sortedDays.length === 0) return { currentStreak: 0, longestStreak: 0 }

  let longest = 1
  let current = 1

  for (let i = 1; i < sortedDays.length; i++) {
    const prev = dayjs(sortedDays[i - 1])
    const curr = dayjs(sortedDays[i])
    if (curr.diff(prev, 'day') === 1) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }

  // Current streak: check if it ends today or yesterday
  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  const lastDay = sortedDays[sortedDays.length - 1]

  let currentStreak = 0
  if (lastDay === today || lastDay === yesterday) {
    currentStreak = 1
    for (let i = sortedDays.length - 2; i >= 0; i--) {
      const prev = dayjs(sortedDays[i + 1])
      const curr = dayjs(sortedDays[i])
      if (prev.diff(curr, 'day') === 1) {
        currentStreak++
      } else {
        break
      }
    }
  }

  return { currentStreak, longestStreak: longest }
}

// ─── Model stats ──────────────────────────────────────────────────────────────

export function computeModelStats(events: UsageEvent[]): ModelStats[] {
  const map = new Map<
    string,
    {
      modelId: string
      providerId: string
      tokens: TokenSummary
      cost: number
      hasCost: boolean
      messageCount: number
      sessions: Set<string>
      activeDays: Set<string>
      tpsSamples: number[]
      dailyTokens: Map<string, number>
      finishReasons: Record<string, number>
    }
  >()

  for (const e of events) {
    const key = `${e.modelId}|||${e.providerId}`
    if (!map.has(key)) {
      map.set(key, {
        modelId: e.modelId,
        providerId: e.providerId,
        tokens: emptyTokenSummary(),
        cost: 0,
        hasCost: false,
        messageCount: 0,
        sessions: new Set(),
        activeDays: new Set(),
        tpsSamples: [],
        dailyTokens: new Map(),
        finishReasons: {},
      })
    }
    const s = map.get(key)!
    s.tokens = addTokens(s.tokens, e.tokens)
    s.cost += e.cost
    if (e.cost > 0) s.hasCost = true
    s.messageCount++
    s.sessions.add(e.sessionId)
    s.activeDays.add(toDateString(e.timeCreated))
    bumpFinish(s.finishReasons, e.finish)

    if (e.timeCompleted && e.timeCreated && e.tokens.output > 0) {
      const durationSec = (e.timeCompleted - e.timeCreated) / 1000
      if (durationSec > 0) {
        s.tpsSamples.push(e.tokens.output / durationSec)
      }
    }

    const day = toDateString(e.timeCreated)
    s.dailyTokens.set(day, (s.dailyTokens.get(day) ?? 0) + e.tokens.total)
  }

  const totalTokens = Array.from(map.values()).reduce((sum, v) => sum + v.tokens.total, 0)

  // Load pricing table once for all models (null if opencode.json not found)
  const pricing = loadOpenCodePricing()

  const result: ModelStats[] = []
  for (const v of map.values()) {
    const dailySeries: DailySeries[] = Array.from(v.dailyTokens.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tokens]) => ({ date, tokens }))

    let cost = v.cost
    let billedExternally = !v.hasCost
    let costEstimated: boolean | undefined

    // If OpenCode wrote cost: 0 for every event, attempt local estimation from
    // the pricing table embedded in opencode.json. DB cost always wins when > 0.
    if (!v.hasCost && pricing && v.tokens.total > 0) {
      const rates = pricing.get(normalizeModelName(v.modelId))
      if (rates) {
        cost = estimateCostFromPricing(v.tokens, rates)
        billedExternally = false
        costEstimated = true
      }
    }

    result.push({
      modelId: v.modelId,
      providerId: v.providerId,
      tokens: v.tokens,
      cost,
      billedExternally,
      costEstimated,
      messageCount: v.messageCount,
      sessionCount: v.sessions.size,
      activeDays: v.activeDays.size,
      percentage: totalTokens > 0 ? v.tokens.total / totalTokens : 0,
      medianOutputTps: median(v.tpsSamples),
      dailySeries,
      finishReasons: v.finishReasons,
    })
  }

  return result.sort((a, b) => b.tokens.total - a.tokens.total)
}

// ─── Provider stats ───────────────────────────────────────────────────────────

export function computeProviderStats(events: UsageEvent[]): ProviderStats[] {
  const map = new Map<
    string,
    {
      tokens: TokenSummary
      cost: number
      messageCount: number
      sessions: Set<string>
      activeDays: Set<string>
    }
  >()

  for (const e of events) {
    const key = e.providerId
    if (!map.has(key)) {
      map.set(key, {
        tokens: emptyTokenSummary(),
        cost: 0,
        messageCount: 0,
        sessions: new Set(),
        activeDays: new Set(),
      })
    }
    const s = map.get(key)!
    s.tokens = addTokens(s.tokens, e.tokens)
    s.cost += e.cost
    s.messageCount++
    s.sessions.add(e.sessionId)
    s.activeDays.add(toDateString(e.timeCreated))
  }

  const totalTokens = Array.from(map.values()).reduce((sum, v) => sum + v.tokens.total, 0)

  const result: ProviderStats[] = []
  for (const [providerId, v] of map) {
    result.push({
      providerId,
      tokens: v.tokens,
      cost: v.cost,
      messageCount: v.messageCount,
      sessionCount: v.sessions.size,
      activeDays: v.activeDays.size,
      percentage: totalTokens > 0 ? v.tokens.total / totalTokens : 0,
    })
  }

  return result.sort((a, b) => b.tokens.total - a.tokens.total)
}

// ─── Agent stats ──────────────────────────────────────────────────────────────

export function computeAgentStats(events: UsageEvent[]): AgentStats[] {
  const map = new Map<
    string,
    {
      tokens: TokenSummary
      cost: number
      messageCount: number
      sessions: Set<string>
    }
  >()

  for (const e of events) {
    const key = e.agent ?? 'build'
    if (!map.has(key)) {
      map.set(key, {
        tokens: emptyTokenSummary(),
        cost: 0,
        messageCount: 0,
        sessions: new Set(),
      })
    }
    const s = map.get(key)!
    s.tokens = addTokens(s.tokens, e.tokens)
    s.cost += e.cost
    s.messageCount++
    s.sessions.add(e.sessionId)
  }

  const totalTokens = Array.from(map.values()).reduce((sum, v) => sum + v.tokens.total, 0)

  const result: AgentStats[] = []
  for (const [agent, v] of map) {
    result.push({
      agent,
      tokens: v.tokens,
      cost: v.cost,
      messageCount: v.messageCount,
      sessionCount: v.sessions.size,
      percentage: totalTokens > 0 ? v.tokens.total / totalTokens : 0,
    })
  }

  return result.sort((a, b) => b.tokens.total - a.tokens.total)
}

// ─── Daily stats ──────────────────────────────────────────────────────────────

export function computeDailyStats(events: UsageEvent[]): DailyStats[] {
  const map = new Map<
    string,
    {
      tokens: TokenSummary
      cost: number
      sessions: Set<string>
      messageCount: number
    }
  >()

  for (const e of events) {
    const day = toDateString(e.timeCreated)
    if (!map.has(day)) {
      map.set(day, {
        tokens: emptyTokenSummary(),
        cost: 0,
        sessions: new Set(),
        messageCount: 0,
      })
    }
    const s = map.get(day)!
    s.tokens = addTokens(s.tokens, e.tokens)
    s.cost += e.cost
    s.sessions.add(e.sessionId)
    s.messageCount++
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // most recent first
    .map(([date, v]) => ({
      date,
      tokens: v.tokens,
      cost: v.cost,
      sessionCount: v.sessions.size,
      messageCount: v.messageCount,
    }))
}

// ─── Project stats ────────────────────────────────────────────────────────────

export function computeProjectStats(events: UsageEvent[]): ProjectStats[] {
  const map = new Map<
    string,
    {
      tokens: TokenSummary
      cost: number
      sessions: Set<string>
      messageCount: number
    }
  >()

  for (const e of events) {
    const key = e.sessionDirectory ?? '(unknown)'
    if (!map.has(key)) {
      map.set(key, {
        tokens: emptyTokenSummary(),
        cost: 0,
        sessions: new Set(),
        messageCount: 0,
      })
    }
    const s = map.get(key)!
    s.tokens = addTokens(s.tokens, e.tokens)
    s.cost += e.cost
    s.sessions.add(e.sessionId)
    s.messageCount++
  }

  return Array.from(map.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([directory, v]) => ({
      directory,
      tokens: v.tokens,
      cost: v.cost,
      sessionCount: v.sessions.size,
      messageCount: v.messageCount,
    }))
}

// ─── Session stats ────────────────────────────────────────────────────────────

export function computeSessionStats(
  events: UsageEvent[],
  sessions: SessionRecord[]
): SessionStats[] {
  const sessionMap = new Map<string, SessionRecord>(sessions.map(s => [s.id, s]))

  const map = new Map<
    string,
    {
      tokens: TokenSummary
      cost: number
      messageCount: number
      models: Set<string>
      finishReasons: Record<string, number>
    }
  >()

  for (const e of events) {
    const key = e.sessionId
    if (!map.has(key)) {
      map.set(key, {
        tokens: emptyTokenSummary(),
        cost: 0,
        messageCount: 0,
        models: new Set(),
        finishReasons: {},
      })
    }
    const s = map.get(key)!
    s.tokens = addTokens(s.tokens, e.tokens)
    s.cost += e.cost
    s.messageCount++
    s.models.add(e.modelId)
    bumpFinish(s.finishReasons, e.finish)
  }

  const result: SessionStats[] = []
  for (const [sessionId, v] of map) {
    const session = sessionMap.get(sessionId)
    result.push({
      sessionId,
      title: session?.title ?? null,
      directory: session?.directory ?? null,
      timeCreated: session?.timeCreated ?? 0,
      tokens: v.tokens,
      cost: v.cost,
      messageCount: v.messageCount,
      durationMs:
        session && session.timeUpdated > session.timeCreated
          ? session.timeUpdated - session.timeCreated
          : null,
      models: Array.from(v.models),
      finishReasons: v.finishReasons,
    })
  }

  return result.sort((a, b) => b.timeCreated - a.timeCreated)
}

// ─── Trends ───────────────────────────────────────────────────────────────────

export function computeTrends(
  events: UsageEvent[],
  period: TrendPeriod,
  numPeriods: number
): PeriodStats[] {
  const now = dayjs()

  const buckets: Array<{
    label: string
    start: string
    end: string
  }> = []

  for (let i = 0; i < numPeriods; i++) {
    let startDate: dayjs.Dayjs
    let endDate: dayjs.Dayjs
    let label: string

    if (period === 'day') {
      const d = now.subtract(i, 'day')
      startDate = d.startOf('day')
      endDate = d.endOf('day')
      label = d.format('MMM D')
    } else if (period === 'week') {
      const weekStart = now.subtract(i, 'week').startOf('week')
      startDate = weekStart
      endDate = weekStart.add(6, 'day').endOf('day')
      label = `${weekStart.format('MMM D')} – ${endDate.format('MMM D')}`
    } else {
      const m = now.subtract(i, 'month')
      startDate = m.startOf('month')
      endDate = m.endOf('month')
      label = m.format('MMM YYYY')
    }

    buckets.push({
      label,
      start: startDate.format('YYYY-MM-DD'),
      end: endDate.format('YYYY-MM-DD'),
    })
  }

  const results: PeriodStats[] = buckets.map(b => {
    const periodEvents = events.filter(e => {
      const d = toDateString(e.timeCreated)
      return d >= b.start && d <= b.end
    })

    const tokens = emptyTokenSummary()
    let cost = 0
    const sessionSet = new Set<string>()
    let messageCount = 0

    for (const e of periodEvents) {
      const merged = addTokens(tokens, e.tokens)
      tokens.input = merged.input
      tokens.output = merged.output
      tokens.cacheRead = merged.cacheRead
      tokens.cacheWrite = merged.cacheWrite
      tokens.reasoning = merged.reasoning
      tokens.total = merged.total
      cost += e.cost
      sessionSet.add(e.sessionId)
      messageCount++
    }

    return {
      label: b.label,
      startDate: b.start,
      endDate: b.end,
      tokens,
      cost,
      sessionCount: sessionSet.size,
      messageCount,
      deltaPercent: null,
    }
  })

  for (let i = 0; i < results.length - 1; i++) {
    const curr = results[i]!
    const prev = results[i + 1]!
    if (prev.cost > 0) {
      curr.deltaPercent = (curr.cost - prev.cost) / prev.cost
    } else if (curr.cost > 0) {
      curr.deltaPercent = 1
    } else {
      curr.deltaPercent = 0
    }
  }

  return results
}

// ─── Heatmap data ─────────────────────────────────────────────────────────────

export interface HeatmapDay {
  date: string // YYYY-MM-DD
  tokens: number
  intensity: 0 | 1 | 2 | 3 | 4 // 0=none, 1=░, 2=▒, 3=▓, 4=█
}

export function computeHeatmap(events: UsageEvent[]): HeatmapDay[] {
  const dayTokens = new Map<string, number>()
  for (const e of events) {
    const d = toDateString(e.timeCreated)
    dayTokens.set(d, (dayTokens.get(d) ?? 0) + e.tokens.total)
  }

  const maxTokens = Math.max(0, ...dayTokens.values())
  const today = dayjs()
  const days: HeatmapDay[] = []

  for (let i = 364; i >= 0; i--) {
    const date = today.subtract(i, 'day').format('YYYY-MM-DD')
    const tokens = dayTokens.get(date) ?? 0

    let intensity: 0 | 1 | 2 | 3 | 4 = 0
    if (tokens > 0 && maxTokens > 0) {
      const ratio = tokens / maxTokens
      if (ratio < 0.25) intensity = 1
      else if (ratio < 0.5) intensity = 2
      else if (ratio < 0.75) intensity = 3
      else intensity = 4
    }

    days.push({ date, tokens, intensity })
  }

  return days
}

export interface DailyAggregate {
  date: string
  tokens: number
}

export function computeHeatmapFromAggregates(aggregates: DailyAggregate[]): HeatmapDay[] {
  const dayTokens = new Map<string, number>()
  for (const agg of aggregates) {
    dayTokens.set(agg.date, agg.tokens)
  }

  const maxTokens = Math.max(0, ...dayTokens.values())
  const today = dayjs()
  const days: HeatmapDay[] = []

  for (let i = 364; i >= 0; i--) {
    const date = today.subtract(i, 'day').format('YYYY-MM-DD')
    const tokens = dayTokens.get(date) ?? 0

    let intensity: 0 | 1 | 2 | 3 | 4 = 0
    if (tokens > 0 && maxTokens > 0) {
      const ratio = tokens / maxTokens
      if (ratio < 0.25) intensity = 1
      else if (ratio < 0.5) intensity = 2
      else if (ratio < 0.75) intensity = 3
      else intensity = 4
    }

    days.push({ date, tokens, intensity })
  }

  return days
}

/**
 * Build a compact HeatmapDay[] for the last `numDays` days.
 * Intensity is scaled relative to the max within the window.
 */
export function computeMiniHeatmap(aggregates: DailyAggregate[], numDays = 30): HeatmapDay[] {
  const dayTokens = new Map<string, number>()
  for (const agg of aggregates) {
    dayTokens.set(agg.date, agg.tokens)
  }

  const today = dayjs()
  const days: HeatmapDay[] = []

  for (let i = numDays - 1; i >= 0; i--) {
    const date = today.subtract(i, 'day').format('YYYY-MM-DD')
    const tokens = dayTokens.get(date) ?? 0
    days.push({ date, tokens, intensity: 0 })
  }

  const maxTokens = Math.max(0, ...days.map(d => d.tokens))

  for (const d of days) {
    if (d.tokens > 0 && maxTokens > 0) {
      const ratio = d.tokens / maxTokens
      if (ratio < 0.25) d.intensity = 1
      else if (ratio < 0.5) d.intensity = 2
      else if (ratio < 0.75) d.intensity = 3
      else d.intensity = 4
    }
  }

  return days
}
