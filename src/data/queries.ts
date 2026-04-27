import type { Database } from './db.js'
import type { UsageEvent, SessionRecord, TokenUsage, QueryFilters } from './types.js'
import { DEFAULT_QUERY_LIMIT } from './types.js'

// Raw row types from SQLite message table
interface RawMessageRow {
  id: string
  session_id: string
  time_created: number
  data: string
  session_title: string | null
  session_directory: string | null
  session_parent_id: string | null
  session_project_id: string | null
  session_time_updated: number
}

// Raw row types from SQLite session table
interface RawSessionRow {
  id: string
  title: string | null
  directory: string | null
  parent_id: string | null
  project_id: string | null
  time_created: number
  time_updated: number
}

// JSON data shapes inside message.data
interface AssistantMessageData {
  role: 'assistant'
  time?: { created?: number; completed?: number }
  modelID?: string
  providerID?: string
  agent?: string
  cost?: number
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  finish?: string
}

export function loadUsageEvents(db: Database, filters: QueryFilters = {}): UsageEvent[] {
  const fromMs = filters.from ? filters.from.getTime() : 0
  const toMs = filters.to ? filters.to.getTime() : Date.now() + 86400_000
  const limit = filters.limit ?? DEFAULT_QUERY_LIMIT

  const rows = db
    .prepare<RawMessageRow>(
      `SELECT
       m.id,
       m.session_id,
       m.time_created,
       m.data,
       s.title           AS session_title,
       s.directory       AS session_directory,
       s.parent_id       AS session_parent_id,
       s.project_id      AS session_project_id,
       s.time_updated    AS session_time_updated
     FROM message m
     JOIN session s ON m.session_id = s.id
     WHERE m.time_created >= ? AND m.time_created <= ?
     ORDER BY m.time_created ASC
     LIMIT ?`
    )
    .all([fromMs, toMs, limit])

  const events: UsageEvent[] = []

  for (const row of rows) {
    let data: AssistantMessageData
    try {
      data = JSON.parse(row.data) as AssistantMessageData
    } catch {
      continue
    }

    // Skip non-assistant messages (e.g., user messages)
    if (data.role !== 'assistant') continue

    const tokens: TokenUsage = {
      input: data.tokens?.input ?? 0,
      output: data.tokens?.output ?? 0,
      reasoning: data.tokens?.reasoning ?? 0,
      cacheRead: data.tokens?.cache?.read ?? 0,
      cacheWrite: data.tokens?.cache?.write ?? 0,
      total: data.tokens?.total ?? 0,
    }

    events.push({
      messageId: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      sessionDirectory: row.session_directory,
      sessionParentId: row.session_parent_id,
      projectId: row.session_project_id,
      timeCreated: row.time_created,
      timeCompleted: data.time?.completed ?? null,
      modelId: data.modelID || 'unknown',
      providerId: data.providerID || 'unknown',
      agent: data.agent ?? null,
      tokens,
      cost: data.cost ?? 0,
      finish: data.finish ?? null,
    })
  }

  // Apply additional filters
  return events.filter(e => {
    if (filters.model && !e.modelId.toLowerCase().includes(filters.model.toLowerCase())) {
      return false
    }
    if (filters.provider && !e.providerId.toLowerCase().includes(filters.provider.toLowerCase())) {
      return false
    }
    if (filters.agent && e.agent !== filters.agent) {
      return false
    }
    if (
      filters.project &&
      !e.sessionDirectory?.toLowerCase().includes(filters.project.toLowerCase())
    ) {
      return false
    }
    return true
  })
}

export function loadSessions(db: Database, filters: QueryFilters = {}): SessionRecord[] {
  const fromMs = filters.from ? filters.from.getTime() : 0
  const toMs = filters.to ? filters.to.getTime() : Date.now() + 86400_000

  const rows = db
    .prepare<RawSessionRow>(
      `SELECT id, title, directory, parent_id, project_id, time_created, time_updated
     FROM session
     WHERE time_created >= ? AND time_created <= ?
     ORDER BY time_created ASC`
    )
    .all([fromMs, toMs])

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    directory: r.directory,
    parentId: r.parent_id,
    projectId: r.project_id,
    timeCreated: r.time_created,
    timeUpdated: r.time_updated,
  }))
}

