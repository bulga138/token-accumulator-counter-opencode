import * as asciichart from 'asciichart'
import chalk from 'chalk'
import dayjs from 'dayjs'
import type { DailySeries, ModelStats } from '../data/types.js'

import { formatTokens, formatCost, formatPercent, formatTps } from '../utils/formatting.js'
import { detectTheme } from '../theme/index.js'

const SERIES_COLORS = [
  asciichart.cyan,
  asciichart.yellow,
  asciichart.magenta,
  asciichart.green,
  asciichart.red,
  asciichart.blue,
] as const

const CHALK_COLORS = [
  chalk.cyan,
  chalk.yellow,
  chalk.magenta,
  chalk.green,
  chalk.red,
  chalk.blue,
] as const

const Y_LABEL_WIDTH = 8 // e.g. " 123.4M" — fixed so all rows stay aligned

/**
 * Render a multi-series daily token chart using asciichart.
 *
 * Each series is mapped onto a real calendar timeline so data is spread
 * correctly left-to-right. Gaps between active days are zero — no
 * interpolation — so each model's peaks appear as clean distinct spikes.
 *
 * asciichart already draws its own bottom baseline row ("0 ┼────").
 * We append only the x-axis date labels below it.
 */
export function renderChart(
  series: Array<{ modelId: string; data: DailySeries[] }>,
  width = 62,
  height = 8,
  useColor = true
): string[] {
  if (series.length === 0) return ['(no data)']

  // ── 1. Unified calendar range ─────────────────────────────────────────────
  const allDates = Array.from(new Set(series.flatMap(s => s.data.map(d => d.date)))).sort()

  if (allDates.length === 0) return ['(no data)']

  const firstDay = dayjs(allDates[0])
  const lastDay = dayjs(allDates[allDates.length - 1])
  const spanDays = Math.max(1, lastDay.diff(firstDay, 'day'))

  // Inner chart width = total width minus the y-label gutter
  const numCols = Math.max(10, width - Y_LABEL_WIDTH - 2)

  // ── 2. Zero-filled column arrays — one per series ─────────────────────────
  // Each data point is placed at its proportional calendar column.
  // Multiple dates that map to the same column are summed.
  const seriesArrays: number[][] = series.map(s => {
    const arr = Array<number>(numCols).fill(0)
    for (const { date, tokens } of s.data) {
      const dayOffset = dayjs(date).diff(firstDay, 'day')
      const col = Math.round((dayOffset / spanDays) * (numCols - 1))
      arr[col] += tokens
    }
    return arr
  })

  // ── 3. Render via asciichart ──────────────────────────────────────────────
  const cfg: Record<string, unknown> = {
    height,
    min: 0, // never show negative axis values for token counts
    colors: useColor ? Array.from(SERIES_COLORS).slice(0, series.length) : [],
    format: (v: number) => formatTokens(Math.round(v)).padStart(Y_LABEL_WIDTH),
  }

  const chartStr: string = asciichart.plot(seriesArrays, cfg)

  // Strip blank trailing lines. asciichart's last non-empty line is already
  // the "0 ┼────" baseline row — we do NOT add another rule on top of that.
  const chartLines = chartStr.split('\n').filter(l => l.length > 0)

  // ── 4. x-axis date labels only (no extra rule) ───────────────────────────
  chartLines.push(buildXLabels(firstDay, lastDay, Y_LABEL_WIDTH + 2, numCols))

  return chartLines
}

/**
 * Render a single-series total-tokens chart for the overview screen.
 */
export function renderTotalChart(
  daily: DailySeries[],
  width = 62,
  height = 6,
  useColor = true
): string[] {
  return renderChart([{ modelId: 'total', data: daily }], width, height, useColor)
}

/**
 * Render one panel per model, stacked vertically.
 * Each panel has: coloured header → mini chart → inline stats row.
 * All panels share the same x-axis timeline; each has its own y-scale.
 */
