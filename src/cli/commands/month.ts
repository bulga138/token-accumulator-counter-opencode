/**
 * taco month — Current billing period view (gateway-only).
 *
 * Composes three existing generic data sources:
 *   - fetchGatewayMetrics()    → totalSpend, budget, team, reset date
 *   - fetchModelSpend()        → per-model spend (normalized + aggregated)
 *   - fetchDailyActivity()     → per-day spend + tokens + requests
 *
 * All three are optional / nullable — each section renders independently
 * and gracefully degrades when a data source is unavailable.
 *
 * Works with any LiteLLM-compatible gateway. The underlying fetch functions
 * normalize whatever shape the gateway returns into standard internal types,
 * so this command never touches raw API responses.
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { getConfig } from '../../config/index.js'
import { fetchGatewayMetrics } from '../../data/gateway.js'
import {
  fetchModelSpend,
  fetchDailyActivity,
  getCurrentBillingPeriod,
} from '../../data/gateway-litellm.js'
import { aggregateModelSpend } from '../../utils/model-names.js'
import { formatCost, formatTokens, formatInt } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'
import type { GatewayMetrics, GatewayDailyActivity } from '../../data/gateway-types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 10-char budget progress bar with traffic-light colouring. */
function budgetBar(spend: number, limit: number, useColor: boolean): string {
  const filled = Math.min(10, Math.round((spend / limit) * 10))
  const empty = 10 - filled
  const bar = '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']'
  if (!useColor) return bar
  if (filled >= 8) return chalk.red(bar)
  if (filled >= 6) return chalk.yellow(bar)
  return chalk.green(bar)
}

/**
 * Weighted-recent daily spend projection.
 *
 * Algorithm:
 *   overallAvg  = totalSpend / daysElapsed
 *   recentAvg   = sum(last 7 active days) / 7   (or fewer if <7 available)
 *   weightedAvg = overallAvg * 0.3 + recentAvg * 0.7
 *   projected   = currentSpend + weightedAvg * daysRemaining
 *
 * Falls back to overallAvg when fewer than 2 days of data exist.
 */
interface ProjectionResult {
  overallAvg: number
  recentAvg: number | null
  weightedAvg: number
  projectedEom: number
  daysElapsed: number
  daysRemaining: number
  daysInMonth: number
}

function computeProjection(
  days: GatewayDailyActivity[],
  totalSpend: number,
  startDate: string,
  endDate: string
): ProjectionResult | null {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const start = new Date(startDate)
  const end = new Date(endDate)
  // Days elapsed = days from start to today inclusive (at least 1)
  const daysElapsed = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed)

  if (days.length < 2) return null

  const overallAvg = totalSpend / daysElapsed

  // Recent avg: use up to the last 7 days present in the data (sorted asc)
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const recent = sorted.slice(-7)
  const recentAvg = recent.reduce((s, d) => s + d.totalSpend, 0) / 7

  const weightedAvg = overallAvg * 0.3 + recentAvg * 0.7
  const projectedEom = totalSpend + weightedAvg * daysRemaining

  return {
    overallAvg,
    recentAvg,
    weightedAvg,
    projectedEom,
    daysElapsed,
    daysRemaining,
    daysInMonth,
  }
}

/** Format a source/freshness line (reused pattern from overview + today). */
function sourceStr(endpoint: string, fetchedAt: number, cached: boolean): string {
  let hostname: string
  try {
    hostname = new URL(endpoint).hostname
  } catch {
    hostname = endpoint
  }
  const ageMs = Date.now() - fetchedAt
  const ageSec = Math.round(ageMs / 1000)
  const ageLabel =
    ageSec < 60
      ? `${ageSec}s ago`
      : ageSec < 3600
        ? `${Math.round(ageSec / 60)}m ago`
        : `${Math.round(ageSec / 3600)}h ago`
  const cacheLabel = cached ? `cached ${ageLabel}` : 'live'
  return `${hostname}  (${cacheLabel})`
}

// ─── Section renderers ─────────────────────────────────────────────────────────