// Streaming version for memory-efficient processing
export function* streamUsageEvents(
  db: Database,
  filters: QueryFilters = {}
): Generator<UsageEvent> {
  const fromMs = filters.from ? filters.from.getTime() : 0
  const toMs = filters.to ? filters.to.getTime() : Date.now() + 86400_000

  const stmt = db.prepare<RawMessageRow>(
    `SELECT
       m.id,
       m.session_id,
       m.time_created,
       m.data,
       s.title           AS session_title,
       s.directory       AS session_directory,
       s.parent_id       AS session_parent_id,
       s.project_id      AS session_project_id,
       s.time_updated    AS session_time_updated
     FROM message m
     JOIN session s ON m.session_id = s.id
     WHERE m.time_created >= ? AND m.time_created <= ?
     ORDER BY m.time_created ASC`
  )

  for (const row of stmt.iterate([fromMs, toMs])) {
    let data: AssistantMessageData
    try {
      data = JSON.parse(row.data) as AssistantMessageData
    } catch {
      continue
    }

    // Skip non-assistant messages (e.g., user messages)
    if (data.role !== 'assistant') continue

    // Apply additional filters inline
    if (
      filters.model &&
      !(data.modelID || 'unknown').toLowerCase().includes(filters.model.toLowerCase())
    ) {
      continue
    }
    if (
      filters.provider &&
      !(data.providerID || 'unknown').toLowerCase().includes(filters.provider.toLowerCase())
    ) {
      continue
    }
    if (filters.agent && data.agent !== filters.agent) {
      continue
    }
    if (
      filters.project &&
      !(row.session_directory || '').toLowerCase().includes(filters.project.toLowerCase())
    ) {
      continue
    }

    const tokens: TokenUsage = {
      input: data.tokens?.input ?? 0,
      output: data.tokens?.output ?? 0,
      reasoning: data.tokens?.reasoning ?? 0,
      cacheRead: data.tokens?.cache?.read ?? 0,
      cacheWrite: data.tokens?.cache?.write ?? 0,
      total: data.tokens?.total ?? 0,
    }

    yield {
      messageId: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      sessionDirectory: row.session_directory,
      sessionParentId: row.session_parent_id,
      projectId: row.session_project_id,
      timeCreated: row.time_created,
      timeCompleted: data.time?.completed ?? null,
      modelId: data.modelID || 'unknown',
      providerId: data.providerID || 'unknown',
      agent: data.agent ?? null,
      tokens,
      cost: data.cost ?? 0,
      finish: data.finish ?? null,
    }
  }
}

// SQLite-native aggregation for overview stats (zero memory overhead)
interface OverviewAggregates {
  messageCount: number
  totalCost: number
  totalTokens: number
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  totalReasoning: number
}

export function getOverviewAggregates(
  db: Database,
  fromDate: Date,
  toDate?: Date
): OverviewAggregates {
  const fromMs = fromDate.getTime()
  const toMs = toDate ? toDate.getTime() : Date.now() + 86400_000

  const result = db
    .prepare<OverviewAggregates>(
      `
    SELECT 
      COUNT(*) as messageCount,
      COALESCE(SUM(json_extract(m.data, '$.cost')), 0) as totalCost,
      COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) as totalTokens,
      COALESCE(SUM(json_extract(m.data, '$.tokens.input')), 0) as totalInput,
      COALESCE(SUM(json_extract(m.data, '$.tokens.output')), 0) as totalOutput,
      COALESCE(SUM(json_extract(m.data, '$.tokens.cache.read')), 0) as totalCacheRead,
      COALESCE(SUM(json_extract(m.data, '$.tokens.cache.write')), 0) as totalCacheWrite,
      COALESCE(SUM(json_extract(m.data, '$.tokens.reasoning')), 0) as totalReasoning
    FROM message m
    WHERE m.time_created >= ? AND m.time_created <= ?
      AND json_extract(m.data, '$.role') = 'assistant'
  `
    )
    .get([fromMs, toMs])

  return (
    result || {
      messageCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalReasoning: 0,
    }
  )
}

