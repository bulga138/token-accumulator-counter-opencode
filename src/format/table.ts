import chalk from 'chalk'
import { truncate } from '../utils/formatting.js'
import { getColors } from '../theme/index.js'

// ---------------------------------------------------------------------------
// ANSI-aware string helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences so we can measure visible character width. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFJA-Z]/g

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '')
}

/** Visible (printed) length of a string, ignoring ANSI codes. */
function visLen(str: string): number {
  return stripAnsi(str).length
}

/**
 * Pad a (possibly ANSI-colored) string to exactly `len` visible chars.
 * Right-pads with spaces.  Truncates plain-text overflow with "…".
 * Colored strings are never cut (they already contain invisible escape bytes
 * that would be mutilated by slicing) — the caller is expected to keep them
 * short (bar charts, delta arrows, etc. are always ≤ their column width).
 */
function cellPadEnd(str: string, len: number): string {
  const vl = visLen(str)
  if (vl > len) return truncate(stripAnsi(str), len) // strip color, then truncate
  if (vl === len) return str
  return str + ' '.repeat(len - vl)
}

/**
 * Left-pad a (possibly ANSI-colored) string to exactly `len` visible chars.
 */
function cellPadStart(str: string, len: number): string {
  const vl = visLen(str)
  if (vl > len) return truncate(stripAnsi(str), len)
  if (vl === len) return str
  return ' '.repeat(len - vl) + str
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A column definition for buildTable().
 *
 * width     — fixed visible-char width, or 'flex' to absorb remaining space.
 *             Only one flex column per table (typically the label / name col).
 * minWidth  — minimum visible width for the flex column (default 8).
 * maxWidth  — maximum visible width for the flex column.  The column will NOT
 *             expand beyond this even if the terminal is very wide — extra
 *             space is simply left unused, keeping the table compact.
 * priority  — columns with higher numbers are dropped first when the terminal
 *             is too narrow.  Omit (or 0) to never drop.
 * render    — returns the cell string (may include ANSI color codes).
 *             The second argument is the resolved column width in visible chars,
 *             useful for bar charts that need to fill exactly their slot.
 */
export interface TableColumn<T> {
  header: string
  align: 'left' | 'right'
  width: number | 'flex'
  minWidth?: number
  maxWidth?: number
  priority?: number
  render: (row: T, resolvedWidth?: number) => string
}

const INDENT = 2 // leading spaces on every line
const GAP = 2 // spaces between adjacent columns

/**
 * Build a responsive terminal table.
 *
 * Returns an array of lines (bold header, divider, data rows).
 * Lines are already indented by INDENT spaces.
 *
 * Layout algorithm
 * ─────────────────
 * 1. Sum widths of all fixed columns + gaps.
 * 2. Remaining space = terminalWidth − INDENT − fixedTotal.
 * 3. While remaining < flex.minWidth, drop the highest-priority droppable col.
 * 4. Clamp flex to [minWidth, maxWidth].  Do NOT pad the row to fill the
 *    terminal — the table is only as wide as its content needs to be.
 */
export function buildTable<T>(
  columns: TableColumn<T>[],
  rows: T[],
  opts: {
    useColor?: boolean
    terminalWidth?: number
    /**
     * Alternate a subtle background tint on even data rows to make dense
     * tables easier to track horizontally.  Defaults to true when useColor
     * is true.  Set to false to disable (e.g. in tests or --plain mode).
     */
    stripe?: boolean
  } = {}
): string[] {
  const useColor = opts.useColor ?? process.stdout.isTTY !== false
  const terminalWidth = opts.terminalWidth ?? (process.stdout.columns || 80)
  const colors = useColor ? getColors() : null
  const doStripe = useColor && (opts.stripe ?? true)

  // ── 1. Drop low-priority columns until the flex column fits ─────────────────
  let activeCols = [...columns]

  /** Index of the flex column in activeCols (-1 if none). */
  const flexIdx = (): number => activeCols.findIndex(c => c.width === 'flex')

  /**
   * Total space consumed by fixed columns + all column gaps.
   * Includes the gap to the right of the flex column (if it isn't last).
   */
  const fixedTotal = (): number => {
    const n = activeCols.length
    let sum = 0
    for (let i = 0; i < n; i++) {
      const c = activeCols[i]!
      if (c.width !== 'flex') sum += c.width as number
      if (i < n - 1) sum += GAP // gap between this col and the next
    }
    return sum
  }

  const flexMin = (c: TableColumn<T>): number => c.minWidth ?? 8

  while (true) {
    const fi = flexIdx()
    if (fi === -1) break
    const available = terminalWidth - INDENT - fixedTotal()
    if (available >= flexMin(activeCols[fi]!)) break

    const droppable = activeCols
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => i !== fi && (c.priority ?? 0) > 0)
      .sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0))

    if (droppable.length === 0) break
    activeCols = activeCols.filter((_, i) => i !== droppable[0]!.i)
  }

  // ── 2. Resolve column widths ─────────────────────────────────────────────────
  const fi = flexIdx()
  const resolvedWidths: number[] = activeCols.map((c, i) => {
    if (i !== fi) return c.width as number
    const available = terminalWidth - INDENT - fixedTotal()
    const min = flexMin(c)
    const max = c.maxWidth ?? available
    return Math.max(min, Math.min(max, available))
  })

  // ── 3. Render a single row ───────────────────────────────────────────────────
  const renderRow = (cells: string[]): string =>
    activeCols
      .map((col, i) => {
        const w = resolvedWidths[i]!
        const raw = cells[i] ?? ''
        return col.align === 'right' ? cellPadStart(raw, w) : cellPadEnd(raw, w)
      })
      .join(' '.repeat(GAP))

  // ── 4. Emit lines ────────────────────────────────────────────────────────────
  const lines: string[] = []

  // Total visible width of one rendered row (used for divider + stripe padding)
  const divLen = resolvedWidths.reduce((s, w) => s + w, 0) + GAP * (activeCols.length - 1)

  // Header (plain strings — no ANSI, no truncation needed)
  const headerStr = renderRow(activeCols.map(c => c.header))
  lines.push(' '.repeat(INDENT) + (useColor && colors ? chalk.bold(headerStr) : headerStr))

  // Divider — exactly as wide as the rendered header
  const divLine = '─'.repeat(divLen)
  lines.push(' '.repeat(INDENT) + (useColor && colors ? colors.muted(divLine) : divLine))

  // Data rows — apply a subtle background tint to every even row so dense
  // tables are easier to track horizontally.
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]!
    const cells = activeCols.map((col, i) => col.render(row, resolvedWidths[i]!))
    const rendered = renderRow(cells)

    if (doStripe && colors && ri % 2 === 0) {
      // Pad the row to the full divLen visible width before applying the
      // background so the tint forms a continuous band across all columns.
      const visibleLen = visLen(rendered)
      const padded = rendered + ' '.repeat(Math.max(0, divLen - visibleLen))
      lines.push(' '.repeat(INDENT) + colors.stripe(padded))
    } else {
      lines.push(' '.repeat(INDENT) + rendered)
    }
  }

  return lines
}
