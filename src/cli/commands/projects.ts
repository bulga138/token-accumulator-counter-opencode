import { Command, Option } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeProjectStats } from '../../aggregator/index.js'
import { formatProjects } from '../../format/visual.js'
import { formatProjectsJson } from '../../format/json.js'
import { formatProjectsCsv } from '../../format/csv.js'
import { formatProjectsMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import type { ProjectStats, SortField } from '../../data/types.js'

export function registerProjectsCommand(program: Command): void {
  const cmd = program
    .command('projects')
    .description('Show per-project token usage breakdown')
    .alias('proj')

  addFilterFlags(cmd).addOption(
    new Option('--sort <field>', 'Sort by field (default: cost)').choices([
      'cost',
      'tokens',
      'messages',
    ])
  )

  cmd.action(async opts => {
    const config = getConfig()
    const format = opts.format ?? config.defaultFormat ?? 'visual'
    const sort = (opts.sort ?? 'cost') as SortField

    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)
    const events = loadUsageEvents(db, filters)
    let stats = computeProjectStats(events)
    stats = sortProjectStats(stats, sort)
    const rangeLabel = buildRangeLabel(opts)
    const hasGateway = !!config.gateway

    if (format === 'json') {
      process.stdout.write(formatProjectsJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatProjectsCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatProjectsMarkdown(stats, rangeLabel, hasGateway) + '\n')
    } else {
      process.stdout.write(formatProjects(stats, rangeLabel, hasGateway))
    }
  })
}

function sortProjectStats(stats: ProjectStats[], sort: SortField): ProjectStats[] {
  switch (sort) {
    case 'tokens':
      return [...stats].sort((a, b) => b.tokens.total - a.tokens.total)
    case 'messages':
      return [...stats].sort((a, b) => b.messageCount - a.messageCount)
    case 'cost':
    default:
      return [...stats].sort((a, b) => b.cost - a.cost)
  }
}
