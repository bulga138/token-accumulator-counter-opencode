import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import {
  loadSessions,
  getOverviewAggregates,
  getDailyAggregates,
  getBudgetStatus,
  streamUsageEvents,
} from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeHeatmapFromAggregates, computeStreaks } from '../../aggregator/index.js'
import { formatOverview } from '../../format/visual.js'
import { formatOverviewJson } from '../../format/json.js'
import { formatOverviewCsv } from '../../format/csv.js'
import { formatOverviewMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import { getDefaultDbPath } from '../../utils/platform.js'
import chalk from 'chalk'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { UsageEvent, SessionRecord } from '../../data/types.js'
import { emptyTokenSummary, addTokens, DEFAULT_DATE_RANGE_DAYS } from '../../data/types.js'
import type { DailyAggregate } from '../../data/queries.js'

// Simple file cache for heatmap data (now stores aggregates instead of full events)
interface CacheEntry {
  dbMtime: number
  dbSize: number
  fromDate: string
  aggregates: DailyAggregate[]
}

function getCacheDir(): string {
  const cacheDir = join(homedir(), '.cache', 'taco')
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

function getHeatmapCachePath(dbPath: string): string {
  const safeName = dbPath.replace(/[^a-zA-Z0-9]/g, '_')
  return join(getCacheDir(), `${safeName}_heatmap_cache.json`)
}

function getCacheDateKey(date: Date): string {
  // Use just the date part (YYYY-MM-DD) for cache key to avoid time mismatches
  return date.toISOString().split('T')[0]
}

function loadCachedHeatmap(dbPath: string, fromDate: Date): DailyAggregate[] | null {
  try {
    const cachePath = getHeatmapCachePath(dbPath)
    if (!existsSync(cachePath)) return null

    const cache: CacheEntry = JSON.parse(readFileSync(cachePath, 'utf-8'))
    const stats = statSync(dbPath)

    // Check if cache is still valid (db hasn't changed and date range matches)
    if (
      cache.dbMtime === stats.mtimeMs &&
      cache.dbSize === stats.size &&
      cache.fromDate === getCacheDateKey(fromDate)
    ) {
      return cache.aggregates
    }
    return null
  } catch {
    return null
  }
}

function saveCachedHeatmap(dbPath: string, fromDate: Date, aggregates: DailyAggregate[]): void {
  try {
    const cachePath = getHeatmapCachePath(dbPath)
    const stats = statSync(dbPath)
    const cache: CacheEntry = {
      dbMtime: stats.mtimeMs,
      dbSize: stats.size,
      fromDate: getCacheDateKey(fromDate),
      aggregates,
    }
    writeFileSync(cachePath, JSON.stringify(cache))
  } catch {
    // Ignore cache write errors
  }
}

// Memory-efficient overview computation using streaming.
// Computes streaks, mostActiveDay, longestSession, and finishReasons
// so output matches the full computeOverview() in the TUI.
function computeOverviewStreaming(
  events: Iterable<UsageEvent>,
  sessions: SessionRecord[]
) {
  const tokens = emptyTokenSummary()
  let cost = 0
  const modelSet = new Set<string>()
  const modelCounts: Record<string, number> = {}
  const activeDaySet = new Set<string>()
  const dayMessages: Record<string, number> = {}
  const finishReasons: Record<string, number> = {}
  let messageCount = 0

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

    const date = new Date(e.timeCreated).toISOString().split('T')[0]!
    activeDaySet.add(date)
    dayMessages[date] = (dayMessages[date] ?? 0) + 1

    const finKey = e.finish ?? 'unknown'
    finishReasons[finKey] = (finishReasons[finKey] ?? 0) + 1

    messageCount++
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

  // Streaks from active day set
  const sortedDays = Array.from(activeDaySet).sort()
  const { currentStreak, longestStreak } = computeStreaks(sortedDays)

  // Most active day
  let mostActiveDay: string | null = null
  let maxMsgs = 0
  for (const [day, count] of Object.entries(dayMessages)) {
    if (count > maxMsgs) {
      maxMsgs = count
      mostActiveDay = day
    }
  }

  // Longest session
  let longestSessionMs = 0
  for (const s of sessions) {
    const dur = s.timeUpdated - s.timeCreated
    if (dur > longestSessionMs) longestSessionMs = dur
  }

  const activeDays = activeDaySet.size

  return {
    tokens,
    cost,
    sessionCount: sessions.length,
    messageCount,
    activeDays,
    modelsUsed: Array.from(modelSet),
    favoriteModel,
    currentStreak,
    longestStreak,
    mostActiveDay,
    longestSessionMs,
    avgCostPerDay: activeDays > 0 ? cost / activeDays : 0,
    finishReasons,
    sortedDays,
  }
}

export function registerOverviewCommand(program: Command): void {
  const cmd = program
    .command('overview')
    .description('Show usage overview with heatmap and summary stats')
    .alias('o')

  addFilterFlags(cmd)

  cmd.action(async opts => {
    console.time('Overview command')
    const config = getConfig()
    const format = opts.format ?? config.defaultFormat ?? 'visual'

    // Apply default range from config if no --from given
    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    // Apply default date range if no filter specified (prevent loading all data)
    if (!opts.from && !opts.to) {
      const defaultFrom = new Date()
      defaultFrom.setDate(defaultFrom.getDate() - DEFAULT_DATE_RANGE_DAYS)
      opts.from = defaultFrom.toISOString().split('T')[0]
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)

    const rangeLabel = buildRangeLabel(opts)

    // Limit heatmap to last 6 months for performance
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    // Try to load cached heatmap data
    const dbPath = opts.db ?? config.db ?? getDefaultDbPath()
    const dailyAggregates = loadCachedHeatmap(dbPath, sixMonthsAgo)

    if (format === 'json') {
      // Use SQLite-native aggregation for zero memory overhead
      const aggregates = getOverviewAggregates(db, filters.from ?? new Date(0), filters.to)
      const heatmapData = dailyAggregates ?? getDailyAggregates(db, sixMonthsAgo)
      if (!dailyAggregates) {
        saveCachedHeatmap(dbPath, sixMonthsAgo, heatmapData)
      }

      const heatmap = computeHeatmapFromAggregates(heatmapData)
      const stats = {
        tokens: {
          input: aggregates.totalInput,
          output: aggregates.totalOutput,
          cacheRead: aggregates.totalCacheRead,
          cacheWrite: aggregates.totalCacheWrite,
          reasoning: aggregates.totalReasoning,
          total: aggregates.totalTokens,
        },
        cost: aggregates.totalCost,
        sessionCount: 0, // Would need separate query
        messageCount: aggregates.messageCount,
        activedays: 0, // Would need separate query
        totalDays: 0,
        modelsUsed: [],
        favoriteModel: null,
        currentStreak: 0,
        longestStreak: 0,
        mostActiveDay: null,
        longestSessionMs: 0,
        avgCostPerDay: 0,
        finishReasons: {},
      }

      process.stdout.write(formatOverviewJson(stats, heatmap) + '\n')
    } else if (format === 'csv') {
      const eventStream = streamUsageEvents(db, filters)
      const sessions = loadSessions(db, filters)
      const stats = computeOverviewStreaming(eventStream, sessions)
      const fullStats = {
        ...stats,
        activedays: stats.activeDays,
        totalDays: stats.sortedDays.length >= 2
          ? Math.round(
              (new Date(stats.sortedDays[stats.sortedDays.length - 1]!).getTime() -
                new Date(stats.sortedDays[0]!).getTime()) /
                86_400_000
            ) + 1
          : 1,
      }
      process.stdout.write(formatOverviewCsv(fullStats) + '\n')
    } else if (format === 'markdown') {
      const eventStream = streamUsageEvents(db, filters)
      const sessions = loadSessions(db, filters)
      const stats = computeOverviewStreaming(eventStream, sessions)

      // Compute totalDays from sortedDays span
      let totalDays = 1
      if (stats.sortedDays.length >= 2) {
        totalDays =
          Math.round(
            (new Date(stats.sortedDays[stats.sortedDays.length - 1]!).getTime() -
              new Date(stats.sortedDays[0]!).getTime()) /
              86_400_000
          ) + 1
      }

      const fullStats = {
        ...stats,
        activedays: stats.activeDays,
        totalDays,
      }

      process.stdout.write(formatOverviewMarkdown(fullStats, rangeLabel) + '\n')
    } else {
      // Visual (default) - use streaming for memory efficiency
      const eventStream = streamUsageEvents(db, filters)
      const sessions = loadSessions(db, filters)
      const stats = computeOverviewStreaming(eventStream, sessions)

      // Get heatmap data
      const heatmapData = dailyAggregates ?? getDailyAggregates(db, sixMonthsAgo)
      if (!dailyAggregates) {
        saveCachedHeatmap(dbPath, sixMonthsAgo, heatmapData)
      }
      const heatmap = computeHeatmapFromAggregates(heatmapData)

      // Daily series for the tokens-over-time chart (filtered range)
      const dailyStats = getDailyAggregates(db, filters.from ?? new Date(0), filters.to)
      const dailySeries = dailyStats
        .map(d => ({ date: d.date, tokens: d.tokens }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Compute totalDays from sortedDays span
      let totalDays = 1
      if (stats.sortedDays.length >= 2) {
        totalDays =
          Math.round(
            (new Date(stats.sortedDays[stats.sortedDays.length - 1]!).getTime() -
              new Date(stats.sortedDays[0]!).getTime()) /
              86_400_000
          ) + 1
      }

      const fullStats = {
        ...stats,
        activedays: stats.activeDays,
        totalDays,
      }

      process.stdout.write(formatOverview(fullStats, heatmap, rangeLabel, dailySeries))

      // Budget warnings - use single SQLite query instead of loading events
      if (config.budget) {
        const { daily, monthly } = config.budget
        const budgetStatus = getBudgetStatus(db)

        if (daily && budgetStatus.todayCost >= daily * 0.8) {
          const pct = ((budgetStatus.todayCost / daily) * 100).toFixed(1)
          const msg = `Daily budget: $${budgetStatus.todayCost.toFixed(2)} / $${daily} (${pct}%)`
          process.stdout.write(chalk.yellow(`  [WARN]  ${msg}\n`))
        }
        if (monthly && budgetStatus.monthCost >= monthly * 0.8) {
          const pct = ((budgetStatus.monthCost / monthly) * 100).toFixed(1)
          const msg = `Monthly budget: $${budgetStatus.monthCost.toFixed(2)} / $${monthly} (${pct}%)`
          process.stdout.write(chalk.yellow(`  [WARN]  ${msg}\n`))
        }
      }

      process.stdout.write('\n')
    }

    console.timeEnd('Overview command')
  })
}
