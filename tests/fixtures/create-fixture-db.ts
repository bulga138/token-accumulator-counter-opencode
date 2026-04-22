import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface Database {
  prepare<T>(sql: string): Statement<T>
  close(): void
}

export interface Statement<T = Record<string, unknown>> {
  all(params?: unknown[]): T[]
  get(params?: unknown[]): T | undefined
  run(params?: unknown[]): { changes: number }
}

let _sql: any = null

async function initSql(): Promise<any> {
  if (_sql) return _sql
  const initSqlJs = await import('sql.js')
  _sql = await initSqlJs.default()
  return _sql
}

export async function createFixtureDbAsync(): Promise<Database> {
  const SQL = await initSql()
  const db = new SQL.Database()

  // Create tables
  db.run(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      parent_id TEXT,
      project_id TEXT,
      time_created INTEGER,
      time_updated INTEGER
    )
  `)

  db.run(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT,
      FOREIGN KEY (session_id) REFERENCES session(id)
    )
  `)

  // Insert sessions
  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000

  const sessions = [
    {
      id: 'ses_001',
      title: 'Fix auth bug',
      directory: '/home/user/work/api',
      parent_id: null,
      project_id: 'proj_001',
      time_created: now - 2 * oneDay,
      time_updated: now - 2 * oneDay + 3600000,
    },
    {
      id: 'ses_002',
      title: 'Add login page',
      directory: '/home/user/work/frontend',
      parent_id: null,
      project_id: 'proj_002',
      time_created: now - 3 * oneDay,
      time_updated: now - 3 * oneDay + 7200000,
    },
    {
      id: 'ses_003',
      title: 'Database migration',
      directory: '/home/user/work/api',
      parent_id: null,
      project_id: 'proj_001',
      time_created: now - 5 * oneDay,
      time_updated: now - 5 * oneDay + 1800000,
    },
    {
      id: 'ses_004',
      title: 'API documentation',
      directory: '/home/user/work/docs',
      parent_id: null,
      project_id: 'proj_003',
      time_created: now - 6 * oneDay,
      time_updated: now - 6 * oneDay + 5400000,
    },
    {
      id: 'ses_005',
      title: 'Refactor utils',
      directory: '/home/user/work/frontend',
      parent_id: null,
      project_id: 'proj_002',
      time_created: now - 8 * oneDay,
      time_updated: now - 8 * oneDay + 2700000,
    },
    {
      id: 'ses_006',
      title: 'Test coverage',
      directory: '/home/user/work/api',
      parent_id: null,
      project_id: 'proj_001',
      time_created: now - 10 * oneDay,
      time_updated: now - 10 * oneDay + 4500000,
    },
    {
      id: 'ses_007',
      title: 'Deploy script',
      directory: '/home/user/work/api',
      parent_id: null,
      project_id: 'proj_001',
      time_created: now - 12 * oneDay,
      time_updated: now - 12 * oneDay + 1200000,
    },
  ]

  for (const s of sessions) {
    db.run(
      `INSERT INTO session (id, title, directory, parent_id, project_id, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.title, s.directory, s.parent_id, s.project_id, s.time_created, s.time_updated]
    )
  }

  // Insert messages
  const messages = [
    // Session 1 - Fix auth bug (claude-sonnet-4-6, anthropic, build agent)
    {
      id: 'msg_001a',
      session_id: 'ses_001',
      time_created: now - 2 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 2 * oneDay, completed: now - 2 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_001b',
      session_id: 'ses_001',
      time_created: now - 2 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 2 * oneDay + 1000, completed: now - 2 * oneDay + 5000 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'build',
        cost: 0.15,
        tokens: {
          input: 2000,
          output: 400,
          reasoning: 0,
          cache: { read: 10000, write: 5000 },
          total: 17400,
        },
        finish: 'stop',
      }),
    },
    {
      id: 'msg_001c',
      session_id: 'ses_001',
      time_created: now - 2 * oneDay + 6000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 2 * oneDay + 6000, completed: now - 2 * oneDay + 10000 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'build',
        cost: 0.12,
        tokens: {
          input: 1500,
          output: 350,
          reasoning: 0,
          cache: { read: 8000, write: 0 },
          total: 9850,
        },
        finish: 'stop',
      }),
    },
    // Session 2 - Add login page (gpt-4o, openai, build agent)
    {
      id: 'msg_002a',
      session_id: 'ses_002',
      time_created: now - 3 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 3 * oneDay, completed: now - 3 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_002b',
      session_id: 'ses_002',
      time_created: now - 3 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 3 * oneDay + 1000, completed: now - 3 * oneDay + 6000 },
        modelID: 'gpt-4o',
        providerID: 'openai',
        agent: 'build',
        cost: 0.25,
        tokens: {
          input: 3000,
          output: 800,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 3800,
        },
        finish: 'stop',
      }),
    },
    {
      id: 'msg_002c',
      session_id: 'ses_002',
      time_created: now - 3 * oneDay + 7000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 3 * oneDay + 7000, completed: now - 3 * oneDay + 12000 },
        modelID: 'gpt-4o',
        providerID: 'openai',
        agent: 'build',
        cost: 0.18,
        tokens: {
          input: 2200,
          output: 500,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 2700,
        },
        finish: 'stop',
      }),
    },
    // Session 3 - Database migration (claude-sonnet-4-6, anthropic, plan agent)
    {
      id: 'msg_003a',
      session_id: 'ses_003',
      time_created: now - 5 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 5 * oneDay, completed: now - 5 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_003b',
      session_id: 'ses_003',
      time_created: now - 5 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 5 * oneDay + 1000, completed: now - 5 * oneDay + 4000 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'plan',
        cost: 0.08,
        tokens: {
          input: 1000,
          output: 200,
          reasoning: 0,
          cache: { read: 5000, write: 2000 },
          total: 8200,
        },
        finish: 'stop',
      }),
    },
    // Session 4 - API documentation (gpt-4o, openai, explore agent)
    {
      id: 'msg_004a',
      session_id: 'ses_004',
      time_created: now - 6 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 6 * oneDay, completed: now - 6 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_004b',
      session_id: 'ses_004',
      time_created: now - 6 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 6 * oneDay + 1000, completed: now - 6 * oneDay + 8000 },
        modelID: 'gpt-4o',
        providerID: 'openai',
        agent: 'explore',
        cost: 0.32,
        tokens: {
          input: 4000,
          output: 1200,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 5200,
        },
        finish: 'stop',
      }),
    },
    // Session 5 - Refactor utils (claude-sonnet-4-6, anthropic, build agent)
    {
      id: 'msg_005a',
      session_id: 'ses_005',
      time_created: now - 8 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 8 * oneDay, completed: now - 8 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_005b',
      session_id: 'ses_005',
      time_created: now - 8 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 8 * oneDay + 1000, completed: now - 8 * oneDay + 5000 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'build',
        cost: 0.14,
        tokens: {
          input: 1800,
          output: 450,
          reasoning: 0,
          cache: { read: 6000, write: 1000 },
          total: 9250,
        },
        finish: 'stop',
      }),
    },
    // Session 6 - Test coverage (gpt-4o, openai, build agent)
    {
      id: 'msg_006a',
      session_id: 'ses_006',
      time_created: now - 10 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 10 * oneDay, completed: now - 10 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_006b',
      session_id: 'ses_006',
      time_created: now - 10 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 10 * oneDay + 1000, completed: now - 10 * oneDay + 7000 },
        modelID: 'gpt-4o',
        providerID: 'openai',
        agent: 'build',
        cost: 0.28,
        tokens: {
          input: 3500,
          output: 900,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 4400,
        },
        finish: 'stop',
      }),
    },
    // Session 7 - Deploy script (claude-sonnet-4-6, anthropic, build agent)
    {
      id: 'msg_007a',
      session_id: 'ses_007',
      time_created: now - 12 * oneDay,
      data: JSON.stringify({
        role: 'user',
        time: { created: now - 12 * oneDay, completed: now - 12 * oneDay + 1000 },
      }),
    },
    {
      id: 'msg_007b',
      session_id: 'ses_007',
      time_created: now - 12 * oneDay + 1000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 12 * oneDay + 1000, completed: now - 12 * oneDay + 3000 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'build',
        cost: 0.06,
        tokens: {
          input: 800,
          output: 150,
          reasoning: 0,
          cache: { read: 3000, write: 500 },
          total: 4450,
        },
        finish: 'stop',
      }),
    },
    // Session 7 extra messages — non-stop finish reasons for health tests
    {
      id: 'msg_007c',
      session_id: 'ses_007',
      time_created: now - 12 * oneDay + 4000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 12 * oneDay + 4000, completed: now - 12 * oneDay + 6000 },
        modelID: 'gpt-4o',
        providerID: 'openai',
        agent: 'build',
        cost: 0.09,
        tokens: {
          input: 1200,
          output: 200,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 1400,
        },
        finish: 'length',
      }),
    },
    {
      id: 'msg_007d',
      session_id: 'ses_007',
      time_created: now - 12 * oneDay + 7000,
      data: JSON.stringify({
        role: 'assistant',
        time: { created: now - 12 * oneDay + 7000, completed: now - 12 * oneDay + 8000 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'build',
        cost: 0.0,
        tokens: {
          input: 500,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
          total: 500,
        },
        finish: 'error',
      }),
    },
  ]

  for (const m of messages) {
    db.run(
      `INSERT INTO message (id, session_id, time_created, data)
       VALUES (?, ?, ?, ?)`,
      [m.id, m.session_id, m.time_created, m.data]
    )
  }

  // Wrap the raw sql.js database in our Database interface
  return {
    prepare<T>(sql: string): Statement<T> {
      const stmt = db.prepare(sql)
      return {
        all(params: unknown[] = []): T[] {
          if (params.length > 0) stmt.bind(params)
          const results: T[] = []
          while (stmt.step()) {
            results.push(stmt.getAsObject() as T)
          }
          stmt.free()
          return results
        },
        get(params: unknown[] = []): T | undefined {
          if (params.length > 0) stmt.bind(params)
          const result = stmt.step() ? (stmt.getAsObject() as T) : undefined
          stmt.free()
          return result
        },
        run(params: unknown[] = []): { changes: number } {
          db.run(sql, params)
          return { changes: db.getRowsModified() }
        },
      }
    },
    close(): void {
      db.close()
    },
  }
}

// Synchronous wrapper for compatibility with existing tests
export function createFixtureDb(): Database {
  let db: Database | null = null
  let error: Error | null = null

  createFixtureDbAsync()
    .then(d => {
      db = d
    })
    .catch(e => {
      error = e
    })

  // Wait for the promise to resolve (simple synchronous wait)
  const start = Date.now()
  while (!db && !error && Date.now() - start < 5000) {
    // Busy wait - not ideal but works for tests
  }

  if (error) throw error
  if (!db) throw new Error('Timeout creating fixture database')

  return db
}

/**
 * Creates the fixture DB and writes it to disk as a real SQLite file.
 * Used by integration tests that call CLI commands via `--db <path>`.
 */
export async function exportFixtureDbToFile(filePath: string): Promise<void> {
  const SQL = await initSql()
  const db = new SQL.Database()

  // Re-run all the DDL + inserts from createFixtureDbAsync
  // We can't reuse the in-memory DB because sql.js doesn't share state.
  // Instead, create a fresh fixture, export the bytes, and write them.
  const wrapper = await createFixtureDbAsync()

  // Unfortunately the wrapper doesn't expose the raw sql.js handle.
  // So we build a second DB from scratch—grab full SQL dump via the wrapper.
  // Simpler approach: use sql.js to create + populate then export.
  const db2 = new SQL.Database()

  // Create tables
  db2.run(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      parent_id TEXT,
      project_id TEXT,
      time_created INTEGER,
      time_updated INTEGER
    )
  `)
  db2.run(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT,
      FOREIGN KEY (session_id) REFERENCES session(id)
    )
  `)

  // Copy session data via the wrapper
  const sessions = wrapper
    .prepare<{
      id: string
      title: string
      directory: string
      parent_id: string | null
      project_id: string | null
      time_created: number
      time_updated: number
    }>('SELECT * FROM session')
    .all()

  for (const s of sessions) {
    db2.run(
      'INSERT INTO session (id, title, directory, parent_id, project_id, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [s.id, s.title, s.directory, s.parent_id, s.project_id, s.time_created, s.time_updated]
    )
  }

  const messages = wrapper
    .prepare<{
      id: string
      session_id: string
      time_created: number
      data: string
    }>('SELECT * FROM message')
    .all()

  for (const m of messages) {
    db2.run('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)', [
      m.id,
      m.session_id,
      m.time_created,
      m.data,
    ])
  }

  wrapper.close()

  const data = db2.export()
  db2.close()
  db.close()
  writeFileSync(filePath, Buffer.from(data))
}