function renderBudgetSection(
  gw: GatewayMetrics | null,
  useColor: boolean,
  dim: (s: string) => string
): string[] {
  const lines: string[] = []
  const divider = dim('─'.repeat(56))
  const heading = useColor ? chalk.bold('  Budget') : '  Budget'

  lines.push(heading)
  lines.push('  ' + divider)

  if (!gw) {
    lines.push(
      useColor
        ? chalk.yellow('  Could not reach gateway. Run: taco config gateway --test')
        : '  Could not reach gateway.'
    )
    return lines
  }

  // Spend row
  const spendStr = formatCost(gw.totalSpend)
  if (gw.budgetLimit !== null && gw.budgetLimit > 0) {
    const pct = ((gw.totalSpend / gw.budgetLimit) * 100).toFixed(1)
    const bar = budgetBar(gw.totalSpend, gw.budgetLimit, useColor)
    lines.push(
      `  ${'Spend:'.padEnd(12)} ${useColor ? chalk.green(spendStr) : spendStr} / ${formatCost(gw.budgetLimit)}  ${bar}  ${pct}%`
    )
  } else {
    lines.push(`  ${'Spend:'.padEnd(12)} ${useColor ? chalk.green(spendStr) : spendStr}`)
  }

  // Team row
  if (gw.teamSpend !== null) {
    const label = gw.teamName ? `Team (${gw.teamName}):` : 'Team:'
    if (gw.teamBudgetLimit !== null && gw.teamBudgetLimit > 0) {
      const pct = ((gw.teamSpend / gw.teamBudgetLimit) * 100).toFixed(1)
      const bar = budgetBar(gw.teamSpend, gw.teamBudgetLimit, useColor)
      lines.push(
        `  ${label.padEnd(12)} ${formatCost(gw.teamSpend)} / ${formatCost(gw.teamBudgetLimit)}  ${bar}  ${pct}%`
      )
    } else {
      lines.push(`  ${label.padEnd(12)} ${formatCost(gw.teamSpend)}`)
    }
  }

  // Reset row
  if (gw.budgetResetAt) {
    const d = new Date(gw.budgetResetAt)
    const resetLabel = d.toLocaleDateString(undefined, { dateStyle: 'medium' })
    const cycle = gw.budgetDuration ? `  (${gw.budgetDuration} cycle)` : ''
    lines.push(`  ${'Resets:'.padEnd(12)} ${resetLabel}${cycle}`)
  }

  return lines
}

function renderProjectionSection(
  proj: ProjectionResult | null,
  totalSpend: number,
  budgetLimit: number | null,
  useColor: boolean,
  dim: (s: string) => string
): string[] {
  const lines: string[] = []
  const divider = dim('─'.repeat(56))
  const heading = useColor
    ? chalk.bold('  Projection  ') + dim('(weighted recent 7d)')
    : '  Projection  (weighted recent 7d)'

  lines.push('')
  lines.push(heading)
  lines.push('  ' + divider)

  if (!proj) {
    lines.push(dim('  Not enough data for projection (need at least 2 days).'))
    return lines
  }

  const kv = (label: string, value: string) => `  ${label.padEnd(28)} ${value}`

  lines.push(kv('Daily avg (month):', formatCost(proj.overallAvg)))

  if (proj.recentAvg !== null) {
    lines.push(kv('Daily avg (recent 7d):', formatCost(proj.recentAvg)))
  }

  // Projected EOM with optional budget context
  const projStr = formatCost(proj.projectedEom)
  if (budgetLimit !== null && budgetLimit > 0) {
    const pct = ((proj.projectedEom / budgetLimit) * 100).toFixed(1)
    const pctNum = proj.projectedEom / budgetLimit
    const colorPct = useColor
      ? pctNum > 0.9
        ? chalk.red(`${pct}% of budget`)
        : pctNum > 0.7
          ? chalk.yellow(`${pct}% of budget`)
          : chalk.green(`${pct}% of budget`)
      : `${pct}% of budget`
    lines.push(kv('Projected end-of-month:', `${projStr}  ${colorPct}`))
  } else {
    lines.push(kv('Projected end-of-month:', projStr))
  }

  lines.push(
    dim(
      `  ${proj.daysElapsed}d elapsed · ${proj.daysRemaining}d remaining · ${proj.daysInMonth}d month`
    )
  )

  return lines
}

