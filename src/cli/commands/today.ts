import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents, loadSessions, getDailyAggregates } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeOverview, computeModelStats, computeMiniHeatmap } from '../../aggregator/index.js'
import type { DailyAggregate } from '../../data/queries.js'
import { getConfig } from '../../config/index.js'
import chalk from 'chalk'
import { formatTokens, formatCost, formatEstimatedCost } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'
import { fetchGatewayMetrics } from '../../data/gateway.js'
import {
  fetchDailyActivity,
  fetchModelSpend,
  fetchDailyMetrics,
  getCurrentBillingPeriod,
} from '../../data/gateway-litellm.js'
import type { GatewayDailyActivity } from '../../data/gateway-types.js'
import { aggregateModelSpend, normalizeModelName } from '../../utils/model-names.js'

const HEATMAP_CHARS = [' ', '░', '▒', '▓', '█']

function renderMiniHeatmap(aggregates: DailyAggregate[], numDays = 30): string {
  const days = computeMiniHeatmap(aggregates, numDays)
  const colors = getColors()
  const useColor = process.stdout.isTTY !== false
  const cells = days.map(d => {
    const ch = HEATMAP_CHARS[d.intensity] ?? ' '
    if (!useColor) return ch
    if (d.intensity === 0) return colors.muted(ch)
    if (d.intensity === 1) return chalk.hex('#2d6a4f')(ch)
    if (d.intensity === 2) return chalk.hex('#52b788')(ch)
    if (d.intensity === 3) return chalk.hex('#74c69d')(ch)
    return chalk.hex('#d8f3dc')(ch)
  })
  return '  ' + cells.join('') + '  ← today'
}

