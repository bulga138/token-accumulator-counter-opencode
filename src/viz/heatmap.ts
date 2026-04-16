import chalk from 'chalk'
import dayjs from 'dayjs'
import type { HeatmapDay } from '../aggregator/index.js'

// · = tracked day with zero activity; ░▒▓█ = rising fill levels
const SHADES = ['·', '░', '▒', '▓', '█'] as const

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// Mon–Fri only; each label is 3 chars → with 2 trailing spaces = 5-char gutter
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WEEKDAY_DOWS = [1, 2, 3, 4, 5] // 0 = Sun … 6 = Sat

const GUTTER = 5 // "Mon  " → 3 + 2 = 5

export function renderHeatmap(days: HeatmapDay[], useColor: boolean): string[] {
  if (days.length !== 365) {
    throw new Error(`Expected 365 days, got ${days.length}`)
  }

  const firstDow = dayjs(days[0].date).day() // 0 = Sunday

  // Pad front so columns align on Sunday-week boundaries
  const padded: (HeatmapDay | null)[] = [...Array<null>(firstDow).fill(null), ...days]

  const numWeeks = Math.ceil(padded.length / 7)

  // Build one row per weekday (Mon … Fri)
  const rows: (HeatmapDay | null)[][] = WEEKDAY_DOWS.map(dow =>
    Array.from({ length: numWeeks }, (_, w) => padded[w * 7 + dow] ?? null)
  )

  const lines: string[] = []

  // ── Month header ────────────────────────────────────────────────────────────
  lines.push(' '.repeat(GUTTER) + buildMonthRow(days, firstDow, numWeeks, useColor))

  // ── Weekday data rows ───────────────────────────────────────────────────────
  for (let r = 0; r < WEEKDAY_LABELS.length; r++) {
    const label = WEEKDAY_LABELS[r]
    const cells = rows[r].map(d => shadeCell(d, useColor)).join('')
    lines.push(`${label}  ${cells}`)
  }

  lines.push('')

  // ── Legend ──────────────────────────────────────────────────────────────────
  // Distinguish padding (blank = outside range) from zero-activity (·)
  const [s0, s1, s2, s3, s4] = useColor
    ? [
        chalk.dim('·'),
        chalk.green('░'),
        chalk.greenBright('▒'),
        chalk.yellow('▓'),
        chalk.bold.yellow('█'),
      ]
    : ['·', '░', '▒', '▓', '█']

  lines.push(' '.repeat(GUTTER) + `${s0} no activity  ${s1}${s2}${s3}${s4} low → high`)

  return lines
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function shadeCell(day: HeatmapDay | null, useColor: boolean): string {
  if (!day) return ' ' // padding slot — outside the 365-day window

  const char = SHADES[day.intensity]
  if (!useColor) return char

  switch (day.intensity) {
    case 0:
      return chalk.dim('·')
    case 1:
      return chalk.green('░')
    case 2:
      return chalk.greenBright('▒')
    case 3:
      return chalk.yellow('▓')
    case 4:
      return chalk.bold.yellow('█')
    default:
      return char
  }
}

// ── Month header builder ──────────────────────────────────────────────────────

/**
 * Place 3-char month abbreviations above their respective columns.
 *
 * Bug fix: the original algorithm placed the first partial month's label at
 * col 0 and advanced nextFreeCol to 4, silently blocking the second month
 * (e.g. Apr at col 0 → May at col 2 gets skipped).
 *
 * Fix: if the first month occupies fewer than 4 week-columns before the
 * second month begins, drop its label entirely so downstream months are
 * never blocked.  This is safe because a partial month at the far left is
 * usually only 1–2 columns wide and its label would misleadingly hover over
 * mostly-empty cells anyway.
 */
function buildMonthRow(
  days: HeatmapDay[],
  firstDow: number,
  numWeeks: number,
  useColor: boolean
): string {
  interface MonthBoundary {
    month: number
    col: number
  }
  const boundaries: MonthBoundary[] = []
  let prevYM: number | null = null

  for (let w = 0; w < numWeeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const idx = w * 7 + dow - firstDow
      if (idx >= 0 && idx < days.length) {
        const d = dayjs(days[idx].date)
        const ym = d.year() * 12 + d.month()
        if (ym !== prevYM) {
          boundaries.push({ month: d.month(), col: w })
          prevYM = ym
          // ↑ No break here. Scanning all 7 days lets us catch mid-week month
          // transitions (e.g. Jul 1 on a Tuesday) at the correct week column.
          // The old break stopped at Jun 29 (Sunday) and pushed Jul to the
          // following week, producing the extra space in "Jun  Jul".
        }
      }
    }
  }

  const buf: string[] = Array<string>(numWeeks).fill(' ')
  let nextFreeCol = 0

  for (let i = 0; i < boundaries.length; i++) {
    const { month, col } = boundaries[i]

    // Blocked by a previously placed label
    if (col < nextFreeCol) continue
    // Label would overflow the right edge
    if (col + 3 > numWeeks) continue

    // This month is too narrow to label without stealing the next month's slot.
    // Only applies when there IS a next month — the last month only needs the
    // edge check above (fixes the original "Apr at end" drop).
    const hasNext = i + 1 < boundaries.length
    if (hasNext && boundaries[i + 1].col - col < 4) continue

    const abbr = MONTH_ABBR[month]
    buf[col] = abbr[0]!
    buf[col + 1] = abbr[1]!
    buf[col + 2] = abbr[2]!
    nextFreeCol = col + 4 // 3 chars + 1 mandatory gap
  }

  const plain = buf.join('')
  return useColor ? plain.replace(/[A-Z][a-z]{2}/g, m => chalk.bold(m)) : plain
}

// ─── Mini heatmap (variable length, no month header) ─────────────────────────

/**
 * Compact heatmap for short windows (e.g. last 30 days).
 *
 * Unlike `renderHeatmap()` this accepts any number of days, skips the month
 * header (too sparse at 4-5 weeks), and uses the same Mon-Fri cell grid.
 * Suitable for TUI sidebars and summary panels.
 */
export function renderMiniHeatmap(days: HeatmapDay[], useColor: boolean): string[] {
  if (days.length === 0) return []

  const firstDow = dayjs(days[0]!.date).day() // 0 = Sunday

  // Pad front so columns align on Sunday-week boundaries
  const padded: (HeatmapDay | null)[] = [...Array<null>(firstDow).fill(null), ...days]
  const numWeeks = Math.ceil(padded.length / 7)

  // Build one row per weekday (Mon … Fri)
  const rows: (HeatmapDay | null)[][] = WEEKDAY_DOWS.map(dow =>
    Array.from({ length: numWeeks }, (_, w) => padded[w * 7 + dow] ?? null)
  )

  const lines: string[] = []

  for (let r = 0; r < WEEKDAY_LABELS.length; r++) {
    const label = WEEKDAY_LABELS[r]!
    const cells = rows[r]!.map(d => shadeCell(d, useColor)).join('')
    lines.push(`${label}  ${cells}`)
  }

  // Legend
  const [s0, s1, s2, s3, s4] = useColor
    ? [
        chalk.dim('·'),
        chalk.green('░'),
        chalk.greenBright('▒'),
        chalk.yellow('▓'),
        chalk.bold.yellow('█'),
      ]
    : ['·', '░', '▒', '▓', '█']
  lines.push(`${' '.repeat(GUTTER)}${s0} no activity  ${s1}${s2}${s3}${s4} low → high`)

  return lines
}