function renderModelsSection(
  modelSpend: Map<string, number> | null,
  totalSpend: number,
  useColor: boolean,
  dim: (s: string) => string
): string[] {
  const lines: string[] = []
  const divider = dim('─'.repeat(56))
  const heading = useColor ? chalk.bold('  Models') : '  Models'

  lines.push('')
  lines.push(heading)
  lines.push('  ' + divider)

  if (!modelSpend || modelSpend.size === 0) {
    lines.push(dim('  No model spend data available (gateway may not support /spend/logs).'))
    return lines
  }

  // Sort by spend descending, normalize+aggregate already done by caller
  const sorted = [...modelSpend.entries()].sort((a, b) => b[1] - a[1])

  const MODEL_W = 38
  const COST_W = 14
  const PCT_W = 7

  lines.push(
    '  ' +
      dim('Model'.padEnd(MODEL_W)) +
      dim('Gateway Cost'.padStart(COST_W)) +
      dim('Share'.padStart(PCT_W))
  )
  lines.push('  ' + dim('─'.repeat(MODEL_W + COST_W + PCT_W)))

  let renderedTotal = 0
  for (const [model, spend] of sorted) {
    renderedTotal += spend
    const pct = totalSpend > 0 ? `${((spend / totalSpend) * 100).toFixed(1)}%` : '—'
    const modelDisplay = model.length > MODEL_W - 1 ? model.slice(0, MODEL_W - 2) + '…' : model
    lines.push(
      '  ' +
        (useColor ? chalk.white(modelDisplay.padEnd(MODEL_W)) : modelDisplay.padEnd(MODEL_W)) +
        formatCost(spend).padStart(COST_W) +
        pct.padStart(PCT_W)
    )
  }

  lines.push('  ' + dim('─'.repeat(MODEL_W + COST_W + PCT_W)))
  const totalStr = formatCost(renderedTotal)
  lines.push(
    '  ' +
      (useColor ? chalk.bold('Total'.padEnd(MODEL_W)) : 'Total'.padEnd(MODEL_W)) +
      (useColor ? chalk.green(totalStr.padStart(COST_W)) : totalStr.padStart(COST_W)) +
      ''.padStart(PCT_W)
  )

  return lines
}

function renderDailySection(
  days: GatewayDailyActivity[] | null,
  useColor: boolean,
  dim: (s: string) => string
): string[] {
  const lines: string[] = []
  const divider = dim('─'.repeat(56))
  const heading = useColor ? chalk.bold('  Daily Breakdown') : '  Daily Breakdown'

  lines.push('')
  lines.push(heading)
  lines.push('  ' + divider)

  if (!days || days.length === 0) {
    lines.push(dim('  No daily data available (gateway may not support /user/daily/activity).'))
    return lines
  }

  const DATE_W = 12
  const SPEND_W = 14
  const REQ_W = 10
  const TOK_W = 12

  lines.push(
    '  ' +
      dim('Date'.padEnd(DATE_W)) +
      dim('Spend'.padStart(SPEND_W)) +
      dim('Requests'.padStart(REQ_W)) +
      dim('Tokens'.padStart(TOK_W))
  )
  lines.push('  ' + dim('─'.repeat(DATE_W + SPEND_W + REQ_W + TOK_W)))

  // Sort descending (most recent first) for readability
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date))

  for (const d of sorted) {
    lines.push(
      '  ' +
        d.date.padEnd(DATE_W) +
        formatCost(d.totalSpend).padStart(SPEND_W) +
        formatInt(d.totalRequests).padStart(REQ_W) +
        formatTokens(d.totalTokens).padStart(TOK_W)
    )
  }

  return lines
}

