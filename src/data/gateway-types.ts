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
 * Discovered by probing each path and checking for non-404/405 responses.
 */
export interface LiteLLMEndpointAvailability {
  // Spend / billing endpoints
  spendLogs: boolean // GET /spend/logs?start_date=&end_date=
  dailyActivity: boolean // GET /user/daily/activity?start_date=&end_date=
  spendTags: boolean // GET /spend/tags
  // Model endpoints
  modelInfo: boolean // GET /model/info
  models: boolean // GET /models  (OpenAI-compatible model list)
  // Key / user endpoints
  keyInfo: boolean // GET /key/info  (per-key spend + budget)
  userInfo: boolean // GET /user/info  (per-user spend + budget)
  // Global / admin endpoints (may be 401 for non-admins)
  globalSpendModels: boolean // GET /global/spend/models
  // Health
  healthReadiness: boolean // GET /health/readiness
}

/**
 * Per-key metadata from the LiteLLM /key/info endpoint.
 * More accurate than /user/info for per-key spend tracking.
 */
export interface GatewayKeyInfo {
  /** Hashed key identifier. */
  keyHash: string
  /** Obfuscated key name (e.g. "sk-...lRhg"). */
  keyName: string | null
  /** Total spend billed to this key in USD. */
  spend: number
  /** Max budget for this key in USD, or null if unlimited. */
  maxBudget: number | null
  /** When this budget resets, or null. */
  budgetResetAt: string | null
  /** Budget period string (e.g. "1mo"), or null. */
  budgetDuration: string | null
  /** User ID that owns this key. */
  userId: string | null
  /** Team ID this key belongs to. */
  teamId: string | null
  /** ISO timestamp of last API call. */
  lastActive: string | null
}

/**
 * Result from a date-range metrics endpoint (e.g. /self-service-proxy/v1/metrics/).
 * Contains today-scoped (or any date-range-scoped) spend and per-model breakdown.
 */
export interface GatewayDailyMetricsResult {
  /** Total spend for the queried date range in USD. */
  totalSpend: number
  /** Per-model spend for the queried date range. Raw model names including provider prefix. */
  modelSpend: GatewayModelSpend[]
  fetchedAt: number
  cached: boolean
  endpoint: string
}

/**
 * A permanent daily snapshot of actual per-day gateway spend.
 *
 * Written from /user/daily/activity responses. Past days are immutable so
 * each file is written once and kept forever. Today's file is overwritten
 * on each fetch until the day ends.
 *
 * Stored as gateway-daily/YYYY-MM-DD.json.
 * Version 2 adds full token breakdown and per-model data.
 */
export interface GatewayDailySnapshot {
  /** YYYY-MM-DD */
  date: string
  /** Schema version — 1 = legacy cumulative billing total, 2 = actual daily spend from /user/daily/activity */
  version: 1 | 2
  /** Unix epoch ms when this snapshot was written. */
  fetchedAt: number
  /** Actual spend for this specific day in USD (version 2) or cumulative billing total (version 1). */
  totalSpend: number
  /** Team spend in USD (version 1 only, cumulative). Omitted in version 2. */
  teamSpend?: number | null
  /** Total tokens processed this day (version 2 only). */
  totalTokens?: number
  /** Prompt/input tokens (version 2 only). */
  promptTokens?: number
  /** Completion/output tokens (version 2 only). */
  completionTokens?: number
  /** Cache read tokens (version 2 only). */
  cacheReadTokens?: number
  /** Cache creation/write tokens (version 2 only). */
  cacheCreationTokens?: number
  /** Total API requests (version 2 only). */
  totalRequests?: number
  /** Per-model spend breakdown for this day (version 2 only). */
  models?: Array<{
    model: string
    spend: number
    totalTokens: number
  }>
  /** The gateway endpoint used. */
  endpoint: string
}
