import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

// ─── Gateway integration types ─────────────────────────────────────────────────

/**
 * Authentication strategy for the gateway endpoint.
 * String values prefixed with "${VAR_NAME}" are resolved from process.env at
 * runtime so secrets are never stored in the config file.
 */
export interface GatewayAuth {
  /** Auth scheme to use. */
  type: 'bearer' | 'basic' | 'header'
  /**
   * Bearer token value or env-var reference (e.g. "${LITELLM_API_KEY}").
   * Used when type === "bearer".
   */
  tokenOrEnv?: string
  /** Basic-auth username or env-var reference. Used when type === "basic". */
  usernameOrEnv?: string
  /** Basic-auth password or env-var reference. Used when type === "basic". */
  passwordOrEnv?: string
  /** Custom HTTP header name. Used when type === "header". */
  headerName?: string
  /** Custom header value or env-var reference. Used when type === "header". */
  headerValueOrEnv?: string
}

/**
 * JSONPath expressions that map fields from the gateway response to the
 * standard GatewayMetrics structure. Only totalSpend is required; all others
 * are optional and will show as null when omitted or not found.
 *
 * Supported path syntax: $.a.b[0].c  (dot + array index notation only).
 */
export interface GatewayFieldMapping {
  /** Path to current spend in USD. Required. e.g. "$.user_info.spend" */
  totalSpend: string
  /** Path to budget cap in USD. e.g. "$.user_info.max_budget" */
  budgetLimit?: string
  /** Path to next budget reset (ISO 8601). e.g. "$.user_info.budget_reset_at" */
  budgetResetAt?: string
  /** Path to budget period string. e.g. "$.user_info.budget_duration" */
  budgetDuration?: string
  /** Path to team/org spend. e.g. "$.teams[0].spend" */
  teamSpend?: string
  /** Path to team/org budget cap. e.g. "$.teams[0].max_budget" */
  teamBudgetLimit?: string
  /** Path to team/org name. e.g. "$.teams[0].team_alias" */
  teamName?: string
}

/**
 * JSONPath mappings for a date-range metrics endpoint.
 *
 * Used by `dailyMetricsEndpoint` to extract today-only spend and per-model
 * breakdown from an endpoint that accepts start_date / end_date query params.
 *
 * The response shape this is designed for:
 * {
 *   "summary": { "total_spend": 80.32, "max_budget": 600.0 },
 *   "model_spend": [{ "model": "vertex_ai/...", "spend": 57.85 }],
 *   "daily": [{ "date": "2026-04-27", "spend": 80.32, "prompt_tokens": ... }]
 * }
 */
export interface DailyMetricsFieldMapping {
  /** JSONPath to today's total spend. e.g. "$.summary.total_spend" */
  totalSpend: string
  /**
   * JSONPath to the array of per-model spend objects.
   * Each element must have a "model" string and a "spend" number.
   * e.g. "$.model_spend"
   */
  modelSpend?: string
  /**
   * Within each model_spend element, the field names for model name and spend.
   * Defaults to { model: "model", spend: "spend" }.
   */
  modelSpendFields?: {
    model: string
    spend: string
  }
}

/**
 * Full configuration block for one gateway endpoint.
 *
 * Example (LiteLLM):
 * {
 *   "endpoint": "https://ai-gateway.company.com/user/info",
 *   "auth": { "type": "bearer", "tokenOrEnv": "${LITELLM_API_KEY}" },
 *   "mappings": {
 *     "totalSpend": "$.user_info.spend",
 *     "budgetLimit": "$.user_info.max_budget",
 *     "budgetResetAt": "$.user_info.budget_reset_at",
 *     "teamSpend": "$.teams[0].spend",
 *     "teamBudgetLimit": "$.teams[0].max_budget",
 *     "teamName": "$.teams[0].team_alias"
 *   },
 *   "cacheTtlMinutes": 15
 * }
 */
export interface GatewayConfig {
  /** Full URL of the metrics endpoint. */
  endpoint: string
  /** HTTP method (default: "GET"). */
  method?: 'GET' | 'POST'
  /** Optional query-string parameters. Env-var references resolved at runtime. */
  queryParams?: Record<string, string>
  /** Optional JSON request body for POST endpoints. */
  body?: Record<string, unknown>
  /** Authentication configuration. */
  auth: GatewayAuth
  /** JSONPath mappings from the response to standard metric fields. */
  mappings: GatewayFieldMapping
  /**
   * Optional secondary endpoint that accepts start_date / end_date query params
   * and returns spend data for that specific date range.
   *
   * When configured, `taco today` calls this endpoint with today's date to show
   * real today-only gateway spend (instead of billing-period totals).
   * The same auth config as the primary endpoint is used.
   */
  dailyMetricsEndpoint?: {
    /** Full URL. start_date and end_date query params will be appended automatically. */
    url: string
    /** JSONPath mappings to extract spend and model breakdown from the response. */
    mappings: DailyMetricsFieldMapping
  }
  /**
   * How long (in minutes) to cache live gateway data.
   * Defaults to 15. Set to 0 to always fetch fresh data.
   * Historical daily snapshots are kept permanently regardless of this setting.
   */
  cacheTtlMinutes?: number
}

// ─── Main config interface ─────────────────────────────────────────────────────

export interface TacoConfig {
  db?: string
  defaultFormat?: 'visual' | 'json' | 'csv' | 'markdown'
  defaultRange?: string
  currency?: string
  budget?: {
    daily?: number
    monthly?: number
  }
  /**
   * Optional API gateway integration.
   * When set, TACO fetches real spend/budget data from the gateway and
   * displays it alongside OpenCode's local cost estimates.
   */
  gateway?: GatewayConfig
}

const CONFIG_PATH = join(homedir(), '.config', 'taco', 'config.json')

let _config: TacoConfig | null = null

export function getConfig(): TacoConfig {
  if (_config !== null) return _config

  if (!existsSync(CONFIG_PATH)) {
    _config = {}
    return _config
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    _config = JSON.parse(raw) as TacoConfig
  } catch {
    console.warn(`[taco] Warning: Could not parse config at ${CONFIG_PATH}`)
    _config = {}
  }

  return _config
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

/** Write config to disk, creating directories as needed. */
export function saveConfig(config: TacoConfig): void {
  const dir = join(homedir(), '.config', 'taco')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  _config = config // invalidate cache
}

/** Reset the in-memory config cache (useful in tests). */
export function resetConfig(): void {
  _config = null
}
