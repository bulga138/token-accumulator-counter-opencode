import { Command, Option } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeProviderStats } from '../../aggregator/index.js'
import { formatProviders } from '../../format/visual.js'
import { formatProvidersJson } from '../../format/json.js'
import { formatProvidersCsv } from '../../format/csv.js'
import { formatProviderMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import { fetchGatewayMetrics } from '../../data/gateway.js'
import type { ProviderStats, SortField } from '../../data/types.js'

export function registerProvidersCommand(program: Command): void {
  const cmd = program
    .command('providers')
    .description('Show per-provider token usage breakdown')
    .alias('p')

  addFilterFlags(cmd).addOption(
    new Option('--sort <field>', 'Sort by field (default: tokens)').choices([
      'cost',
      'tokens',
      'messages',
    ])
  )

  cmd.action(async opts => {
    const config = getConfig()
    const format = opts.format ?? config.defaultFormat ?? 'visual'
    const sort = (opts.sort ?? 'tokens') as SortField

    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)
    const events = loadUsageEvents(db, filters)
    let stats = computeProviderStats(events)
    stats = sortProviderStats(stats, sort)
    const rangeLabel = buildRangeLabel(opts)

    const gw =
      format === 'visual' && config.gateway ? await fetchGatewayMetrics(config.gateway) : null

    if (format === 'json') {
      process.stdout.write(formatProvidersJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatProvidersCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatProviderMarkdown(stats, rangeLabel) + '\n')
    } else {
      process.stdout.write(formatProviders(stats, rangeLabel, gw?.totalSpend))
    }
  })
}

function sortProviderStats(stats: ProviderStats[], sort: SortField): ProviderStats[] {
  switch (sort) {
    case 'cost':
      return [...stats].sort((a, b) => b.cost - a.cost)
    case 'messages':
      return [...stats].sort((a, b) => b.messageCount - a.messageCount)
    case 'tokens':
    default:
      return [...stats].sort((a, b) => b.tokens.total - a.tokens.total)
  }
}