// SQLite-native daily aggregation for heatmap (memory efficient)
export interface DailyAggregate {
  date: string
  tokens: number
}

export function getDailyAggregates(db: Database, fromDate: Date, toDate?: Date): DailyAggregate[] {
  const fromMs = fromDate.getTime()
  const toMs = toDate ? toDate.getTime() : Date.now() + 86400_000

  return db
    .prepare<DailyAggregate>(
      `
    SELECT 
      date(m.time_created / 1000, 'unixepoch') as date,
      COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) as tokens
    FROM message m
    WHERE m.time_created >= ? AND m.time_created <= ?
      AND json_extract(m.data, '$.role') = 'assistant'
    GROUP BY date(m.time_created / 1000, 'unixepoch')
    ORDER BY date ASC
  `
    )
    .all([fromMs, toMs])
}

// SQLite-native budget check (single query for today/month)
interface BudgetCheck {
  todayCost: number
  monthCost: number
}

export function getBudgetStatus(db: Database): BudgetCheck {
  const result = db
    .prepare<BudgetCheck>(
      `
    SELECT 
      COALESCE(SUM(CASE 
        WHEN date(m.time_created / 1000, 'unixepoch') = date('now') 
        THEN json_extract(m.data, '$.cost') 
        ELSE 0 
      END), 0) as todayCost,
      COALESCE(SUM(CASE 
        WHEN strftime('%Y-%m', datetime(m.time_created / 1000, 'unixepoch')) = strftime('%Y-%m', 'now')
        THEN json_extract(m.data, '$.cost') 
        ELSE 0 
      END), 0) as monthCost
    FROM message m
    WHERE json_extract(m.data, '$.role') = 'assistant'
  `
    )
    .get([])

  return result || { todayCost: 0, monthCost: 0 }
}

// ─── Session detail ───────────────────────────────────────────────────────────

export interface SessionToolCall {
  callId: string
  tool: string
  status: 'completed' | 'error' | 'pending' | string
  /** Abbreviated summary of the input (e.g. file path, command). */
  inputSummary: string | null
  /** Whether the output was truncated by the model. */
  outputTruncated: boolean
}

export interface SessionMessage {
  messageId: string
  timeCreated: number
  timeCompleted: number | null
  role: 'assistant' | 'user'
  modelId: string | null
  providerId: string | null
  agent: string | null
  mode: string | null
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
    total: number
  }
  cost: number
  finish: string | null
  tools: SessionToolCall[]
}

export interface SessionDetail {
  sessionId: string
  title: string | null
  directory: string | null
  timeCreated: number
  timeUpdated: number
  /** Summary edit stats if OpenCode computed them. */
  summaryAdditions: number | null
  summaryDeletions: number | null
  summaryFiles: number | null
  messages: SessionMessage[]
}

