import chalk from 'chalk'
import dayjs from 'dayjs'
import type {
  OverviewStats,
  ModelStats,
  ProviderStats,
  AgentStats,
  DailyStats,
  ProjectStats,
  SessionStats,
  PeriodStats,
} from '../data/types.js'
import type { HeatmapDay } from '../aggregator/index.js'
import type { GatewayDailyActivity, GatewayMetrics } from '../data/gateway-types.js'
import type { DailySeries } from '../data/types.js'
import { renderHeatmap } from '../viz/heatmap.js'
import { renderTotalChart, renderModelPanels } from '../viz/chart.js'
import { renderBar, renderDelta } from '../viz/bars.js'
import {
  formatTokens,
  formatCost,
  formatPercent,
  padEnd,
  padStart,
  truncate,
} from '../utils/formatting.js'
import { formatDuration } from '../utils/dates.js'
import { detectTheme, getColors } from '../theme/index.js'
import { buildTable } from './table.js'

const useColor = process.stdout.isTTY !== false

// Must match Y_LABEL_WIDTH in chart.ts so stats rows align under chart data area
const Y_OVERVIEW_OFFSET = 10 // 8 (label) + 2 (axis char + space)

function header(title: string): string {
  if (!useColor) return `\nTACO — ${title}\n`
  const colors = getColors()
  return `\n${colors.header.bold('TACO')} — ${title}\n`
}

