import { Command, Option } from 'commander'

/**
 * Attach the shared filter flags to a Commander command.
 */
export function addFilterFlags(cmd: Command): Command {
  return cmd
    .option('--from <date>', 'Start date (ISO 8601 or relative: 7d, 30d, 1w, 3m)')
    .option('--to <date>', 'End date (ISO 8601 or relative)')
    .option('--model <name>', 'Filter to a specific model')
    .option('--provider <name>', 'Filter to a specific provider')
    .option('--project <path>', 'Filter to a specific project directory')
    .option('--agent <type>', 'Filter by agent type (build, plan, explore)')
    .addOption(
      new Option('--format <format>', 'Output format (default: visual)').choices([
        'visual',
        'json',
        'csv',
        'markdown',
      ])
    )
    .option('--db <path>', 'Override OpenCode database path')
}

/**
 * Build a human-readable range label from filter options.
 */
export function buildRangeLabel(opts: { from?: string; to?: string }): string {
  if (opts.from && opts.to) return `${opts.from} → ${opts.to}`
  if (opts.from) return `From ${opts.from}`
  if (opts.to) return `Until ${opts.to}`
  return 'All time'
}
