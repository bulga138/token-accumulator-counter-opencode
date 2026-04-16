import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeModelStats } from '../../aggregator/index.js'
import { formatModels } from '../../format/visual.js'
import { formatModelsJson } from '../../format/json.js'
import { formatModelsCsv } from '../../format/csv.js'
import { formatModelsMarkdown } from '../../format/markdown.js'
import { addFilterFlags, buildRangeLabel } from '../filters.js'
import { getConfig } from '../../config/index.js'
import type { ModelStats, SortField } from '../../data/types.js'

export function registerModelsCommand(program: Command): void {
  const cmd = program
    .command('models')
    .description('Show per-model token usage and cost breakdown')
    .alias('m')

  addFilterFlags(cmd)
    .option('--sort <field>', 'Sort by: cost, tokens, messages (default: tokens)')

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
    let stats = computeModelStats(events)
    stats = sortModelStats(stats, sort)
    const rangeLabel = buildRangeLabel(opts)

    if (format === 'json') {
      process.stdout.write(formatModelsJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatModelsCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatModelsMarkdown(stats, rangeLabel) + '\n')
    } else {
      process.stdout.write(formatModels(stats, rangeLabel))
    }
  })
}

function sortModelStats(stats: ModelStats[], sort: SortField): ModelStats[] {
  switch (sort) {
    case 'cost': return [...stats].sort((a, b) => b.cost - a.cost)
    case 'messages': return [...stats].sort((a, b) => b.messageCount - a.messageCount)
    case 'tokens':
    default: return [...stats].sort((a, b) => b.tokens.total - a.tokens.total)
  }
}
