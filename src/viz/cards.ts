import chalk from 'chalk'
import type { ModelStats } from '../data/types.js'
import {
  formatTokens,
  formatCost,
  formatEstimatedCost,
  formatPercent,
  formatTps,
} from '../utils/formatting.js'

const MODEL_COLORS = [chalk.cyan, chalk.yellow, chalk.magenta, chalk.green, chalk.red, chalk.blue]

/**
 * Render per-model stats as a 2-column card grid.
 */
export function renderModelCards(models: ModelStats[], useColor: boolean): string[] {
  const lines: string[] = []
  const cols = 2

  for (let i = 0; i < models.length; i += cols) {
    const left = models[i]
    const right = models[i + 1] ?? null

    const leftCard = renderCard(left, i, useColor)
    const rightCard = right ? renderCard(right, i + 1, useColor) : null

    const maxLines = Math.max(leftCard.length, rightCard?.length ?? 0)

    for (let l = 0; l < maxLines; l++) {
      const leftLine = (leftCard[l] ?? '').padEnd(44)
      const rightLine = rightCard ? (rightCard[l] ?? '') : ''
      lines.push(leftLine + rightLine)
    }

    if (i + cols < models.length) lines.push('')
  }

  return lines
}

function renderCard(model: ModelStats, index: number, useColor: boolean): string[] {
  const color = MODEL_COLORS[index % MODEL_COLORS.length]
  const bullet = useColor ? color('●') : '●'
  const pct = formatPercent(model.percentage)
  const header = `${bullet} ${model.modelId} (${pct})`
  const tokens = `  In: ${formatTokens(model.tokens.input)} · Out: ${formatTokens(model.tokens.output)}`
  const costStr = model.billedExternally
    ? 'billed via plan'
    : model.costEstimated
      ? formatEstimatedCost(model.cost)
      : formatCost(model.cost)
  const cost = `  Cost: ${costStr}`
  const via = `  via ${model.providerId}`

  const lines = [header, tokens, cost, via]

  if (model.medianOutputTps !== null) {
    lines.push(`  Speed: ${formatTps(model.medianOutputTps)}`)
  }

  return lines
}
