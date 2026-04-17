/**
 * Database schema detection and validation.
 *
 * Detects OpenCode database schema version and provides warnings
 * when schema changes might affect TACO functionality.
 */

import type { Database } from '../data/db.js'

export interface SchemaInfo {
  version: string | null
  tables: string[]
  columns: Record<string, string[]>
  isCompatible: boolean
  warnings: string[]
}

// Known schema versions and their table/column signatures
const KNOWN_SCHEMAS: Array<{
  version: string
  requiredTables: string[]
  requiredColumns: Record<string, string[]>
}> = [
  {
    version: '1.0',
    requiredTables: ['messages', 'sessions'],
    requiredColumns: {
      messages: [
        'id',
        'role',
        'model',
        'tokens_input',
        'tokens_output',
        'cost',
        'session_id',
        'created_at',
      ],
      sessions: ['id', 'title', 'directory', 'created_at', 'updated_at'],
    },
  },
]

/**
 * Detects the OpenCode database schema version.
 * Returns schema information and compatibility status.
 */
export function detectSchema(db: Database): SchemaInfo {
  const tables: string[] = []
  const columns: Record<string, string[]> = {}
  const warnings: string[] = []

  try {
    // Get list of tables
    const tableResult = db
      .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()

    for (const row of tableResult) {
      if (row.name) {
        tables.push(row.name)
      }
    }

    // Get columns for each table
    for (const table of tables) {
      try {
        const columnResult = db.prepare<{ name: string }>(`PRAGMA table_info(${table})`).all()

        columns[table] = columnResult.map(row => row.name).filter(Boolean)
      } catch {
        warnings.push(`Could not read columns for table: ${table}`)
      }
    }
  } catch (error) {
    warnings.push(
      `Schema detection failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // Determine schema version and compatibility
  const { version, isCompatible } = determineSchemaVersion(tables, columns)

  // Generate warnings for missing tables/columns
  if (!tables.includes('messages')) {
    warnings.push('Missing required table: messages')
  }
  if (!tables.includes('sessions')) {
    warnings.push('Missing required table: sessions')
  }

  // Check for critical columns in messages table
  if (columns.messages) {
    const criticalColumns = ['role', 'model', 'tokens_input', 'tokens_output', 'cost']
    for (const col of criticalColumns) {
      if (!columns.messages.includes(col)) {
        warnings.push(`Missing critical column in messages: ${col}`)
      }
    }
  }

  return {
    version,
    tables,
    columns,
    isCompatible,
    warnings,
  }
}

/**
 * Determines schema version based on tables and columns.
 */
function determineSchemaVersion(
  tables: string[],
  columns: Record<string, string[]>
): { version: string | null; isCompatible: boolean } {
  // Check against known schemas
  for (const knownSchema of KNOWN_SCHEMAS) {
    const hasAllTables = knownSchema.requiredTables.every(t => tables.includes(t))

    if (hasAllTables) {
      const hasAllColumns = Object.entries(knownSchema.requiredColumns).every(
        ([table, requiredCols]) => {
          const tableCols = columns[table] || []
          return requiredCols.every(col => tableCols.includes(col))
        }
      )

      if (hasAllColumns) {
        return { version: knownSchema.version, isCompatible: true }
      }
    }
  }

  // Check if we have minimum required tables for basic functionality
  const hasMessages = tables.includes('messages')
  const hasSessions = tables.includes('sessions')

  if (hasMessages && hasSessions) {
    // Has required tables but schema might be different
    return { version: 'unknown', isCompatible: true }
  }

  // Missing critical tables
  return { version: null, isCompatible: false }
}

/**
 * Validates that the database schema is compatible with TACO.
 * Returns true if compatible, false otherwise.
 */
export function validateSchema(db: Database): boolean {
  const schema = detectSchema(db)
  return schema.isCompatible && schema.warnings.length === 0
}

/**
 * Formats schema information for display.
 */
export function formatSchemaInfo(schema: SchemaInfo): string {
  const lines: string[] = []

  lines.push(`Database Schema:`)
  lines.push(`  Version: ${schema.version || 'unknown'}`)
  lines.push(`  Tables: ${schema.tables.length}`)

  if (schema.warnings.length > 0) {
    lines.push('')
    lines.push('Warnings:')
    for (const warning of schema.warnings) {
      lines.push(`  ! ${warning}`)
    }
  }

  if (schema.isCompatible) {
    lines.push('')
    lines.push('✓ Schema is compatible')
  } else {
    lines.push('')
    lines.push('✗ Schema may not be compatible - some features may not work')
  }

  return lines.join('\n')
}

/**
 * Checks if a specific column exists in a table.
 */
export function hasColumn(db: Database, table: string, column: string): boolean {
  try {
    const result = db.prepare<{ name: string }>(`PRAGMA table_info(${table})`).all()

    return result.some(row => row.name === column)
  } catch {
    return false
  }
}

/**
 * Gets the list of columns for a table.
 */
export function getTableColumns(db: Database, table: string): string[] {
  try {
    const result = db.prepare<{ name: string }>(`PRAGMA table_info(${table})`).all()

    return result.map(row => row.name).filter(Boolean)
  } catch {
    return []
  }
}
