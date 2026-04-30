/**
 * Reader for the taco-plugin sidecar DB (~/.local/share/taco/plugin.db).
 *
 * Uses the same multi-driver strategy as db.ts (better-sqlite3 → sql.js).
 * The plugin DB is optional — all functions return null/[] if unavailable.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Database } from './db.js'

export const PLUGIN_DB_PATH = join(homedir(), '.local', 'share', 'taco', 'plugin.db')

let _initPromise: Promise<Database | null> | null = null

async function openPluginDb(): Promise<Database | null> {
  if (!existsSync(PLUGIN_DB_PATH)) return null
  try {
    const isBun = typeof Bun !== 'undefined' && (Bun as { version?: string }).version !== undefined
    if (isBun) {
      const { Database: BunDatabase } = (await import('bun:sqlite')) as unknown as {
        Database: new (
          path: string,
          opts: object
        ) => {
          query: (sql: string) => {
            all: (...a: unknown[]) => unknown[]
            get: (...a: unknown[]) => unknown
            run: (...a: unknown[]) => { changes?: number }
            iterate: (...a: unknown[]) => IterableIterator<unknown>
          }
        }
      }
      const db = new BunDatabase(PLUGIN_DB_PATH, { readonly: true })
      return {
        prepare<T>(sql: string) {
          const stmt = db.query(sql)
          return {
            all(params: unknown[] = []): T[] {
              return stmt.all(...params) as T[]
            },
            get(params: unknown[] = []): T | undefined {
              return stmt.get(...params) as T | undefined
            },
            run(params: unknown[] = []): { changes: number } {
              const r = stmt.run(...params)
              return { changes: (r as { changes?: number }).changes ?? 0 }
            },
            *iterate(params: unknown[] = []): IterableIterator<T> {
              for (const row of stmt.iterate(...params)) yield row as T
            },
          }
        },
      }
    }

    try {
      const betterSqlite3 = await import('better-sqlite3')
      const mod = (betterSqlite3.default || betterSqlite3) as (path: string) => unknown
      const rawDb = mod(PLUGIN_DB_PATH) as {
        prepare: (sql: string) => {
          all: (...args: unknown[]) => unknown[]
          get: (...args: unknown[]) => unknown
          run: (...args: unknown[]) => { changes: number }
          iterate: (...args: unknown[]) => IterableIterator<unknown>
        }
        close: () => void
      }
      return {
        prepare<T>(sql: string) {
          const stmt = rawDb.prepare(sql)
          return {
            all(params: unknown[] = []): T[] {
              return stmt.all(...params) as T[]
            },
            get(params: unknown[] = []): T | undefined {
              return stmt.get(...params) as T | undefined
            },
            run(params: unknown[] = []): { changes: number } {
              return stmt.run(...params)
            },
            iterate(params: unknown[] = []): IterableIterator<T> {
              return stmt.iterate(...params) as IterableIterator<T>
            },
          }
        },
      }
    } catch {
      // fall through to sql.js
    }

    const initSqlJs = await import('sql.js')
    const SQL = await (
      initSqlJs.default as (opts?: unknown) => Promise<{ Database: new (buf: Buffer) => unknown }>
    )()
    const fileBuffer = readFileSync(PLUGIN_DB_PATH)
    const rawDb = new SQL.Database(fileBuffer) as {
      prepare: (sql: string) => {
        bind: (params: unknown[]) => void
        step: () => boolean
        getAsObject: () => unknown
        free: () => void
      }
      run: (sql: string, params?: unknown[]) => void
      getRowsModified: () => number
    }
    return {
      prepare<T>(sql: string) {
        return {
          all(params: unknown[] = []): T[] {
            const stmt = rawDb.prepare(sql)
            if (params.length > 0) stmt.bind(params)
            const results: T[] = []
            while (stmt.step()) results.push(stmt.getAsObject() as T)
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
              while (stmt.step()) yield stmt.getAsObject() as T
            } finally {
              stmt.free()
            }
          },
        }
      },
    }
  } catch {
    return null
  }
}

export async function getPluginDbAsync(): Promise<Database | null> {
  if (_initPromise) return _initPromise
  _initPromise = openPluginDb()
  return _initPromise
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PluginChatParams {
  id: string
  sessionId: string
  timestamp: number
  modelId: string
  providerId: string
  agent: string | null
  temperature: number | null
  topP: number | null
  topK: number | null
  maxOutputTokens: number | null
  modelContextLimit: number | null
  modelOutputLimit: number | null
  costInput: number | null
  costOutput: number | null
  costCacheRead: number | null
  costCacheWrite: number | null
}

export interface PluginToolCall {
  id: string
  sessionId: string
  messageId: string
  tool: string
  timestampStart: number | null
  timestampEnd: number | null
  durationMs: number | null
  status: string
  inputJson: string
  inputSizeBytes: number | null
  inputEstimatedTokens: number | null
  outputText: string | null
  outputCompressed: number
  outputSizeBytes: number | null
  outputEstimatedTokens: number | null
  nextTurnTokenImpact: number | null
  costShare: number | null
  title: string | null
  truncated: number
  errorText: string | null
}

export interface PluginStepMetrics {
  id: string
  sessionId: string
  messageId: string
  timestamp: number
  reason: string
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
}

export interface PluginStreamingTiming {
  messageId: string
  sessionId: string
  requestSent: number | null
  firstPartReceived: number | null
  firstTextReceived: number | null
  firstToolCall: number | null
  messageCompleted: number | null
  timeToFirstTokenMs: number | null
  totalStreamingMs: number | null
}

export interface PluginContextSnapshot {
  id: string
  sessionId: string
  timestamp: number
  messageCount: number
  totalParts: number
  toolParts: number
  textParts: number
  estimatedTokens: number | null
  contextUtilization: number | null
  systemTokenPct: number | null
  toolOutputTokenPct: number | null
  conversationTokenPct: number | null
}

export interface PluginTokenEstimate {
  messageId: string
  sessionId: string
  approach: string
  modelId: string
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
  timestamp: number
}

export interface PluginSystemPrompt {
  sessionId: string
  modelId: string
  timestamp: number
  contentHash: string
  content: string
  tokenCount: number | null
}

// ─── Session-scoped readers ─���─────────────────────────────────────────────────

export async function loadPluginChatParams(sessionId: string): Promise<PluginChatParams[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginChatParams>(
        `SELECT id, session_id AS sessionId, timestamp, model_id AS modelId, provider_id AS providerId, agent, temperature, top_p AS topP, top_k AS topK, max_output_tokens AS maxOutputTokens, model_context_limit AS modelContextLimit, model_output_limit AS modelOutputLimit, cost_input AS costInput, cost_output AS costOutput, cost_cache_read AS costCacheRead, cost_cache_write AS costCacheWrite FROM chat_params WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginToolCalls(sessionId: string): Promise<PluginToolCall[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginToolCall>(
        `SELECT id, session_id AS sessionId, message_id AS messageId, tool, timestamp_start AS timestampStart, timestamp_end AS timestampEnd, duration_ms AS durationMs, status, input_json AS inputJson, input_size_bytes AS inputSizeBytes, input_estimated_tokens AS inputEstimatedTokens, output_text AS outputText, output_compressed AS outputCompressed, output_size_bytes AS outputSizeBytes, output_estimated_tokens AS outputEstimatedTokens, next_turn_token_impact AS nextTurnTokenImpact, cost_share AS costShare, title, truncated, error_text AS errorText FROM tool_calls WHERE session_id = ? ORDER BY timestamp_start ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginStepMetrics(sessionId: string): Promise<PluginStepMetrics[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginStepMetrics>(
        `SELECT id, session_id AS sessionId, message_id AS messageId, timestamp, reason, cost, tokens_input AS tokensInput, tokens_output AS tokensOutput, tokens_reasoning AS tokensReasoning, tokens_cache_read AS tokensCacheRead, tokens_cache_write AS tokensCacheWrite FROM step_metrics WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginStreamingTiming(
  sessionId: string
): Promise<PluginStreamingTiming[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginStreamingTiming>(
        `SELECT message_id AS messageId, session_id AS sessionId, request_sent AS requestSent, first_part_received AS firstPartReceived, first_text_received AS firstTextReceived, first_tool_call AS firstToolCall, message_completed AS messageCompleted, time_to_first_token_ms AS timeToFirstTokenMs, total_streaming_ms AS totalStreamingMs FROM streaming_timing WHERE session_id = ? ORDER BY request_sent ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginContextSnapshots(
  sessionId: string
): Promise<PluginContextSnapshot[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginContextSnapshot>(
        `SELECT id, session_id AS sessionId, timestamp, message_count AS messageCount, total_parts AS totalParts, tool_parts AS toolParts, text_parts AS textParts, estimated_tokens AS estimatedTokens, context_utilization AS contextUtilization, system_token_pct AS systemTokenPct, tool_output_token_pct AS toolOutputTokenPct, conversation_token_pct AS conversationTokenPct FROM context_snapshots WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginTokenEstimates(sessionId: string): Promise<PluginTokenEstimate[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginTokenEstimate>(
        `SELECT message_id AS messageId, session_id AS sessionId, approach, model_id AS modelId, input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens, total_tokens AS totalTokens, estimated_cost AS estimatedCost, timestamp FROM token_estimates WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginSystemPrompts(sessionId: string): Promise<PluginSystemPrompt[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginSystemPrompt>(
        `SELECT session_id AS sessionId, model_id AS modelId, timestamp, content_hash AS contentHash, content, token_count AS tokenCount FROM system_prompts WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

// ─── v3 Types ─────────────────────────────────────────────────────────────────

export interface PluginRetrievalRelevance {
  id: number
  sessionId: string
  messageId: string
  toolCallId: string
  tool: string
  fetchedTokens: number
  fetchedLines: number | null
  referencedTokens: number | null
  referencedLines: number | null
  relevanceRatio: number | null
  scoringMethod: string
  timestamp: number
}

export interface PluginToolLatencyBreakdown {
  id: number
  toolCallId: string
  sessionId: string
  phase: string
  durationMs: number
  metadataJson: string | null
  timestamp: number
}

export interface PluginBenchmarkRun {
  id: number
  taskId: string
  sessionId: string
  strategy: string
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalCost: number | null
  totalToolCalls: number | null
  totalFetchedTokens: number | null
  totalReferencedTokens: number | null
  precisionScore: number | null
  avgRelevance: number | null
  avgTtftMs: number | null
  avgToolDurationMs: number | null
  totalSessionMs: number | null
  avgQueryMs: number | null
  p50QueryMs: number | null
  p95QueryMs: number | null
  timestamp: number
}

// ─── v3 Session-scoped readers ────────────────────────────────────────────────

export async function loadPluginRetrievalRelevance(
  sessionId: string
): Promise<PluginRetrievalRelevance[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginRetrievalRelevance>(
        `SELECT id, session_id AS sessionId, message_id AS messageId, tool_call_id AS toolCallId, tool, fetched_tokens AS fetchedTokens, fetched_lines AS fetchedLines, referenced_tokens AS referencedTokens, referenced_lines AS referencedLines, relevance_ratio AS relevanceRatio, scoring_method AS scoringMethod, timestamp FROM retrieval_relevance WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginToolLatencyBreakdown(
  sessionId: string
): Promise<PluginToolLatencyBreakdown[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginToolLatencyBreakdown>(
        `SELECT id, tool_call_id AS toolCallId, session_id AS sessionId, phase, duration_ms AS durationMs, metadata_json AS metadataJson, timestamp FROM tool_latency_breakdown WHERE session_id = ? ORDER BY timestamp ASC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadPluginBenchmarkRuns(sessionId: string): Promise<PluginBenchmarkRun[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginBenchmarkRun>(
        `SELECT id, task_id AS taskId, session_id AS sessionId, strategy, total_input_tokens AS totalInputTokens, total_output_tokens AS totalOutputTokens, total_cost AS totalCost, total_tool_calls AS totalToolCalls, total_fetched_tokens AS totalFetchedTokens, total_referenced_tokens AS totalReferencedTokens, precision_score AS precisionScore, avg_relevance AS avgRelevance, avg_ttft_ms AS avgTtftMs, avg_tool_duration_ms AS avgToolDurationMs, total_session_ms AS totalSessionMs, avg_query_ms AS avgQueryMs, p50_query_ms AS p50QueryMs, p95_query_ms AS p95QueryMs, timestamp FROM benchmark_runs WHERE session_id = ? ORDER BY timestamp DESC`
      )
      .all([sessionId])
    return rows
  } catch {
    return []
  }
}

export async function loadBenchmarkRunsByTask(taskId: string): Promise<PluginBenchmarkRun[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const rows = db
      .prepare<PluginBenchmarkRun>(
        `SELECT id, task_id AS taskId, session_id AS sessionId, strategy, total_input_tokens AS totalInputTokens, total_output_tokens AS totalOutputTokens, total_cost AS totalCost, total_tool_calls AS totalToolCalls, total_fetched_tokens AS totalFetchedTokens, total_referenced_tokens AS totalReferencedTokens, precision_score AS precisionScore, avg_relevance AS avgRelevance, avg_ttft_ms AS avgTtftMs, avg_tool_duration_ms AS avgToolDurationMs, total_session_ms AS totalSessionMs, avg_query_ms AS avgQueryMs, p50_query_ms AS p50QueryMs, p95_query_ms AS p95QueryMs, timestamp FROM benchmark_runs WHERE task_id = ? ORDER BY timestamp DESC`
      )
      .all([taskId])
    return rows
  } catch {
    return []
  }
}

// ─── Cross-session readers (for benchmark) ────────────────────────────────────

export interface ToolCostStat {
  tool: string
  callCount: number
  truncatedCount: number
  avgDurationMs: number | null
  totalInputTokens: number
  totalOutputTokens: number
  avgInputTokens: number
  avgOutputTokens: number
  avgNextTurnImpact: number | null
  avgCostShare: number | null
  totalCostShare: number | null
}

export async function loadToolCostStats(sessionIds?: string[]): Promise<ToolCostStat[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const where =
      sessionIds && sessionIds.length > 0
        ? `WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
        : ''
    const params = sessionIds ?? []
    const rows = db
      .prepare<ToolCostStat>(
        `SELECT tool, COUNT(*) AS callCount, SUM(COALESCE(truncated, 0)) AS truncatedCount, AVG(duration_ms) AS avgDurationMs, SUM(COALESCE(input_estimated_tokens, 0)) AS totalInputTokens, SUM(COALESCE(output_estimated_tokens, 0)) AS totalOutputTokens, AVG(COALESCE(input_estimated_tokens, 0)) AS avgInputTokens, AVG(COALESCE(output_estimated_tokens, 0)) AS avgOutputTokens, AVG(next_turn_token_impact) AS avgNextTurnImpact, AVG(cost_share) AS avgCostShare, SUM(cost_share) AS totalCostShare FROM tool_calls ${where} GROUP BY tool ORDER BY callCount DESC`
      )
      .all(params)
    return rows
  } catch {
    return []
  }
}

export interface CacheEfficiencyStat {
  modelId: string
  totalMessages: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  freshInputTokens: number
  cacheReadPct: number
  cacheWritePct: number
  freshInputPct: number
}

export async function loadCacheEfficiencyStats(
  sessionIds?: string[]
): Promise<CacheEfficiencyStat[]> {
  const db = await getPluginDbAsync()
  if (!db) return []
  try {
    const where =
      sessionIds && sessionIds.length > 0
        ? `WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
        : ''
    const params = sessionIds ?? []
    const rows = db
      .prepare<{
        modelId: string
        totalMessages: number
        totalTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
        freshInputTokens: number
      }>(
        `SELECT model_id AS modelId, COUNT(*) AS totalMessages, SUM(COALESCE(total_tokens, 0)) AS totalTokens, SUM(COALESCE(cache_read_tokens, 0)) AS cacheReadTokens, SUM(COALESCE(cache_write_tokens, 0)) AS cacheWriteTokens, SUM(COALESCE(input_tokens, 0)) AS freshInputTokens FROM token_estimates WHERE approach = 'opencode' ${where ? 'AND ' + where.replace('WHERE ', '') : ''} GROUP BY model_id ORDER BY totalTokens DESC`
      )
      .all(params)
    return rows.map(r => {
      const total = r.totalTokens || 1
      return {
        ...r,
        cacheReadPct: r.cacheReadTokens / total,
        cacheWritePct: r.cacheWriteTokens / total,
        freshInputPct: r.freshInputTokens / total,
      }
    })
  } catch {
    return []
  }
}
