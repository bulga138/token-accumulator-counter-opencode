import { readFileSync } from 'fs'
import { getDefaultDbPath, validateDbPath } from '../utils/platform.js'

let _db: Database | null = null
let _rawDb: any = null // raw handle for closing
let _sql: any = null
let _betterSqlite3: any = null
let _bunSqlite: any = null

export interface Statement<T = Record<string, unknown>> {
  all(params?: unknown[]): T[]
  get(params?: unknown[]): T | undefined
  run(params?: unknown[]): { changes: number }
  iterate(params?: unknown[]): IterableIterator<T>
}

export interface Database {
  prepare<T>(sql: string): Statement<T>
}

// Detect if running in Bun
function isBun(): boolean {
  return typeof Bun !== 'undefined' && Bun.version !== undefined
}

// Try to load database driver in order: Bun > better-sqlite3 > sql.js
async function initDatabase(): Promise<{ type: 'bun' | 'better-sqlite3' | 'sql.js'; module: any }> {
  // Try Bun's built-in SQLite first (fastest, no dependencies)
  if (isBun()) {
    try {
      const { Database } = await import('bun:sqlite')
      _bunSqlite = Database
      return { type: 'bun', module: _bunSqlite }
    } catch {
      // Bun SQLite not available
    }
  }

  // Try better-sqlite3 (native, fast)
  if (!_betterSqlite3) {
    try {
      const betterSqlite3 = await import('better-sqlite3')
      const mod = betterSqlite3.default || betterSqlite3
      // Probe: open an in-memory DB to verify the native binding is functional.
      // This catches cases where the JS package is installed but the compiled
      // .node binary is missing or was built for a different Node.js version
      // (common when better-sqlite3 is an optionalDependency with pnpm on macOS).
      const testDb = new mod(':memory:')
      testDb.close()
      _betterSqlite3 = mod
      return { type: 'better-sqlite3', module: _betterSqlite3 }
    } catch {
      // better-sqlite3 not available or native binding broken — fall through to sql.js
      _betterSqlite3 = null
    }
  } else {
    return { type: 'better-sqlite3', module: _betterSqlite3 }
  }

  // Fall back to sql.js (WASM, universal)
  if (!_sql) {
    const initSqlJs = await import('sql.js')
    _sql = await initSqlJs.default()
  }
  return { type: 'sql.js', module: _sql }
}

function createBunWrapper(Database: any, path: string): Database {
  const db = new Database(path, { readonly: true })
  return {
    prepare<T>(sql: string): Statement<T> {
      const stmt = db.query(sql)
      return {
        all(params: unknown[] = []): T[] {
          return stmt.all(...params) as T[]
        },
        get(params: unknown[] = []): T | undefined {
          return stmt.get(...params) as T | undefined
        },
        run(params: unknown[] = []): { changes: number } {
          const result = stmt.run(...params)
          return { changes: result.changes || 0 }
        },
        *iterate(params: unknown[] = []): IterableIterator<T> {
          for (const row of stmt.iterate(...params)) {
            yield row as T
          }
        },
      }
    },
  }
}

function createBetterSqlite3Wrapper(db: any): Database {
  return {
    prepare<T>(sql: string): Statement<T> {
      const stmt = db.prepare(sql)
      return {
        all(params: unknown[] = []): T[] {
          return stmt.all(...params) as T[]
        },
        get(params: unknown[] = []): T | undefined {
          return stmt.get(...params) as T | undefined
        },
        run(params: unknown[] = []): { changes: number } {
          const result = stmt.run(...params)
          return { changes: result.changes }
        },
        iterate(params: unknown[] = []): IterableIterator<T> {
          return stmt.iterate(...params) as IterableIterator<T>
        },
      }
    },
  }
}

function createSqlJsWrapper(rawDb: any): Database {
  return {
    prepare<T>(sql: string): Statement<T> {
      return {
        all(params: unknown[] = []): T[] {
          const stmt = rawDb.prepare(sql)
          if (params.length > 0) stmt.bind(params)
          const results: T[] = []
          while (stmt.step()) {
            results.push(stmt.getAsObject() as T)
          }
          stmt.free()
          return results
        },
        get(params: unknown[] = []): T | undefined {
          const stmt = rawDb.prepare(sql)
          if (params.length > 0) stmt.bind(params)
          const result = stmt.step() ? (stmt.getAsObject() as T) : undefined
          stmt.free()
          return result
        },
        run(params: unknown[] = []): { changes: number } {
          rawDb.run(sql, params)
          return { changes: rawDb.getRowsModified() }
        },
        *iterate(params: unknown[] = []): IterableIterator<T> {
          const stmt = rawDb.prepare(sql)
          if (params.length > 0) stmt.bind(params)
          try {
            while (stmt.step()) {
              yield stmt.getAsObject() as T
            }
          } finally {
            stmt.free()
          }
        },
      }
    },
  }
}

export function getDb(dbPath?: string): Database {
  if (_db) return _db

  const path = dbPath ?? getDefaultDbPath()
  validateDbPath(path)

  throw new Error('Database not initialized. Call getDbAsync() to initialize.')
}

export async function getDbAsync(dbPath?: string): Promise<Database> {
  if (_db) return _db

  const path = dbPath ?? getDefaultDbPath()
  validateDbPath(path)

  const { type, module } = await initDatabase()

  if (type === 'bun') {
    // Bun: opens file directly, no memory loading, fastest
    const bunDb = new module(path, { readonly: true })
    _rawDb = bunDb
    _db = createBunWrapper(module, path)
  } else if (type === 'better-sqlite3') {
    // better-sqlite3: opens file directly, no memory loading
    const rawDb = new module(path)
    _rawDb = rawDb
    _db = createBetterSqlite3Wrapper(rawDb)
  } else {
    // sql.js: must load entire file into memory
    const fileBuffer = readFileSync(path)
    const rawDb = new module.Database(fileBuffer)
    _rawDb = rawDb
    _db = createSqlJsWrapper(rawDb)
  }

  return _db
}

export function closeDb(): void {
  if (_db) {
    if (_rawDb?.close) _rawDb.close()
    _db = null
    _rawDb = null
  }
}

// Export which database type is being used (for debugging)
export async function getDbType(): Promise<'bun' | 'better-sqlite3' | 'sql.js'> {
  const { type } = await initDatabase()
  return type
}
