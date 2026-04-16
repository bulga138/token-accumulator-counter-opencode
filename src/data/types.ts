// Core data types for the OpenCode SQLite database model

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
}

export interface UsageEvent {
  // Message identifiers
  messageId: string
  sessionId: string

  // Session metadata
  sessionTitle: string | null
  sessionDirectory: string | null
  sessionParentId: string | null
  projectId: string | null

  // Timing (Unix epoch ms)
  timeCreated: number
  timeCompleted: number | null

  // Model info
  modelId: string
  providerId: string

  // Agent type (build, plan, explore, etc.)
  agent: string | null

  // Token usage
  tokens: TokenUsage

  // Cost in USD
  cost: number

  // Finish reason (stop, length, error, etc.)
  finish: string | null
}

export interface SessionRecord {
  id: string
  title: string | null
  directory: string | null
  parentId: string | null
  projectId: string | null
  timeCreated: number
  timeUpdated: number
}

// ─── Aggregated analytics types ───────────────────────────────────────────────

export interface TokenSummary {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
}

export function emptyTokenSummary(): TokenSummary {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
}

export function addTokens(a: TokenSummary, b: TokenUsage): TokenSummary {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
    total: a.total + b.total,
  }
}

export interface OverviewStats {
  tokens: TokenSummary
  cost: number
  sessionCount: number
  messageCount: number
  activedays: number
  totalDays: number
  modelsUsed: string[]
  favoriteModel: string | null
  // Streaks
  currentStreak: number
  longestStreak: number
  mostActiveDay: string | null // YYYY-MM-DD
  longestSessionMs: number
  avgCostPerDay: number
  /** Counts of each finish reason (stop, length, error, etc.) */
  finishReasons: Record<string, number>
}

export interface ModelStats {
  modelId: string
  /** Primary provider for this model */
  providerId: string
  tokens: TokenSummary
  cost: number
  /**
   * True when the provider records $0 cost because billing is handled
   * externally (e.g. GitHub Copilot corporate plan, opencode provider).
   * The model is NOT free — cost is just not tracked per-token by OpenCode.
   */
  billedExternally: boolean
  messageCount: number
  sessionCount: number
  activeDays: number
  percentage: number // % of total tokens
  // Tokens per second (median output speed)
  medianOutputTps: number | null
  // Daily token series for chart: array of { date: "YYYY-MM-DD", tokens: number }
  dailySeries: DailySeries[]
  /** Counts of each finish reason */
  finishReasons: Record<string, number>
}

export interface ProviderStats {
  providerId: string
  tokens: TokenSummary
  cost: number
  messageCount: number
  sessionCount: number
  activeDays: number
  percentage: number
}

export interface AgentStats {
  agent: string
  tokens: TokenSummary
  cost: number
  messageCount: number
  sessionCount: number
  percentage: number
}

export interface DailyStats {
  date: string // YYYY-MM-DD
  tokens: TokenSummary
  cost: number
  sessionCount: number
  messageCount: number
}

export interface ProjectStats {
  directory: string
  tokens: TokenSummary
  cost: number
  sessionCount: number
  messageCount: number
}

export interface SessionStats {
  sessionId: string
  title: string | null
  directory: string | null
  timeCreated: number
  tokens: TokenSummary
  cost: number
  messageCount: number
  durationMs: number | null
  models: string[]
  /** Counts of each finish reason */
  finishReasons: Record<string, number>
}

export interface DailySeries {
  date: string // YYYY-MM-DD
  tokens: number // total tokens that day
}

export interface PeriodStats {
  label: string // e.g. "Apr 7 - Apr 13"
  startDate: string // YYYY-MM-DD
  endDate: string
  tokens: TokenSummary
  cost: number
  sessionCount: number
  messageCount: number
  deltaPercent: number | null // % change vs previous period
}

// ─── Filter / query options ────────────────────────────────────────────────────

// Default query limits to prevent memory overflow
export const DEFAULT_QUERY_LIMIT = 100000 // Max 100k events per query
export const DEFAULT_DATE_RANGE_DAYS = 90 // Default to last 90 days

export interface QueryFilters {
  from?: Date
  to?: Date
  model?: string
  provider?: string
  project?: string
  agent?: string
  limit?: number // Hard limit on number of results
}

export type OutputFormat = 'visual' | 'json' | 'csv' | 'markdown'
export type SortField = 'cost' | 'tokens' | 'date' | 'messages'
export type TrendPeriod = 'day' | 'week' | 'month'
