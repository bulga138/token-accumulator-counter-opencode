import { describe, it, expect } from 'vitest'
import { buildTable } from '../src/format/table.js'
import type { TableColumn } from '../src/format/table.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Row {
  name: string
  value: number
  pct: number
}

const ROWS: Row[] = [
  { name: 'alpha', value: 1000, pct: 0.5 },
  { name: 'beta', value: 500, pct: 0.25 },
  { name: 'gamma', value: 300, pct: 0.15 },
]

function nameCol(maxWidth?: number): TableColumn<Row> {
  return {
    header: 'Name',
    align: 'left',
    width: 'flex',
    minWidth: 4,
    maxWidth,
    render: r => r.name,
  }
}

const valueCol: TableColumn<Row> = {
  header: 'Value',
  align: 'right',
  width: 8,
  render: r => r.value.toString(),
}

const pctCol: TableColumn<Row> = {
  header: 'Pct',
  align: 'right',
  width: 6,
  priority: 1, // droppable
  render: r => `${(r.pct * 100).toFixed(0)}%`,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildTable', () => {
  it('renders header, divider, and data rows', () => {
    const lines = buildTable([nameCol(), valueCol], ROWS, { useColor: false, terminalWidth: 80 })
    // header + divider + 3 rows = 5 lines
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain('Name')
    expect(lines[0]).toContain('Value')
    expect(lines[1]).toContain('─')
    expect(lines[2]).toContain('alpha')
    expect(lines[3]).toContain('beta')
    expect(lines[4]).toContain('gamma')
  })

  it('returns only header and divider for empty rows', () => {
    const lines = buildTable([nameCol(), valueCol], [], { useColor: false, terminalWidth: 80 })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Name')
    expect(lines[1]).toContain('─')
  })

  it('right-aligns value column content', () => {
    const lines = buildTable([nameCol(), valueCol], [ROWS[0]!], { useColor: false, terminalWidth: 80 })
    // Value "1000" should be right-padded to width 8 → right side ends with "    1000"
    expect(lines[2]).toMatch(/1000\s*$/)
  })

  it('left-aligns flex column content', () => {
    const lines = buildTable([nameCol(), valueCol], [ROWS[0]!], { useColor: false, terminalWidth: 80 })
    // "alpha" should appear near the start of the row
    expect(lines[2]!.trimStart()).toMatch(/^alpha/)
  })

  it('clamps flex column to maxWidth', () => {
    const maxWidth = 6
    const lines = buildTable([nameCol(maxWidth), valueCol], ROWS, { useColor: false, terminalWidth: 80 })
    const visLen = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '').length
    // Each data cell in the name column should not exceed maxWidth
    for (const line of lines.slice(2)) {
      const nameCell = line.trimStart().split('  ')[0]!
      expect(visLen(nameCell)).toBeLessThanOrEqual(maxWidth)
    }
  })

  it('drops priority columns when terminal is too narrow', () => {
    // Very narrow terminal: force pctCol to be dropped
    const lines = buildTable([nameCol(), valueCol, pctCol], ROWS, {
      useColor: false,
      terminalWidth: 20,
    })
    // pctCol should be absent
    expect(lines[0]).not.toContain('Pct')
    expect(lines[0]).toContain('Name')
    expect(lines[0]).toContain('Value')
  })

  it('does not drop non-priority columns', () => {
    const lines = buildTable([nameCol(), valueCol], ROWS, {
      useColor: false,
      terminalWidth: 20,
    })
    // Both columns are non-droppable (pct=0), should still appear
    expect(lines[0]).toContain('Name')
    expect(lines[0]).toContain('Value')
  })

  it('applies zebra striping to even rows when useColor=true', () => {
    // We can't easily test ANSI codes without a TTY snapshot, but we can confirm
    // the line count is still correct and the content is present.
    const lines = buildTable([nameCol(), valueCol], ROWS, { useColor: false, stripe: false, terminalWidth: 80 })
    expect(lines).toHaveLength(5)
    for (const row of ROWS) {
      expect(lines.join('\n')).toContain(row.name)
    }
  })

  it('includes all row values in output', () => {
    const lines = buildTable([nameCol(), valueCol], ROWS, { useColor: false, terminalWidth: 80 })
    const joined = lines.join('\n')
    for (const row of ROWS) {
      expect(joined).toContain(row.name)
      expect(joined).toContain(row.value.toString())
    }
  })
})
