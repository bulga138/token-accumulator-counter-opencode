import { Command, Option } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents, loadSessions } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeSessionStats } from '../../aggregator/index.js'
import { formatSessions } from '../../format/visual.js'
import { formatSessionsJson } from '../../format/json.js'
import { formatSessionsCsv } from '../../format/csv.js'
import { formatSessionsMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import type { SessionStats, SortField } from '../../data/types.js'

export function registerSessionsCommand(program: Command): void {
  const cmd = program
    .command('sessions')
    .description('List individual sessions with usage stats')
    .alias('s')

  addFilterFlags(cmd)
    .option('--limit <n>', 'Number of sessions to show', '20')
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
    const limit = parseInt(opts.limit ?? '20', 10)
    const sort = (opts.sort ?? 'date') as SortField

    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)
    const events = loadUsageEvents(db, filters)
    const sessions = loadSessions(db, filters)

    let stats = computeSessionStats(events, sessions)

    // Sort
    stats = sortSessions(stats, sort)

    // Limit
    stats = stats.slice(0, limit)

    const rangeLabel = buildRangeLabel(opts)
    const hasGateway = !!config.gateway

    if (format === 'json') {
      process.stdout.write(formatSessionsJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatSessionsCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatSessionsMarkdown(stats, rangeLabel, hasGateway) + '\n')
    } else {
      process.stdout.write(formatSessions(stats, rangeLabel, hasGateway))
    }
  })
}

function sortSessions(sessions: SessionStats[], sort: SortField): SessionStats[] {
  switch (sort) {
    case 'cost':
      return [...sessions].sort((a, b) => b.cost - a.cost)
    case 'tokens':
      return [...sessions].sort((a, b) => b.tokens.total - a.tokens.total)
    case 'messages':
      return [...sessions].sort((a, b) => b.messageCount - a.messageCount)
    case 'date':
    default:
      return [...sessions].sort((a, b) => b.timeCreated - a.timeCreated)
  }
}
