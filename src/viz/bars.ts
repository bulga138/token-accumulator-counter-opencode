import chalk from 'chalk'

const DEFAULT_BAR_WIDTH = 20
const BAR_FULL = '█'
const BAR_EMPTY = ' '

/**
 * Render a proportional bar for a given fraction (0–1).
 * e.g. renderBar(0.712) → "██████████████      "
 *
 * @param width - total bar width in visible characters (default 20).
 *   Pass the column width from the table builder so the bar always fits.
 */
export function renderBar(fraction: number, useColor: boolean, width = DEFAULT_BAR_WIDTH): string {
  const w = Math.max(1, width)
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * w)
  const bar = BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(w - filled)
  if (!useColor) return bar
  if (fraction > 0.75) return chalk.red(bar)
  if (fraction > 0.5) return chalk.yellow(bar)
  return chalk.green(bar)
}

/**
 * Render a delta percent with ▲/▼ and color.
 */
export function renderDelta(delta: number | null, useColor: boolean): string {
  if (delta === null) return '—'
  const sign = delta >= 0 ? '+' : ''
  const text = `${sign}${(delta * 100).toFixed(1)}%`
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '─'
  const full = `${arrow} ${text}`
  if (!useColor) return full
  if (delta > 0.05) return chalk.red(full)
  if (delta < -0.05) return chalk.green(full)
  return chalk.yellow(full)
}