// ─── Command registration ──────────────────────────────────────────────────────

export function registerMonthCommand(program: Command): void {
  program
    .command('month')
    .description(
      'Current billing period view — spend, projection, and model breakdown (requires gateway)'
    )
    .option('--db <path>', 'Override OpenCode database path')
    .action(async () => {
      const config = getConfig()

      if (!config.gateway) {
        console.log(
          '\n  Gateway not configured. This command requires a gateway to show real spend data.\n' +
            '  Run: taco config gateway --setup\n'
        )
        process.exit(0)
      }

      const useColor = process.stdout.isTTY !== false
      const colors = getColors()
      const dim = (s: string) => (useColor ? chalk.dim(s) : s)

      const { startDate, endDate } = getCurrentBillingPeriod()

      // Fetch all three data sources in parallel — each independently nullable
      const [gw, spendResult, activityResult] = await Promise.all([
        fetchGatewayMetrics(config.gateway),
        fetchModelSpend(config.gateway, startDate, endDate),
        fetchDailyActivity(config.gateway, startDate, endDate),
      ])

      // Normalize + aggregate model spend (strips provider prefixes, merges variants)
      let modelSpend: Map<string, number> | null = null
      if (spendResult && spendResult.modelSpend.length > 0) {
        const rawMap: Record<string, number> = {}
        for (const { model, spend } of spendResult.modelSpend) {
          rawMap[model] = (rawMap[model] ?? 0) + spend
        }
        modelSpend = aggregateModelSpend(rawMap)
      }

      // Total spend: prefer primary gateway metrics (more authoritative),
      // fall back to sum from /spend/logs if primary is unavailable
      const totalSpend = gw?.totalSpend ?? spendResult?.totalSpend ?? 0

      // Projection requires daily activity data
      const proj = activityResult
        ? computeProjection(activityResult.days, totalSpend, startDate, endDate)
        : null

      // ─── Header ─────────────────────────────────────────────────────────────
      const now = new Date()
      const monthName = now.toLocaleString(undefined, { month: 'long' })
      const year = now.getFullYear()
      const daysInMonth = new Date(year, now.getMonth() + 1, 0).getDate()
      const dayOfMonth = now.getDate()
      const daysRemaining = daysInMonth - dayOfMonth

      const header = useColor
        ? `\n${colors.header.bold('TACO')} — ${chalk.bold(`${monthName} ${year}`)}  ${dim('·')}  ${dim(`${dayOfMonth} of ${daysInMonth} days`)}  ${dim('·')}  ${dim(`${daysRemaining} days remaining`)}\n`
        : `\nTACO — ${monthName} ${year}  ·  ${dayOfMonth} of ${daysInMonth} days  ·  ${daysRemaining} days remaining\n`

      const lines: string[] = [header]

      // ─── Budget section ──────────────────────────────────────────────────────
      lines.push(...renderBudgetSection(gw, useColor, dim))

      // ─── Projection section ──────────────────────────────────────────────────
      lines.push(
        ...renderProjectionSection(proj, totalSpend, gw?.budgetLimit ?? null, useColor, dim)
      )

      // ─── Models section ──────────────────────────────────────────────────────
      lines.push(...renderModelsSection(modelSpend, totalSpend, useColor, dim))

      // ─── Daily section ───────────────────────────────────────────────────────
      lines.push(...renderDailySection(activityResult?.days ?? null, useColor, dim))

      // ─── Source footer ───────────────────────────────────────────────────────
      lines.push('')
      const sourceLines: string[] = []
      // Report whichever source was most recently fetched
      if (gw) sourceLines.push(sourceStr(gw.endpoint, gw.fetchedAt, gw.cached))
      else if (spendResult)
        sourceLines.push(sourceStr(spendResult.endpoint, spendResult.fetchedAt, spendResult.cached))
      if (sourceLines.length > 0) {
        lines.push('  ' + dim(`Source:    ${sourceLines[0]}`))
      }
      lines.push('')

      process.stdout.write(lines.join('\n'))
    })
}
