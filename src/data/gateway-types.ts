/**
 * Gateway metrics integration types.
 *
 * GatewayMetrics is the normalised output from any configured API gateway
 * (LiteLLM, OpenRouter, LangFuse, custom). It is populated via JSONPath
 * mappings defined in GatewayConfig and consumed by all CLI commands.
 */

export interface GatewayMetrics {
  // ─── User/key-level spend ──────────────────────────────────────────────────
  /** Total spend in USD as reported by the gateway. */
  totalSpend: number
  /** Hard budget cap in USD, or null if unlimited. */
  budgetLimit: number | null
  /** ISO 8601 timestamp of the next budget reset, or null. */
  budgetResetAt: string | null
  /** Human-readable budget reset interval (e.g. "1mo", "30d"), or null. */
  budgetDuration: string | null

  // ─── Team/org-level spend (optional) ──────────────────────────────────────
  /** Team/org total spend in USD, or null if not available. */
  teamSpend: number | null
  /** Team/org budget cap in USD, or null. */
  teamBudgetLimit: number | null
  /** Team/org name or alias, or null. */
  teamName: string | null

  // ─── Metadata ─────────────────────────────────────────────────────────────
  /** Unix epoch ms when this record was fetched from the gateway. */
  fetchedAt: number
  /** True if this record was returned from the local cache. */
  cached: boolean
  /** The gateway endpoint that was queried. */
  endpoint: string
}

// ─── LiteLLM auto-discovery types ────────────────────────────────────────────

/**
 * Per-model actual spend from the LiteLLM /spend/logs endpoint.
 * Model names include provider prefix (e.g. "vertex_ai/claude-opus-4-6").
 */
export interface GatewayModelSpend {
  /** Gateway model name including provider prefix. */
  model: string
  /** Actual spend in USD for this model in the queried date range. */
  spend: number
}

/**
 * Per-model metrics from one day of /user/daily/activity.
 */
export interface GatewayDailyModelMetrics {
  model: string
  spend: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  apiRequests: number
}

/**
 * One day of aggregate + per-model breakdown from /user/daily/activity.
 */
export interface GatewayDailyActivity {
  date: string
  totalSpend: number
  totalRequests: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  models: GatewayDailyModelMetrics[]
}

/**
 * Response from the LiteLLM model spend endpoint (/spend/logs).
 */
export interface GatewayModelSpendResult {
  /** Per-model spend (raw, including provider prefixes). */
  modelSpend: GatewayModelSpend[]
  /** Total spend across all models. */
  totalSpend: number
  fetchedAt: number
  cached: boolean
  endpoint: string
}

/**
 * Response from the LiteLLM daily activity endpoint (/user/daily/activity).
 */
export interface GatewayDailyActivityResult {
  days: GatewayDailyActivity[]
  fetchedAt: number
  cached: boolean
  endpoint: string
}

/**
 * Which LiteLLM standard endpoints are available on this gateway.
 */
export interface LiteLLMEndpointAvailability {
  spendLogs: boolean
  dailyActivity: boolean
  modelInfo: boolean
}

/**
 * A permanent daily snapshot of gateway spend written at the end of each day.
 * Past days' costs are immutable so these are kept indefinitely.
 */
export interface GatewayDailySnapshot {
  /** YYYY-MM-DD */
  date: string
  /** Unix epoch ms when this snapshot was written. */
  fetchedAt: number
  /** Total spend in USD at the time of the last fetch on this day. */
  totalSpend: number
  /** Team spend in USD at the time of the last fetch, or null. */
  teamSpend: number | null
  /** The gateway endpoint used. */
  endpoint: string
}
