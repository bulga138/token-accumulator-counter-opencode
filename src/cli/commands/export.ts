import { Command, Argument } from 'commander'
import { writeFileSync } from 'node:fs'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents, loadSessions } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import {
  computeOverview,
  computeModelStats,
  computeProviderStats,
  computeDailyStats,
  computeProjectStats,
  computeSessionStats,
  computeAgentStats,
  computeHeatmap,
} from '../../aggregator/index.js'
import { addFilterFlags } from '../filters.js'
import { getConfig } from '../../config/index.js'

type ExportTarget =
  | 'overview'
  | 'models'
  | 'providers'
  | 'daily'
  | 'projects'
  | 'sessions'
  | 'agents'

export function registerExportCommand(program: Command): void {
  const cmd = program
    .command('export')
    .description('Export raw data to stdout or a file')
    .addArgument(
      new Argument('[target]', 'Data to export').choices([
        'overview',
        'models',
        'providers',
        'daily',
        'projects',
        'sessions',
        'agents',
      ])
    )
    .alias('e')

  addFilterFlags(cmd).option('--output <path>', 'Output file path (default: stdout)')

  cmd.action(async (target: string | undefined, opts) => {
    const config = getConfig()
    const format = opts.format ?? 'json'
    const exportTarget = (target ?? 'overview') as ExportTarget

    if (!opts.from && config.defaultRange && config.defaultRange !== 'all') {
      opts.from = config.defaultRange
    }

    const filters = buildFilters(opts)
    const db = await getDbAsync(opts.db ?? config.db)
    const events = loadUsageEvents(db, filters)
    const sessions = loadSessions(db, filters)

    let output = ''

    if (format === 'json') {
      const data = buildExportData(exportTarget, events, sessions)
      output = JSON.stringify(data, null, 2)
    } else if (format === 'csv') {
      // Delegate to csv formatters
      const { formatModelsCsv } = await import('../../format/csv.js')
      const { formatProvidersCsv } = await import('../../format/csv.js')
      const { formatDailyCsv } = await import('../../format/csv.js')
      const { formatProjectsCsv } = await import('../../format/csv.js')
      const { formatSessionsCsv } = await import('../../format/csv.js')
      const { formatAgentsCsv } = await import('../../format/csv.js')

      switch (exportTarget) {
        case 'models':
          output = formatModelsCsv(computeModelStats(events))
          break
        case 'providers':
          output = formatProvidersCsv(computeProviderStats(events))
          break
        case 'daily':
          output = formatDailyCsv(computeDailyStats(events))
          break
        case 'projects':
          output = formatProjectsCsv(computeProjectStats(events))
          break
        case 'sessions':
          output = formatSessionsCsv(computeSessionStats(events, sessions))
          break
        case 'agents':
          output = formatAgentsCsv(computeAgentStats(events))
          break
        default:
          console.error("CSV export for 'overview' is not supported. Use --format json.")
          process.exit(1)
      }
    } else {
      console.error(`Unsupported export format: ${format}. Use json or csv.`)
      process.exit(1)
    }

    if (opts.output) {
      writeFileSync(opts.output, output, 'utf-8')
      console.log(`Exported to ${opts.output}`)
    } else {
      process.stdout.write(output + '\n')
    }
  })
}

function buildExportData(
  target: ExportTarget,
  events: ReturnType<typeof loadUsageEvents>,
  sessions: ReturnType<typeof loadSessions>
) {
  switch (target) {
    case 'overview': {
      const heatmap = computeHeatmap(events)
      return {
        overview: computeOverview(events, sessions),
        heatmap,
      }
    }
    case 'models':
      return computeModelStats(events)
    case 'providers':
      return computeProviderStats(events)
    case 'daily':
      return computeDailyStats(events)
    case 'projects':
      return computeProjectStats(events)
    case 'sessions':
      return computeSessionStats(events, sessions)
    case 'agents':
      return computeAgentStats(events)
  }
}