export function registerTodayCommand(program: Command): void {
  const cmd = program
    .command('today')
    .description("Show today's usage summary with 30-day activity heatmap")
    .option('--db <path>', 'Override OpenCode database path')
    .option('--format <fmt>', 'Output format: visual | json | csv | markdown (default: visual)')

  cmd.action(async opts => {
    const config = getConfig()
    const db = await getDbAsync(opts.db ?? config.db)
    const colors = getColors()

    // Today in local time
    const todayStr = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
    const todayStart = new Date(todayStr + 'T00:00:00')

    const filters = buildFilters({ from: todayStr, to: todayStr })
    const events = loadUsageEvents(db, filters)
    const sessions = loadSessions(db, filters)
    const overview = computeOverview(events, sessions)
    const modelStats = computeModelStats(events)

    // 30-day aggregates for mini heatmap context
    const thirtyDaysAgo = new Date(todayStart)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)
    const dailyAggregates = getDailyAggregates(db, thirtyDaysAgo)

    const format = opts.format ?? config.defaultFormat ?? 'visual'

    if (format === 'json') {
      process.stdout.write(JSON.stringify({ date: todayStr, overview, modelStats }, null, 2) + '\n')
      return
    }

    // Visual output (default)
    const useColor = process.stdout.isTTY !== false
    const dim = (s: string) => (useColor ? chalk.dim(s) : s)
    const header = (s: string) =>
      useColor ? `\n${colors.header.bold('TACO')} — ${s}\n` : `\nTACO — ${s}\n`

    const lines: string[] = []
    lines.push(header(`Today  ${dim('·')}  ${todayStr}`))

    // 30-day mini heatmap
    lines.push('  Activity (last 30 days):')
    lines.push(renderMiniHeatmap(dailyAggregates))
    lines.push('')

    // Today-scoped gateway data (populated in the models block, reused in gateway section)
    let gwTodayTotal: number | null = null
    let gwToday: GatewayDailyActivity | null = null

    // Determine if any model has estimated cost so the total label reflects it
    const hasEstimated = modelStats.some(m => m.costEstimated)
    const totalCostStr = hasEstimated
      ? formatEstimatedCost(overview.cost)
      : formatCost(overview.cost)
    const costLabel = config.gateway ? 'Local Cost:' : hasEstimated ? 'Cost (est.):' : 'Cost:'

    // Today's summary
    if (overview.messageCount === 0) {
      lines.push('  No AI activity recorded today yet.\n')
    } else {
      const divider = useColor ? colors.muted('─'.repeat(52)) : '─'.repeat(52)
      lines.push('  ' + divider)
      lines.push('')

      const kv = (label: string, value: string) => `  ${label.padEnd(22)} ${value}`

      lines.push(kv('Total tokens:', formatTokens(overview.tokens.total)))
      lines.push(kv(costLabel, totalCostStr))
      lines.push(kv('Messages:', String(overview.messageCount)))
      lines.push(kv('Sessions:', String(overview.sessionCount)))

      if (overview.favoriteModel) {
        lines.push(kv('Top model:', overview.favoriteModel))
      }

      // Token breakdown (only if non-trivial: show cache/reasoning when present)
      const t = overview.tokens
      if (t.cacheRead > 0 || t.cacheWrite > 0 || t.reasoning > 0) {
        lines.push('')
        lines.push(kv(dim('  Input:'), dim(formatTokens(t.input))))
        lines.push(kv(dim('  Output:'), dim(formatTokens(t.output))))
        if (t.cacheRead > 0) lines.push(kv(dim('  Cache read:'), dim(formatTokens(t.cacheRead))))
        if (t.cacheWrite > 0) lines.push(kv(dim('  Cache write:'), dim(formatTokens(t.cacheWrite))))
        if (t.reasoning > 0) lines.push(kv(dim('  Reasoning:'), dim(formatTokens(t.reasoning))))
      }

      lines.push('')

      // Budget bar (compact, inline)
      if (config.budget?.daily) {
        const spent = overview.cost
        const limit = config.budget.daily
        const pct = Math.min(100, (spent / limit) * 100)
        const filled = Math.min(10, Math.round(pct / 10))
        const empty = 10 - filled
        const barColor = filled >= 8 ? chalk.red : filled >= 6 ? chalk.yellow : chalk.green
        const bar = useColor
          ? barColor('[' + '█'.repeat(filled) + '░'.repeat(empty) + ']')
          : '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']'
        const budgetMsg = `${totalCostStr} / ${formatCost(limit)}  ${bar}  ${pct.toFixed(0)}%`
        if (pct >= 80) {
          lines.push(
            useColor
              ? chalk.yellow(`  ! Daily budget:       ${budgetMsg}`)
              : `  WARN Daily budget: ${budgetMsg}`
          )
        } else {
          lines.push(kv('Daily budget:', budgetMsg))
        }
        lines.push('')
      }
    }

    // ── Gateway today data ────────────────────────────────────────────────
    // Primary source: /user/daily/activity?start_date=today&end_date=today
    // Returns today-scoped spend, full token breakdown, and per-model data.
    // Fallback chain: dailyMetricsEndpoint → /spend/logs (billing-period)
    let gwModelSpend: Map<string, number> | null = null

    if (config.gateway) {
      // Try /user/daily/activity (today only) — best source
      const activityResult = await fetchDailyActivity(config.gateway, todayStr, todayStr)
      if (activityResult?.days.length) {
        gwToday = activityResult.days[0] ?? null
        if (gwToday) {
          gwTodayTotal = gwToday.totalSpend
          if (gwToday.models.length > 0) {
            const rawMap: Record<string, number> = {}
            for (const { model, spend } of gwToday.models) {
              rawMap[model] = (rawMap[model] ?? 0) + spend
            }
            gwModelSpend = aggregateModelSpend(rawMap)
          }
        }
      }

      // Fallback 1: custom dailyMetricsEndpoint
      if (!gwToday && config.gateway.dailyMetricsEndpoint) {
        const dmResult = await fetchDailyMetrics(config.gateway, todayStr, todayStr)
        if (dmResult) {
          gwTodayTotal = dmResult.totalSpend
          if (dmResult.modelSpend.length > 0) {
            const rawMap: Record<string, number> = {}
            for (const { model, spend } of dmResult.modelSpend) {
              rawMap[model] = (rawMap[model] ?? 0) + spend
            }
            gwModelSpend = aggregateModelSpend(rawMap)
          }
        }
      }

      // Fallback 2: billing-period /spend/logs (approximate, month-to-date)
      if (!gwModelSpend) {
        const { startDate, endDate } = getCurrentBillingPeriod()
        const spendResult = await fetchModelSpend(config.gateway, startDate, endDate)
        if (spendResult?.modelSpend.length) {
          const rawMap: Record<string, number> = {}
          for (const { model, spend } of spendResult.modelSpend) {
            rawMap[model] = (rawMap[model] ?? 0) + spend
          }
          gwModelSpend = aggregateModelSpend(rawMap)
        }
      }
    }

    // ── Models table with gateway column ───────────────────────────────────────
    if (modelStats.length > 0) {
      const hasGw = gwModelSpend !== null
      // If gwToday came from daily/activity it's today-scoped; otherwise it's period data
      const gwColLabel = gwToday ? 'GW Today' : gwTodayTotal !== null ? 'GW Today' : 'GW (period)'
      lines.push('  ' + (useColor ? colors.label.bold('Models today:') : 'Models today:'))

      const modelColW = 34
      const tokColW = 8
      const inOutColW = 16
      const costColW = 10

      lines.push(
        dim(
          `    ${'Model'.padEnd(modelColW)} ${'Tokens'.padStart(tokColW)}  ${'In / Out'.padEnd(inOutColW)}  ${'Cost'.padStart(costColW)}${hasGw ? `  ${gwColLabel.padStart(11)}` : ''}`
        )
      )

      const top = modelStats.slice(0, 5)
      top.forEach(m => {
        const modelName =
          m.modelId.length > modelColW
            ? m.modelId.slice(0, modelColW - 1) + '…'
            : m.modelId.padEnd(modelColW)

        const localCostStr = m.billedExternally
          ? dim('via plan'.padStart(costColW))
          : m.costEstimated
            ? formatEstimatedCost(m.cost).padStart(costColW)
            : formatCost(m.cost).padStart(costColW)

        const inOut = `${formatTokens(m.tokens.input)} / ${formatTokens(m.tokens.output)}`

        let gwStr = ''
        if (gwModelSpend) {
          const normalized = normalizeModelName(m.modelId)
          let gwCost: number | undefined = gwModelSpend.get(normalized)
          if (gwCost === undefined) {
            for (const [key, val] of gwModelSpend) {
              const nk = normalizeModelName(key)
              if (nk === normalized || nk.startsWith(normalized) || normalized.startsWith(nk)) {
                gwCost = (gwCost ?? 0) + val
              }
            }
          }
          gwStr =
            gwCost !== undefined
              ? `  ${formatCost(gwCost).padStart(11)}`
              : `  ${dim('---').padStart(11)}`
        }

        lines.push(
          `    ${useColor ? colors.value(modelName) : modelName}` +
            `${formatTokens(m.tokens.total).padStart(tokColW)}  ` +
            `${dim(inOut.padEnd(inOutColW))}  ` +
            `${localCostStr}${gwStr}`
        )

        if (m.tokens.cacheRead > 0) {
          lines.push(
            dim(
              `    ${' '.repeat(modelColW + tokColW + 2)}${formatTokens(m.tokens.cacheRead)} cache read`
            )
          )
        }
      })
      lines.push('')
    }

    // ── Gateway metrics section ───────────────────────────────────────────────
    if (config.gateway) {
      const gw = await fetchGatewayMetrics(config.gateway)
      const divider = useColor ? colors.muted('─'.repeat(52)) : '─'.repeat(52)
      lines.push('  ' + divider)
      lines.push('')

      const hasTodayData = gwTodayTotal !== null

      // Billing period label e.g. "Apr 1 – Apr 27"
      const now = new Date()
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString(
        undefined,
        { month: 'short', day: 'numeric' }
      )
      const periodEnd = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const periodLabel = dim(` · ${periodStart} – ${periodEnd}`)
      lines.push(
        (useColor ? colors.label.bold('  Gateway Metrics') : '  Gateway Metrics') + periodLabel
      )
      lines.push('')

      if (!gw && !hasTodayData) {
        lines.push('  Could not reach gateway. Run: taco config gateway --test')
      } else {
        const kv = (label: string, value: string) => `  ${label.padEnd(22)} ${value}`

        // Today-scoped row — from /user/daily/activity or dailyMetricsEndpoint
        if (hasTodayData) {
          lines.push(kv('Today spend:', formatCost(gwTodayTotal!)))
        }

        // Billing period row (from primary endpoint)
        if (gw) {
          lines.push(kv('Period spend:', formatCost(gw.totalSpend)))
          if (gw.budgetLimit !== null) {
            const pct = ((gw.totalSpend / gw.budgetLimit) * 100).toFixed(1)
            lines.push(kv('Budget:', `${formatCost(gw.budgetLimit)}  (${pct}% used)`))
          }
          if (gw.teamSpend !== null) {
            const label = gw.teamName ? `Team (${gw.teamName}):` : 'Team spend:'
            lines.push(kv(label, formatCost(gw.teamSpend)))
          }
          lines.push(kv('Local estimate:', totalCostStr))

          const hostname = (() => {
            try {
              return new URL(gw.endpoint).hostname
            } catch {
              return gw.endpoint
            }
          })()
          const ageMs = Date.now() - gw.fetchedAt
          const ageStr =
            ageMs < 60000
              ? `${Math.round(ageMs / 1000)}s ago`
              : ageMs < 3600000
                ? `${Math.round(ageMs / 60000)}m ago`
                : `${Math.round(ageMs / 3600000)}h ago`
          const cacheStr = gw.cached ? `cached ${ageStr}` : 'live'
          lines.push(kv('Source:', `${hostname}  (${cacheStr})`))
        }
      }
      lines.push('')
    }

    process.stdout.write(lines.join('\n'))
  })
}
