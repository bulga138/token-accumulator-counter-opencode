import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents, loadSessions, getDailyAggregates } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeOverview, computeModelStats, computeMiniHeatmap } from '../../aggregator/index.js'
import type { DailyAggregate } from '../../data/queries.js'
import { getConfig } from '../../config/index.js'
import chalk from 'chalk'
import { formatTokens, formatCost } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'

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
    const todayEnd = new Date(todayStr + 'T23:59:59.999')

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
      process.stdout.write(
        JSON.stringify({ date: todayStr, overview, modelStats }, null, 2) + '\n'
      )
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

    // Today's summary
    if (overview.messageCount === 0) {
      lines.push('  No AI activity recorded today yet.\n')
    } else {
      const divider = useColor ? colors.muted('─'.repeat(44)) : '─'.repeat(44)
      lines.push('  ' + divider)
      lines.push('')

      const kv = (label: string, value: string) =>
        `  ${label.padEnd(20)} ${value}`

      lines.push(kv('Total tokens:', formatTokens(overview.tokens.total)))
      lines.push(kv('Cost:', formatCost(overview.cost)))
      lines.push(kv('Messages:', String(overview.messageCount)))
      lines.push(kv('Sessions:', String(overview.sessionCount)))

      if (overview.favoriteModel) {
        lines.push(kv('Model:', overview.favoriteModel))
      }
      lines.push('')

      // Top 3 models today
      if (modelStats.length > 0) {
        lines.push('  ' + (useColor ? colors.label.bold('Models today:') : 'Models today:'))
        const top = modelStats.slice(0, 3)
        top.forEach(m => {
          const pct = (m.percentage * 100).toFixed(1)
          lines.push(
            `    ${m.modelId.padEnd(36)} ${formatTokens(m.tokens.total).padStart(8)}  ${pct.padStart(5)}%  ${formatCost(m.cost)}`
          )
        })
        lines.push('')
      }

      // Budget check
      if (config.budget?.daily) {
        const pct = ((overview.cost / config.budget.daily) * 100).toFixed(1)
        const msg = `Daily budget: ${formatCost(overview.cost)} / ${formatCost(config.budget.daily)} (${pct}%)`
        if (overview.cost >= config.budget.daily * 0.8) {
          lines.push(useColor ? chalk.yellow(`  ⚠  ${msg}`) : `  WARN: ${msg}`)
        } else {
          lines.push(`  ✓  ${msg}`)
        }
        lines.push('')
      }
    }

    process.stdout.write(lines.join('\n'))
  })
}
