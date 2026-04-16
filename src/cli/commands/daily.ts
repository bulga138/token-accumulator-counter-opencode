import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeDailyStats } from '../../aggregator/index.js'
import { formatDaily } from '../../format/visual.js'
import { formatDailyJson } from '../../format/json.js'
import { formatDailyCsv } from '../../format/csv.js'
import { formatDailyMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import type { DailyStats, SortField } from '../../data/types.js'

export function registerDailyCommand(program: Command): void {
  const cmd = program.command('daily').description('Show daily usage breakdown').alias('d')

  addFilterFlags(cmd).option('--sort <field>', 'Sort by: cost, tokens, date, messages (default: date)')

  cmd.action(async opts => {
    const config = getConfig()
    const format = opts.format ?? config.defaultFormat ?? 'visual'
    const sort = (opts.sort ?? 'date') as SortField

    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)
    const events = loadUsageEvents(db, filters)
    let stats = computeDailyStats(events)
    stats = sortDailyStats(stats, sort)
    const rangeLabel = buildRangeLabel(opts)

    if (format === 'json') {
      process.stdout.write(formatDailyJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatDailyCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatDailyMarkdown(stats, rangeLabel) + '\n')
    } else {
      // Derive DailySeries from DailyStats for the chart — no extra DB query needed.
      const dailySeries = stats
        .map(d => ({ date: d.date, tokens: d.tokens.total }))
        .sort((a, b) => a.date.localeCompare(b.date))
      process.stdout.write(formatDaily(stats, rangeLabel, dailySeries))
    }
  })
}

function sortDailyStats(stats: DailyStats[], sort: SortField): DailyStats[] {
  switch (sort) {
    case 'cost':
      return [...stats].sort((a, b) => b.cost - a.cost)
    case 'tokens':
      return [...stats].sort((a, b) => b.tokens.total - a.tokens.total)
    case 'messages':
      return [...stats].sort((a, b) => b.messageCount - a.messageCount)
    case 'date':
    default:
      return [...stats].sort((a, b) => b.date.localeCompare(a.date))
  }
}
