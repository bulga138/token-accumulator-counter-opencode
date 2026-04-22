import { Command, Option } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeTrends } from '../../aggregator/index.js'
import { formatTrends } from '../../format/visual.js'
import { formatTrendsJson } from '../../format/json.js'
import { formatTrendsCsv } from '../../format/csv.js'
import { formatTrendsMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import { fetchGatewayMetrics } from '../../data/gateway.js'
import type { TrendPeriod, PeriodStats, SortField } from '../../data/types.js'

export function registerTrendsCommand(program: Command): void {
  const cmd = program.command('trends').description('Compare usage across periods').alias('t')

  addFilterFlags(cmd)
    .addOption(
      new Option('--period <period>', 'Period grouping (default: week)').choices([
        'day',
        'week',
        'month',
      ])
    )
    .option('--periods <n>', 'Number of periods to compare (default: 4)')
    .addOption(
      new Option('--sort <field>', 'Sort by field (default: date)').choices([
        'cost',
        'tokens',
        'date',
        'messages',
      ])
    )

  cmd.action(async opts => {
    const config = getConfig()
    const format = opts.format ?? config.defaultFormat ?? 'visual'
    const period = (opts.period ?? 'week') as TrendPeriod
    const numPeriods = parseInt(opts.periods ?? '4', 10)

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)

    const events = loadUsageEvents(db, filters)
    let stats = computeTrends(events, period, numPeriods)
    const sort = (opts.sort ?? 'date') as SortField
    stats = sortTrendStats(stats, sort)
    const rangeLabel = buildRangeLabel(opts)

    const gw =
      format === 'visual' && config.gateway ? await fetchGatewayMetrics(config.gateway) : null

    const hasGateway = !!config.gateway

    if (format === 'json') {
      process.stdout.write(formatTrendsJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatTrendsCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatTrendsMarkdown(stats, period, rangeLabel, hasGateway) + '\n')
    } else {
      process.stdout.write(formatTrends(stats, period, rangeLabel, gw?.totalSpend))
    }
  })
}

function sortTrendStats(stats: PeriodStats[], sort: SortField): PeriodStats[] {
  switch (sort) {
    case 'cost':
      return [...stats].sort((a, b) => b.cost - a.cost)
    case 'tokens':
      return [...stats].sort((a, b) => b.tokens.total - a.tokens.total)
    case 'messages':
      return [...stats].sort((a, b) => b.messageCount - a.messageCount)
    case 'date':
    default:
      return stats // already chronological from computeTrends
  }
}