function divider(len: number = 56): string {
  if (!useColor) return '─'.repeat(len)
  const colors = getColors()
  return colors.muted('─'.repeat(len))
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export function formatOverview(
  stats: OverviewStats,
  heatmap: HeatmapDay[],
  rangeLabel: string,
  dailySeries?: DailySeries[],
  gatewayMetrics?: GatewayMetrics | null
): string {
  const lines: string[] = []

  lines.push(header(`Usage Overview${rangeLabel ? ' · ' + rangeLabel : ''}`))

  // Daily total tokens chart (if we have data)
  if (dailySeries && dailySeries.length > 0) {
    // Chart title — use muted color on light backgrounds where chalk.dim vanishes
    const dim = (s: string) => {
      if (!useColor) return s
      return detectTheme() === 'light' ? getColors().muted(s) : chalk.dim(s)
    }
    lines.push(`  ${dim('Tokens / day')}  ${dim('·')}  all models combined`)

    const chartLines = renderTotalChart(dailySeries, 62, 6, useColor)
    lines.push(...chartLines.map(l => '  ' + l))

    // Stats row under the chart: date range, peak day, total
    const sorted = [...dailySeries].sort((a, b) => a.date.localeCompare(b.date))
    const peakDay = dailySeries.reduce((max, d) => (d.tokens > max.tokens ? d : max))
    const firstDate = sorted[0].date
    const lastDate = sorted[sorted.length - 1].date

    const statParts = [
      `${dim('Range:')} ${firstDate} → ${lastDate}`,
      `${dim('Peak:')} ${peakDay.date}  ${formatTokens(peakDay.tokens)}`,
      `${dim('Active days:')} ${dailySeries.length}`,
    ]
    lines.push('  ' + ' '.repeat(Y_OVERVIEW_OFFSET) + statParts.join('   '))
    lines.push('')
  }

  // Heatmap
  lines.push(...renderHeatmap(heatmap, useColor))
  lines.push('')

  lines.push(divider())
  lines.push('')

  // Two-column KV layout needs ~100 cols; fall back to single-col on narrow terminals.
  const termCols = process.stdout.columns || 80
  const twoCol = termCols >= 90

  // Fixed column widths so every row lines up vertically.
  //   label col : 24 chars  (e.g. "Favorite model:         ")
  //   value col :  valWidth  (truncated + padded — both columns use same width)
  const VAL_WIDTH = 20
  const LABEL_WIDTH = 24

  const kv = (label: string, value: string, label2?: string, value2?: string): string => {
    const fromStart = label.toLowerCase().includes('model')
    const l1 = padEnd(label + ':', LABEL_WIDTH)
    const v1 = padEnd(truncate(value, VAL_WIDTH, fromStart), VAL_WIDTH)
    if (twoCol && label2 !== undefined && value2 !== undefined) {
      // Both columns: same label width and same value width → perfect vertical alignment.
      const fromStart2 = label2.toLowerCase().includes('model')
      const l2 = padEnd(label2 + ':', LABEL_WIDTH)
      const v2 = padEnd(truncate(value2, VAL_WIDTH, fromStart2), VAL_WIDTH)
      return `  ${l1} ${v1}   ${l2} ${v2}`
    }
    // Single-column fallback: second KV on its own line.
    const line1 = `  ${l1} ${v1}`
    if (label2 !== undefined && value2 !== undefined) {
      const fromStart2 = label2.toLowerCase().includes('model')
      const l2 = padEnd(label2 + ':', LABEL_WIDTH)
      const v2 = padEnd(truncate(value2, VAL_WIDTH, fromStart2), VAL_WIDTH)
      return `${line1}\n  ${l2} ${v2}`
    }
    return line1
  }

  const fav = stats.favoriteModel ?? '—'
  const totalTok = formatTokens(stats.tokens.total)

  lines.push(kv('Favorite model', fav, 'Total tokens', totalTok))
  if (gatewayMetrics) {
    // Show local and gateway costs side by side
    lines.push(
      kv(
        'Local cost',
        formatCost(stats.cost),
        'Gateway cost',
        formatCost(gatewayMetrics.totalSpend)
      )
    )
    lines.push(
      kv(
        'Avg cost/day (local)',
        formatCost(stats.avgCostPerDay),
        'Avg cost/day (gw)',
        formatCost(gatewayMetrics.totalSpend / Math.max(stats.activedays, 1))
      )
    )
  } else {
    lines.push(
      kv('Total cost', formatCost(stats.cost), 'Avg cost/day', formatCost(stats.avgCostPerDay))
    )
  }
  lines.push('')
  lines.push(
    kv(
      'Sessions',
      String(stats.sessionCount),
      'Longest session',
      formatDuration(stats.longestSessionMs)
    )
  )
  lines.push(
    kv(
      'Active days',
      `${stats.activedays}/${stats.totalDays}`,
      'Longest streak',
      `${stats.longestStreak} days`
    )
  )
  lines.push(
    kv(
      'Most active day',
      stats.mostActiveDay ?? '—',
      'Current streak',
      `${stats.currentStreak} days`
    )
  )
  lines.push('')
  lines.push(divider())
  lines.push('')

  // Token breakdown
  lines.push('  Token breakdown:')
  lines.push(`    Input:       ${padStart(formatTokens(stats.tokens.input), 10)}`)
  lines.push(`    Output:      ${padStart(formatTokens(stats.tokens.output), 10)}`)
  lines.push(`    Cache read:  ${padStart(formatTokens(stats.tokens.cacheRead), 10)}`)
  lines.push(`    Cache write: ${padStart(formatTokens(stats.tokens.cacheWrite), 10)}`)
  if (stats.tokens.reasoning > 0) {
    lines.push(`    Reasoning:   ${padStart(formatTokens(stats.tokens.reasoning), 10)}`)
  }
  lines.push(`    ─────────────────────`)
  lines.push(`    Total:       ${padStart(formatTokens(stats.tokens.total), 10)}`)
  lines.push(`    Messages:    ${padStart(String(stats.messageCount), 10)}`)

  // Show finish reason summary only when there are non-stop reasons
  const reasons = stats.finishReasons ?? {}
  const nonStop = Object.entries(reasons).filter(([k]) => k !== 'stop' && k !== 'unknown')
  if (nonStop.length > 0 || Object.keys(reasons).length > 1) {
    const parts = Object.entries(reasons)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k}: ${v}`)
    lines.push(`    Finish:      ${parts.join('  ')}`)
  }

  lines.push('')
  return lines.join('\n')
}

// ─── Models ───────────────────────────────────────────────────────────────────

export function formatModels(models: ModelStats[], rangeLabel: string): string {
  const lines: string[] = []
  lines.push(header(`Models${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (models.length === 0) {
    lines.push('  No data for this period.')
    return lines.join('\n')
  }

  // One panel per model — mini chart + inline stats, shared x-axis
  const panelLines = renderModelPanels(models.slice(0, 6), 62, 4, useColor)
  lines.push(...panelLines)

  return lines.join('\n')
}

// ─── Providers ────────────────────────────────────────────────────────────────

export function formatProviders(
  providers: ProviderStats[],
  rangeLabel: string,
  gatewayTotalSpend?: number | null
): string {
  const lines: string[] = []
  lines.push(header(`Providers${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (providers.length === 0) {
    lines.push('  No data for this period.')
    return lines.join('\n')
  }

  const providerColumns: Parameters<typeof buildTable<ProviderStats>>[0] = [
    {
      header: 'Provider',
      align: 'left',
      width: 'flex',
      minWidth: 10,
      maxWidth: 25,
      render: r => r.providerId,
    },
    { header: 'Tokens', align: 'right', width: 12, render: r => formatTokens(r.tokens.total) },
    {
      header: gatewayTotalSpend != null ? 'Local $' : 'Cost',
      align: 'right',
      width: 10,
      render: r => formatCost(r.cost),
    },
    ...(gatewayTotalSpend != null
      ? [
          {
            header: 'Gateway $',
            align: 'right' as const,
            width: 11,
            render: (r: ProviderStats) =>
              r.cost > 0 && r.cost >= (providers[0]?.cost ?? 0) * 0.5
                ? formatCost(gatewayTotalSpend!)
                : '—',
          },
        ]
      : []),
    {
      header: '',
      align: 'left',
      width: 20,
      priority: 1,
      render: (r: ProviderStats, w?: number) => renderBar(r.percentage, useColor, w ?? 20),
    },
    {
      header: 'Share',
      align: 'right',
      width: 7,
      priority: 1,
      render: r => formatPercent(r.percentage),
    },
  ]

  lines.push(...buildTable<ProviderStats>(providerColumns, providers, { useColor }))

  lines.push('')
  return lines.join('\n')
}

// ─── Daily ────────────────────────────────────────────────────────────────────

export function formatDaily(
  daily: DailyStats[],
  rangeLabel: string,
  dailySeries?: DailySeries[],
  gatewayDays?: GatewayDailyActivity[] | null
): string {
  const lines: string[] = []
  lines.push(header(`Daily Usage${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (daily.length === 0) {
    lines.push('  No data for this period.')
    return lines.join('\n')
  }

  // Tokens-over-time chart — same style as taco overview
  const series = dailySeries ?? daily.map(d => ({ date: d.date, tokens: d.tokens.total }))
  if (series.length > 0) {
    const dim = (s: string) => {
      if (!useColor) return s
      return detectTheme() === 'light' ? getColors().muted(s) : chalk.dim(s)
    }
    lines.push(`  ${dim('Tokens / day')}`)

    const chartLines = renderTotalChart(series, 62, 6, useColor)
    lines.push(...chartLines.map(l => '  ' + l))

    const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
    const peakDay = series.reduce((max, d) => (d.tokens > max.tokens ? d : max))
    const statParts = [
      `${dim('Range:')} ${sorted[0]!.date} → ${sorted[sorted.length - 1]!.date}`,
      `${dim('Peak:')} ${peakDay.date}  ${formatTokens(peakDay.tokens)}`,
      `${dim('Active days:')} ${series.length}`,
    ]
    lines.push('  ' + ' '.repeat(10) + statParts.join('   '))
    lines.push('')
  }

  // Build a lookup map from date → gateway spend
  const gwDayMap = new Map<string, number>()
  if (gatewayDays) {
    for (const d of gatewayDays) {
      gwDayMap.set(d.date, d.totalSpend)
    }
  }

  const columns: Parameters<typeof buildTable<DailyStats>>[0] = [
    {
      header: 'Date',
      align: 'left',
      width: 'flex',
      minWidth: 10,
      maxWidth: 10,
      render: r => r.date,
    },
    { header: 'Sessions', align: 'right', width: 10, render: r => String(r.sessionCount) },
    { header: 'Messages', align: 'right', width: 10, render: r => String(r.messageCount) },
    { header: 'Tokens', align: 'right', width: 12, render: r => formatTokens(r.tokens.total) },
    {
      header: gatewayDays ? 'Local $' : 'Cost',
      align: 'right',
      width: 10,
      render: r => formatCost(r.cost),
    },
  ]

  // Add gateway cost column when data is available
  if (gwDayMap.size > 0) {
    columns.push({
      header: 'Gateway $',
      align: 'right',
      width: 11,
      render: r => {
        const gw = gwDayMap.get(r.date)
        return gw !== undefined ? formatCost(gw) : '—'
      },
    })
  }

  lines.push(...buildTable<DailyStats>(columns, daily, { useColor }))

  lines.push('')
  return lines.join('\n')
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export function formatProjects(
  projects: ProjectStats[],
  rangeLabel: string,
  hasGateway = false
): string {
  const lines: string[] = []
  lines.push(header(`Projects${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (projects.length === 0) {
    lines.push('  No data for this period.')
    return lines.join('\n')
  }

  lines.push(
    ...buildTable<ProjectStats>(
      [
        {
          header: 'Project',
          align: 'left',
          width: 'flex',
          minWidth: 12,
          maxWidth: 50,
          render: r => r.directory,
        },
        { header: 'Sessions', align: 'right', width: 10, render: r => String(r.sessionCount) },
        { header: 'Messages', align: 'right', width: 10, render: r => String(r.messageCount) },
        { header: 'Tokens', align: 'right', width: 12, render: r => formatTokens(r.tokens.total) },
        {
          header: hasGateway ? 'Local $' : 'Cost',
          align: 'right',
          width: 10,
          render: r => formatCost(r.cost),
        },
      ],
      projects,
      { useColor }
    )
  )

  lines.push('')
  return lines.join('\n')
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export function formatSessions(
  sessions: SessionStats[],
  rangeLabel: string,
  hasGateway = false
): string {
  const lines: string[] = []
  lines.push(header(`Sessions${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (sessions.length === 0) {
    lines.push('  No data for this period.')
    return lines.join('\n')
  }

  lines.push(
    ...buildTable<SessionStats>(
      [
        {
          header: 'Title / ID',
          align: 'left',
          width: 'flex',
          minWidth: 12,
          maxWidth: 35,
          render: r => r.title ?? r.sessionId,
        },
        {
          header: 'Created',
          align: 'left',
          width: 13,
          render: r => dayjs(r.timeCreated).format('MMM D HH:mm'),
        },
        { header: 'Msgs', align: 'right', width: 6, render: r => String(r.messageCount) },
        { header: 'Tokens', align: 'right', width: 12, render: r => formatTokens(r.tokens.total) },
        {
          header: hasGateway ? 'Local $' : 'Cost',
          align: 'right',
          width: 10,
          render: r => formatCost(r.cost),
        },
        {
          header: 'Duration',
          align: 'right',
          width: 10,
          priority: 1,
          render: r => (r.durationMs ? formatDuration(r.durationMs) : '—'),
        },
      ],
      sessions,
      { useColor }
    )
  )

  lines.push('')
  return lines.join('\n')
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export function formatAgents(agents: AgentStats[], rangeLabel: string, hasGateway = false): string {
  const lines: string[] = []
  lines.push(header(`Agents${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (agents.length === 0) {
    lines.push('  No data for this period.')
    return lines.join('\n')
  }

  lines.push(
    ...buildTable<AgentStats>(
      [
        {
          header: 'Agent',
          align: 'left',
          width: 'flex',
          minWidth: 10,
          maxWidth: 30,
          render: r => r.agent,
        },
        { header: 'Messages', align: 'right', width: 10, render: r => String(r.messageCount) },
        { header: 'Tokens', align: 'right', width: 12, render: r => formatTokens(r.tokens.total) },
        {
          header: hasGateway ? 'Local $' : 'Cost',
          align: 'right',
          width: 10,
          render: r => formatCost(r.cost),
        },
        {
          header: '',
          align: 'left',
          width: 20,
          priority: 1,
          render: (r, w) => renderBar(r.percentage, useColor, w ?? 20),
        },
        {
          header: 'Share',
          align: 'right',
          width: 7,
          priority: 1,
          render: r => formatPercent(r.percentage),
        },
      ],
      agents,
      { useColor }
    )
  )

  lines.push('')
  return lines.join('\n')
}

// ─── Trends ───────────────────────────────────────────────────────────────────

export function formatTrends(
  trends: PeriodStats[],
  period: string,
  rangeLabel: string,
  gatewayTotalSpend?: number | null
): string {
  const lines: string[] = []
  lines.push(header(`Trends · ${period}${rangeLabel ? ' · ' + rangeLabel : ''}`))

  if (trends.length === 0) {
    lines.push('  No data.')
    return lines.join('\n')
  }

  lines.push(
    ...buildTable<PeriodStats>(
      [
        {
          header: 'Period',
          align: 'left',
          width: 'flex',
          minWidth: 12,
          maxWidth: 24,
          render: r => r.label,
        },
        { header: 'Sessions', align: 'right', width: 10, render: r => String(r.sessionCount) },
        { header: 'Messages', align: 'right', width: 10, render: r => String(r.messageCount) },
        { header: 'Tokens', align: 'right', width: 12, render: r => formatTokens(r.tokens.total) },
        {
          header: gatewayTotalSpend != null ? 'Local $' : 'Cost',
          align: 'right',
          width: 10,
          render: r => formatCost(r.cost),
        },
        {
          header: gatewayTotalSpend != null ? 'Δ Local $' : 'Δ Cost',
          align: 'right',
          width: 12,
          priority: 1,
          render: r => renderDelta(r.deltaPercent, useColor),
        },
      ],
      trends,
      { useColor }
    )
  )

  // Gateway total note — period-level breakdown not available, show overall total
  if (gatewayTotalSpend != null) {
    const localTotal = trends.reduce((s, t) => s + t.cost, 0)
    const dim = (s: string) => (useColor ? chalk.dim(s) : s)
    lines.push(
      dim(`  Gateway total (all periods): ${formatCost(gatewayTotalSpend)}`) +
        dim(`   vs local: ${formatCost(localTotal)}`)
    )
  }

  lines.push('')
  return lines.join('\n')
}