export function renderModelPanels(
  models: ModelStats[],
  width = 62,
  height = 4,
  useColor = true
): string[] {
  if (models.length === 0) return ['(no data)']

  // Unified calendar range so every panel's x-axis aligns
  const allDates = Array.from(new Set(models.flatMap(m => m.dailySeries.map(d => d.date)))).sort()

  if (allDates.length === 0) return ['(no data)']

  const firstDay = dayjs(allDates[0])
  const lastDay = dayjs(allDates[allDates.length - 1])
  const spanDays = Math.max(1, lastDay.diff(firstDay, 'day'))
  const numCols = Math.max(10, width - Y_LABEL_WIDTH - 2)

  const lines: string[] = []

  for (let si = 0; si < models.length; si++) {
    const model = models[si]
    const color = useColor
      ? (CHALK_COLORS[si % CHALK_COLORS.length] ?? ((s: string) => s))
      : (s: string) => s

    // ── Column array for this model ────────────────────────────────────────
    const arr = Array<number>(numCols).fill(0)
    for (const { date, tokens } of model.dailySeries) {
      const dayOffset = dayjs(date).diff(firstDay, 'day')
      const col = Math.round((dayOffset / spanDays) * (numCols - 1))
      arr[col] += tokens
    }

    // ── Panel header: ● ModelName (provider)  share%  ─────────────────────
    const bullet = color('●')
    const pct = formatPercent(model.percentage)
    const display = `${model.modelId} (${model.providerId})`
    lines.push(`  ${bullet} ${display}  ${pct}`)

    // ── Mini chart ─────────────────────────────────────────────────────────
    const chartStr: string = asciichart.plot([arr], {
      height,
      min: 0,
      colors: useColor ? [SERIES_COLORS[si % SERIES_COLORS.length]] : [],
      format: (v: number) => formatTokens(Math.round(v)).padStart(Y_LABEL_WIDTH),
    } as Record<string, unknown>)

    for (const cl of chartStr.split('\n').filter(l => l.length > 0)) {
      lines.push('  ' + cl)
    }

    // ── Inline stats row ───────────────────────────────────────────────────
    // On light backgrounds chalk.dim makes text nearly invisible; use muted
    // gray instead, which is readable on both dark and light terminals.
    const dim = (s: string) => {
      if (!useColor) return s
      return detectTheme() === 'light' ? chalk.hex('#757575')(s) : chalk.dim(s)
    }
    const indent = '  ' + ' '.repeat(Y_LABEL_WIDTH + 2)

    const costStr = model.billedExternally ? 'billed via plan' : formatCost(model.cost)
    const statParts: string[] = [
      `${dim('Cost:')} ${costStr}`,
      `${dim('In:')} ${formatTokens(model.tokens.input)}`,
      `${dim('Out:')} ${formatTokens(model.tokens.output)}`,
      `${dim('Cache:')} ${formatTokens(model.tokens.cacheRead)}`,
      `${dim('Msgs:')} ${model.messageCount}`,
    ]
    if (model.medianOutputTps !== null) {
      statParts.push(`${dim('Speed:')} ${formatTps(model.medianOutputTps)}`)
    }
    lines.push(indent + statParts.join('  '))

    // ── x-axis date labels only on the last panel ──────────────────────────
    if (si === models.length - 1) {
      lines.push('  ' + buildXLabels(firstDay, lastDay, Y_LABEL_WIDTH + 2, numCols))
    }

    lines.push('') // blank gap between panels
  }

  return lines
}

/**
 * Render series legend: "● ModelA · ● ModelB"
 */
export function renderLegend(models: string[], useColor: boolean): string {
  return models
    .map((m, i) => {
      const color = useColor
        ? (CHALK_COLORS[i % CHALK_COLORS.length] ?? ((s: string) => s))
        : (s: string) => s
      return `${color('●')} ${m}`
    })
    .join(' · ')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildXLabels(
  firstDay: dayjs.Dayjs,
  lastDay: dayjs.Dayjs,
  offset: number,
  innerWidth: number
): string {
  const spanDays = Math.max(1, lastDay.diff(firstDay, 'day'))
  const numLabels = Math.min(4, Math.max(2, Math.floor(innerWidth / 10)))
  const buf = Array<string>(offset + innerWidth + 10).fill(' ')

  for (let i = 0; i < numLabels; i++) {
    const frac = i / Math.max(1, numLabels - 1)
    const date = firstDay.add(Math.round(frac * spanDays), 'day')
    const label = date.format('MMM D')
    const col = Math.round(frac * (innerWidth - 1))
    const start = offset + col - Math.floor(label.length / 2)
    for (let k = 0; k < label.length; k++) {
      if (start + k >= 0 && start + k < buf.length) buf[start + k] = label[k]!
    }
  }

  return buf.join('')
}
