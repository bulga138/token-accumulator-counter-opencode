import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeModelStats } from '../../aggregator/index.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import chalk from 'chalk'
import { getColors } from '../../theme/index.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinishSummary {
  reason: string
  count: number
  percent: number
}

interface ModelHealth {
  modelId: string
  messageCount: number
  errorRate: number
  errorCount: number
  lengthRate: number
  lengthCount: number
  medianTps: number | null
  avgCostPerMsg: number
}

interface HealthReport {
  totalMessages: number
  finishReasons: FinishSummary[]
  globalErrorRate: number
  globalErrorCount: number
  globalLengthRate: number
  globalLengthCount: number
  perModel: ModelHealth[]
  anomalies: string[]
}

// ─── Computation ──────────────────────────────────────────────────────────────

function computeHealth(events: import('../../data/types.js').UsageEvent[]): HealthReport {
  const modelStats = computeModelStats(events)

  // Global finish reasons
  const globalFinish: Record<string, number> = {}
  for (const e of events) {
    const key = e.finish ?? 'unknown'
    globalFinish[key] = (globalFinish[key] ?? 0) + 1
  }

  const totalMessages = events.length
  const finishReasons: FinishSummary[] = Object.entries(globalFinish)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({
      reason,
      count,
      percent: totalMessages > 0 ? count / totalMessages : 0,
    }))

  const errorKeys = ['error', 'timeout', 'content_filter']
  const globalErrorCount = Object.entries(globalFinish)
    .filter(([k]) => errorKeys.includes(k))
    .reduce((sum, [, v]) => sum + v, 0)
  const globalErrorRate = totalMessages > 0 ? globalErrorCount / totalMessages : 0

  const globalLengthCount = globalFinish['length'] ?? 0
  const globalLengthRate = totalMessages > 0 ? globalLengthCount / totalMessages : 0

  // Per-model health
  const perModel: ModelHealth[] = modelStats.map(m => {
    const errCount = Object.entries(m.finishReasons)
      .filter(([k]) => errorKeys.includes(k))
      .reduce((sum, [, v]) => sum + v, 0)
    const lenCount = m.finishReasons['length'] ?? 0

    return {
      modelId: m.modelId,
      messageCount: m.messageCount,
      errorRate: m.messageCount > 0 ? errCount / m.messageCount : 0,
      errorCount: errCount,
      lengthRate: m.messageCount > 0 ? lenCount / m.messageCount : 0,
      lengthCount: lenCount,
      medianTps: m.medianOutputTps,
      avgCostPerMsg: m.messageCount > 0 ? m.cost / m.messageCount : 0,
    }
  })

  // Anomalies
  const anomalies: string[] = []
  if (globalErrorRate > 0.05) {
    anomalies.push(
      `Global error rate is ${(globalErrorRate * 100).toFixed(1)}% — above 5% threshold`
    )
  }
  if (globalLengthRate > 0.1) {
    anomalies.push(
      `Length truncation rate is ${(globalLengthRate * 100).toFixed(1)}% — above 10% threshold`
    )
  }
  for (const m of perModel) {
    if (m.errorRate > 0.1) {
      anomalies.push(
        `${m.modelId}: error rate ${(m.errorRate * 100).toFixed(1)}% — above 10% threshold`
      )
    }
    if (m.lengthRate > 0.15) {
      anomalies.push(
        `${m.modelId}: truncation rate ${(m.lengthRate * 100).toFixed(1)}% — consider raising max_tokens`
      )
    }
  }

  return {
    totalMessages,
    finishReasons,
    globalErrorRate,
    globalErrorCount,
    globalLengthRate,
    globalLengthCount,
    perModel,
    anomalies,
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatHealthVisual(report: HealthReport, rangeLabel: string): string {
  const useColor = process.stdout.isTTY !== false
  const colors = getColors()

  const hdr = useColor
    ? `\n${colors.header.bold('TACO')} — Health Report${rangeLabel ? ' · ' + rangeLabel : ''}\n`
    : `\nTACO — Health Report${rangeLabel ? ' · ' + rangeLabel : ''}\n`

  const div = useColor ? colors.muted('─'.repeat(50)) : '─'.repeat(50)
  const lines: string[] = [hdr]

  if (report.totalMessages === 0) {
    lines.push('  No data available.\n')
    return lines.join('\n')
  }

  // Finish reasons
  lines.push('  Finish Reasons')
  lines.push('  ' + div)
  for (const r of report.finishReasons) {
    const pct = (r.percent * 100).toFixed(1).padStart(5) + '%'
    const cnt = String(r.count).padStart(8)
    const label = r.reason.padEnd(16)
    const warn =
      ['error', 'timeout', 'content_filter'].includes(r.reason) && r.percent > 0.05
        ? useColor
          ? chalk.red(' !')
          : ' !'
        : r.reason === 'length' && r.percent > 0.1
          ? useColor
            ? chalk.yellow(' !')
            : ' !'
          : ''
    lines.push(`    ${label} ${cnt}  (${pct})${warn}`)
  }
  lines.push('')

  // Global rates
  const errPct = (report.globalErrorRate * 100).toFixed(1)
  const lenPct = (report.globalLengthRate * 100).toFixed(1)
  const errMsg = `  Error rate:       ${errPct}%  (${report.globalErrorCount} / ${report.totalMessages})`
  const lenMsg = `  Truncation rate:  ${lenPct}%  (${report.globalLengthCount} / ${report.totalMessages})`

  if (report.globalErrorRate > 0.05) {
    lines.push(useColor ? chalk.red(errMsg) : errMsg)
  } else {
    lines.push(errMsg)
  }
  if (report.globalLengthRate > 0.1) {
    lines.push(useColor ? chalk.yellow(lenMsg) : lenMsg)
  } else {
    lines.push(lenMsg)
  }
  lines.push('')

  // Per-model table
  if (report.perModel.length > 0) {
    lines.push('  Per-Model Health')
    lines.push('  ' + div)
    lines.push(
      `    ${'Model'.padEnd(28)} ${'Err%'.padStart(6)} ${'Trunc%'.padStart(7)} ${'Tok/s'.padStart(7)} ${'$/msg'.padStart(7)}`
    )
    lines.push('    ' + '─'.repeat(58))
    for (const m of report.perModel) {
      const name = m.modelId.length > 26 ? m.modelId.slice(0, 25) + '…' : m.modelId.padEnd(28)
      const err = `${(m.errorRate * 100).toFixed(1)}%`.padStart(6)
      const len = `${(m.lengthRate * 100).toFixed(1)}%`.padStart(7)
      const tps = m.medianTps != null ? m.medianTps.toFixed(1).padStart(7) : '      -'
      const cost = `$${m.avgCostPerMsg.toFixed(3)}`.padStart(7)
      lines.push(`    ${name} ${err} ${len} ${tps} ${cost}`)
    }
    lines.push('')
  }

  // Anomalies
  if (report.anomalies.length > 0) {
    lines.push('  Anomalies')
    lines.push('  ' + div)
    for (const a of report.anomalies) {
      const prefix = useColor ? chalk.yellow('  ! ') : '  ! '
      lines.push(prefix + a)
    }
    lines.push('')
  } else {
    lines.push(useColor ? chalk.green('  ✓  No anomalies detected') : '  ✓  No anomalies detected')
    lines.push('')
  }

  return lines.join('\n')
}

function formatHealthJson(report: HealthReport): string {
  return JSON.stringify(report, null, 2)
}

// ─── Command ──────────────────────────────────────────────────────────────────

export function registerHealthCommand(program: Command): void {
  const cmd = program
    .command('health')
    .description('Show finish reason analytics, error rates, and model performance')
    .alias('h')

  addFilterFlags(cmd)

  cmd.action(async opts => {
    const config = getConfig()
    const format = opts.format ?? config.defaultFormat ?? 'visual'

    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)
    const events = loadUsageEvents(db, filters)
    const report = computeHealth(events)
    const rangeLabel = buildRangeLabel(opts)

    if (format === 'json') {
      process.stdout.write(formatHealthJson(report) + '\n')
    } else {
      process.stdout.write(formatHealthVisual(report, rangeLabel))
    }
  })
}