/** Load full session detail by session ID, including all messages and tool calls. */
export function loadSessionDetail(db: Database, sessionId: string): SessionDetail | null {
  // Load session metadata
  const session = db
    .prepare<{
      id: string
      title: string | null
      directory: string | null
      time_created: number
      time_updated: number
      summary_additions: number | null
      summary_deletions: number | null
      summary_files: number | null
    }>(
      `SELECT id, title, directory, time_created, time_updated,
              summary_additions, summary_deletions, summary_files
       FROM session WHERE id = ?`
    )
    .get([sessionId])

  if (!session) return null

  // Load all messages (assistant + user) ordered by time
  const rawMessages = db
    .prepare<{ id: string; time_created: number; data: string }>(
      `SELECT id, time_created, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created ASC`
    )
    .all([sessionId])

  // Load all tool-call parts for this session in one query
  const rawParts = db
    .prepare<{ message_id: string; data: string }>(
      `SELECT p.message_id, p.data
       FROM part p
       JOIN message m ON p.message_id = m.id
       WHERE m.session_id = ?
         AND p.data LIKE '%"type":"tool"%'
       ORDER BY p.time_created ASC`
    )
    .all([sessionId])

  // Group parts by message_id
  const partsByMessage = new Map<string, SessionToolCall[]>()
  for (const row of rawParts) {
    let d: Record<string, unknown>
    try {
      d = JSON.parse(row.data) as Record<string, unknown>
    } catch {
      continue
    }
    if (d.type !== 'tool') continue

    const tool = (d.tool as string | undefined) ?? 'unknown'
    const callId = (d.callID as string | undefined) ?? ''
    const state = d.state as Record<string, unknown> | undefined
    const status = (state?.status as string | undefined) ?? 'unknown'
    const outputTruncated =
      (state?.metadata as Record<string, unknown> | undefined)?.truncated === true

    // Build a compact input summary based on tool type
    const input = (state?.input as Record<string, unknown> | undefined) ?? {}
    const inputSummary = summariseToolInput(tool, input)

    const list = partsByMessage.get(row.message_id) ?? []
    list.push({ callId, tool, status, inputSummary, outputTruncated })
    partsByMessage.set(row.message_id, list)
  }

  // Build message list
  const messages: SessionMessage[] = []
  for (const row of rawMessages) {
    let d: Record<string, unknown>
    try {
      d = JSON.parse(row.data) as Record<string, unknown>
    } catch {
      continue
    }

    const role = d.role as 'assistant' | 'user'
    if (role !== 'assistant' && role !== 'user') continue

    const tokRaw = d.tokens as Record<string, unknown> | undefined
    const cacheRaw = tokRaw?.cache as Record<string, unknown> | undefined
    const timeRaw = d.time as Record<string, unknown> | undefined

    messages.push({
      messageId: row.id,
      timeCreated: row.time_created,
      timeCompleted: (timeRaw?.completed as number | undefined) ?? null,
      role,
      modelId: (d.modelID as string | undefined) ?? null,
      providerId: (d.providerID as string | undefined) ?? null,
      agent: (d.agent as string | undefined) ?? null,
      mode: (d.mode as string | undefined) ?? null,
      tokens: {
        input: (tokRaw?.input as number | undefined) ?? 0,
        output: (tokRaw?.output as number | undefined) ?? 0,
        cacheRead: (cacheRaw?.read as number | undefined) ?? 0,
        cacheWrite: (cacheRaw?.write as number | undefined) ?? 0,
        reasoning: (tokRaw?.reasoning as number | undefined) ?? 0,
        total: (tokRaw?.total as number | undefined) ?? 0,
      },
      cost: (d.cost as number | undefined) ?? 0,
      finish: (d.finish as string | undefined) ?? null,
      tools: partsByMessage.get(row.id) ?? [],
    })
  }

  return {
    sessionId: session.id,
    title: session.title,
    directory: session.directory,
    timeCreated: session.time_created,
    timeUpdated: session.time_updated,
    summaryAdditions: session.summary_additions,
    summaryDeletions: session.summary_deletions,
    summaryFiles: session.summary_files,
    messages,
  }
}

/** Build a one-line human-readable summary of a tool's input. */
function summariseToolInput(tool: string, input: Record<string, unknown>): string | null {
  // File/path tools
  if (input.path) return String(input.path)
  if (input.filePath) return String(input.filePath)
  if (input.relative_path) return String(input.relative_path)
  if (input.pattern) return String(input.pattern)
  // Code tools
  if (input.command) return String(input.command).slice(0, 80)
  if (input.description) return String(input.description).slice(0, 80)
  if (input.query) return String(input.query).slice(0, 80)
  if (input.url) return String(input.url).slice(0, 80)
  if (input.symbol) return String(input.symbol)
  if (input.name_path_pattern) return String(input.name_path_pattern)
  // Catch-all: first string value
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 80)
  }
  return null
}
