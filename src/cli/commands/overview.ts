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
import { fetchGatewayMetrics } from '../../data/gateway.js'
import type { GatewayMetrics } from '../../data/gateway-types.js'
import { formatCost } from '../../utils/formatting.js'

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
function computeOverviewStreaming(events: Iterable<UsageEvent>, sessions: SessionRecord[]) {
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

      const gwForJson = config.gateway ? await fetchGatewayMetrics(config.gateway) : undefined
      process.stdout.write(formatOverviewJson(stats, heatmap, gwForJson) + '\n')
    } else if (format === 'csv') {
      const eventStream = streamUsageEvents(db, filters)
      const sessions = loadSessions(db, filters)
      const stats = computeOverviewStreaming(eventStream, sessions)
      const fullStats = {
        ...stats,
        activedays: stats.activeDays,
        totalDays:
          stats.sortedDays.length >= 2
            ? Math.round(
                (new Date(stats.sortedDays[stats.sortedDays.length - 1]!).getTime() -
                  new Date(stats.sortedDays[0]!).getTime()) /
                  86_400_000
              ) + 1
            : 1,
      }
      const gwForCsv = config.gateway ? await fetchGatewayMetrics(config.gateway) : undefined
      process.stdout.write(formatOverviewCsv(fullStats, gwForCsv) + '\n')
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

      const gwForMd = config.gateway ? await fetchGatewayMetrics(config.gateway) : undefined
      process.stdout.write(formatOverviewMarkdown(fullStats, rangeLabel, gwForMd) + '\n')
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

      // Fetch gateway metrics once — used both in the KV block and in the gateway section
      const gw = config.gateway ? await fetchGatewayMetrics(config.gateway) : null

      process.stdout.write(formatOverview(fullStats, heatmap, rangeLabel, dailySeries, gw))

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

      // Gateway section (budget bar, team spend, reset date — data beyond the KV block)
      if (gw) {
        process.stdout.write(formatGatewaySection(gw, fullStats.cost))
      }

      process.stdout.write('\n')
    }

    console.timeEnd('Overview command')
  })
}

// ─── Gateway section renderer ──────────────────────────────────────────────────

function formatGatewaySection(gw: GatewayMetrics | null, localCost: number): string {
  const divider = chalk.dim('─'.repeat(52))
  const lines: string[] = [divider, chalk.bold('  Gateway Metrics'), '']

  if (!gw) {
    lines.push(chalk.yellow('  Could not reach gateway. Check your config and network.'))
    lines.push(chalk.dim('  Run: taco config gateway --test'))
    lines.push(divider)
    return lines.join('\n') + '\n'
  }

  // Spend row
  const spendStr = formatCost(gw.totalSpend)
  if (gw.budgetLimit !== null) {
    const pct = ((gw.totalSpend / gw.budgetLimit) * 100).toFixed(1)
    const bar = budgetBar(gw.totalSpend, gw.budgetLimit)
    lines.push(
      `  Spend:     ${chalk.green(spendStr)} / ${formatCost(gw.budgetLimit)}  ${bar}  ${pct}%`
    )
  } else {
    lines.push(`  Spend:     ${chalk.green(spendStr)}`)
  }

  // Team row
  if (gw.teamSpend !== null) {
    const teamLabel = gw.teamName ? `  (${gw.teamName})` : ''
    if (gw.teamBudgetLimit !== null) {
      const pct = ((gw.teamSpend / gw.teamBudgetLimit) * 100).toFixed(1)
      const bar = budgetBar(gw.teamSpend, gw.teamBudgetLimit)
      lines.push(
        `  Team:      ${formatCost(gw.teamSpend)} / ${formatCost(gw.teamBudgetLimit)}  ${bar}  ${pct}%${teamLabel}`
      )
    } else {
      lines.push(`  Team:      ${formatCost(gw.teamSpend)}${teamLabel}`)
    }
  }

  // Budget reset row
  if (gw.budgetResetAt) {
    const d = new Date(gw.budgetResetAt)
    const resetStr = d.toLocaleDateString(undefined, { dateStyle: 'medium' })
    const msLeft = d.getTime() - Date.now()
    const daysLeft = Math.ceil(msLeft / 86_400_000)
    const timeLeft = daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `${daysLeft}d left`
    lines.push(`  Resets:    ${resetStr}  ${timeLeft}`)
  }

  // Local vs gateway comparison
  const diff = localCost - gw.totalSpend
  const diffStr =
    diff >= 0
      ? chalk.dim(`+${formatCost(diff)} vs gateway`)
      : chalk.dim(`${formatCost(diff)} vs gateway`)
  lines.push(`  Local est: ${formatCost(localCost)}  ${diffStr}`)

  // Source / freshness
  const hostname = (() => {
    try {
      return new URL(gw.endpoint).hostname
    } catch {
      return gw.endpoint
    }
  })()
  const ageMs = Date.now() - gw.fetchedAt
  const ageSec = Math.round(ageMs / 1000)
  const ageStr =
    ageSec < 60
      ? `${ageSec}s ago`
      : ageSec < 3600
        ? `${Math.round(ageSec / 60)}m ago`
        : `${Math.round(ageSec / 3600)}h ago`
  const cacheIndicator = gw.cached ? chalk.dim(`cached ${ageStr}`) : chalk.dim('live')
  lines.push(`  Source:    ${chalk.dim(hostname)}  ${cacheIndicator}`)

  lines.push(divider)
  return lines.join('\n') + '\n'
}

/** Render a compact 10-char budget progress bar: [████░░░░░░] */
function budgetBar(spend: number, limit: number): string {
  const filled = Math.min(10, Math.round((spend / limit) * 10))
  const empty = 10 - filled
  const color = filled >= 8 ? chalk.red : filled >= 6 ? chalk.yellow : chalk.green
  return color('[' + '█'.repeat(filled) + '░'.repeat(empty) + ']')
}
