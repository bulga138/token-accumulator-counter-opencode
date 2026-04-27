import { Command, Option } from 'commander'
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
import { formatCost, formatEstimatedCost, formatTokens } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'
import type { ModelStats, SortField } from '../../data/types.js'
import { fetchModelSpend, getCurrentBillingPeriod } from '../../data/gateway-litellm.js'
import { aggregateModelSpend, normalizeModelName } from '../../utils/model-names.js'
import chalk from 'chalk'

export function registerModelsCommand(program: Command): void {
  const cmd = program
    .command('models')
    .description('Show per-model token usage and cost breakdown')
    .alias('m')

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
    let stats = computeModelStats(events)
    stats = sortModelStats(stats, sort)
    const rangeLabel = buildRangeLabel(opts)

    // Fetch gateway model spend if gateway is configured
    let gatewaySpend: Map<string, number> | null = null
    if (config.gateway) {
      const { startDate, endDate } = getCurrentBillingPeriod()
      const result = await fetchModelSpend(config.gateway, startDate, endDate)
      if (result && result.modelSpend.length > 0) {
        // Aggregate by normalized name (multiple providers → one logical model)
        const rawMap: Record<string, number> = {}
        for (const { model, spend } of result.modelSpend) {
          rawMap[model] = (rawMap[model] ?? 0) + spend
        }
        gatewaySpend = aggregateModelSpend(rawMap)
      }
    }

    if (format === 'json') {
      process.stdout.write(formatModelsJson(stats) + '\n')
    } else if (format === 'csv') {
      process.stdout.write(formatModelsCsv(stats) + '\n')
    } else if (format === 'markdown') {
      process.stdout.write(formatModelsMarkdown(stats, rangeLabel) + '\n')
    } else {
      if (gatewaySpend) {
        process.stdout.write(formatModelsWithGateway(stats, gatewaySpend, rangeLabel))
      } else {
        process.stdout.write(formatModels(stats, rangeLabel))
      }
    }
  })
}

function sortModelStats(stats: ModelStats[], sort: SortField): ModelStats[] {
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

// ─── Gateway cost column renderer ─────────────────────────────────────────────

function formatModelsWithGateway(
  stats: ModelStats[],
  gatewaySpend: Map<string, number>,
  rangeLabel: string
): string {
  const COLORS = getColors()
  const useColor = process.stdout.isTTY !== false

  const header = useColor
    ? `\n${COLORS.header.bold('TACO')} — Models${rangeLabel ? ` · ${rangeLabel}` : ''}\n`
    : `\nTACO — Models${rangeLabel ? ` · ${rangeLabel}` : ''}\n`

  const lines: string[] = [header]

  if (stats.length === 0) {
    lines.push('  No model data for this range.\n')
    return lines.join('\n')
  }

  // Column widths
  const MODEL_W = 36
  const TOKENS_W = 10
  const LOCAL_W = 12
  const GW_W = 14
  const SHARE_W = 7

  const dim = (s: string) => (useColor ? chalk.dim(s) : s)
  const bold = (s: string) => (useColor ? chalk.bold(s) : s)

  // Header row
  lines.push(
    '  ' +
      dim('Model'.padEnd(MODEL_W)) +
      dim('Tokens'.padStart(TOKENS_W)) +
      dim('Local Cost'.padStart(LOCAL_W)) +
      dim('Gateway Cost'.padStart(GW_W)) +
      dim('Share'.padStart(SHARE_W))
  )
  lines.push('  ' + dim('─'.repeat(MODEL_W + TOKENS_W + LOCAL_W + GW_W + SHARE_W)))

  let totalLocal = 0
  let totalGateway = 0

  for (const m of stats) {
    const normalized = normalizeModelName(m.modelId)

    // Look up gateway spend — try exact normalized match first, then prefix match
    let gwCost: number | undefined = gatewaySpend.get(normalized)
    if (gwCost === undefined) {
      // Try all keys and find the best match
      for (const [key, val] of gatewaySpend) {
        const normalizedKey = normalizeModelName(key)
        if (
          normalizedKey === normalized ||
          normalizedKey.startsWith(normalized) ||
          normalized.startsWith(normalizedKey)
        ) {
          gwCost = (gwCost ?? 0) + val
        }
      }
    }

    totalLocal += m.cost
    totalGateway += gwCost ?? 0

    // Pad plain string before applying dim() so ANSI bytes don't skew padStart()
    const gwStr = gwCost !== undefined ? formatCost(gwCost) : '—'
    const pct = `${(m.percentage * 100).toFixed(1)}%`

    const modelDisplay = (
      m.modelId.length > MODEL_W - 1 ? m.modelId.slice(0, MODEL_W - 2) + '…' : m.modelId
    ).padEnd(MODEL_W)

    // Apply dim to '—' after padding so the padding width is computed on the plain string
    const gwCell =
      gwCost !== undefined
        ? gwStr.padStart(GW_W)
        : useColor
          ? dim(gwStr.padStart(GW_W))
          : gwStr.padStart(GW_W)
    const localCostStr = m.costEstimated ? formatEstimatedCost(m.cost) : formatCost(m.cost)
    lines.push(
      '  ' +
        (useColor ? COLORS.value(modelDisplay) : modelDisplay) +
        formatTokens(m.tokens.total).padStart(TOKENS_W) +
        localCostStr.padStart(LOCAL_W) +
        gwCell +
        pct.padStart(SHARE_W)
    )
  }

  // Totals row
  lines.push('  ' + dim('─'.repeat(MODEL_W + TOKENS_W + LOCAL_W + GW_W + SHARE_W)))
  const totalTokens = stats.reduce((s, m) => s + m.tokens.total, 0)
  // Pad the plain strings BEFORE applying color/bold so ANSI escape bytes
  // don't inflate the length that padStart/padEnd measures.
  lines.push(
    '  ' +
      bold('Total'.padEnd(MODEL_W)) +
      formatTokens(totalTokens).padStart(TOKENS_W) +
      bold(formatCost(totalLocal).padStart(LOCAL_W)) +
      (useColor
        ? chalk.green(formatCost(totalGateway).padStart(GW_W))
        : formatCost(totalGateway).padStart(GW_W)) +
      ''.padStart(SHARE_W)
  )

  // Gateway vs local diff note
  const diff = totalLocal - totalGateway
  if (totalGateway > 0) {
    const diffStr =
      diff > 0
        ? dim(`(+${formatCost(diff)} local vs gateway — local estimates are higher)`)
        : dim(`(${formatCost(Math.abs(diff))} local vs gateway)`)
    lines.push(`\n  ${diffStr}`)
  }

  // Unmatched gateway models (spend on models not in local DB)
  const localNormalized = new Set(stats.map(m => normalizeModelName(m.modelId)))
  const unmatched: Array<[string, number]> = []
  for (const [gwModel, gwSpend] of gatewaySpend) {
    const normalized = normalizeModelName(gwModel)
    let matched = false
    for (const local of localNormalized) {
      if (local === normalized || local.startsWith(normalized) || normalized.startsWith(local)) {
        matched = true
        break
      }
    }
    if (!matched && gwSpend > 0.001) {
      unmatched.push([gwModel, gwSpend])
    }
  }

  if (unmatched.length > 0) {
    lines.push(dim('\n  Gateway spend on models not in local DB (different period or user):'))
    for (const [model, spend] of unmatched.sort((a, b) => b[1] - a[1])) {
      lines.push(dim(`    ${model.padEnd(40)} ${formatCost(spend)}`))
    }
  }

  lines.push('\n')
  return lines.join('\n')
}
