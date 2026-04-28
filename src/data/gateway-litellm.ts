/**
 * LiteLLM-compliant gateway auto-discovery and data fetching.
 *
 * When a gateway is configured, TACO derives the base URL from the primary
 * endpoint and probes standard LiteLLM API paths:
 *
 *   /spend/logs             → per-model actual spend by date range
 *   /user/daily/activity    → per-model daily breakdown with tokens
 *   /spend/tags             → spend broken down by user-agent / request tag
 *   /model/info             → per-model pricing rates
 *   /models                 → available model IDs (OpenAI-compatible)
 *   /key/info               → per-key spend + budget (more accurate than /user/info)
 *   /user/info              → per-user spend + budget
 *   /global/spend/models    → org-wide model spend (admin only)
 *   /health/readiness       → gateway health status
 *
 *
 * All functions fail gracefully (return null) so callers continue working
 * with local-only data when the gateway is unavailable or non-standard.
 *
 * Uses Node's built-in fetch() — no additional dependencies.
 */

import type { GatewayAuth, GatewayConfig } from '../config/index.js'
import type {
  GatewayModelSpendResult,
  GatewayDailyActivityResult,
  GatewayDailyActivity,
  GatewayDailyModelMetrics,
  LiteLLMEndpointAvailability,
  GatewayKeyInfo,
  GatewayModelSpend,
  GatewayDailyMetricsResult,
} from './gateway-types.js'
import { resolveEnvVar, resolveJsonPath } from '../utils/jsonpath.js'
import {
  readModelSpendCache,
  writeModelSpendCache,
  readDailyActivityCache,
  writeDailyActivityCache,
  readDailyMetricsCache,
  writeDailyMetricsCache,
  writeDailyActivitySnapshot,
  readDailyActivitySnapshots,
} from './gateway-cache.js'

// ─── Base URL derivation ───────────────────────────────────────────────────────

/**
 * Derive the gateway base URL from the configured primary endpoint.
 * Strips any path suffix so we can append standard LiteLLM paths.
 *
 * e.g. "https://prod-ai-gateway.example.com/user/info" → "https://prod-ai-gateway.example.com"
 */
export function deriveBaseUrl(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.protocol}//${url.host}`
  } catch {
    // Fallback: strip everything after the last segment that looks like a path
    return endpoint.replace(/\/[^/]*$/, '')
  }
}

// ─── Endpoint discovery ────────────────────────────────────────────────────────

/**
 * Probe a gateway to discover which standard LiteLLM endpoints are available.
 * Uses HEAD-like GET requests and checks for non-403/404/500 responses.
 * Results are cached in memory for the process lifetime (endpoints don't change).
 */
const _discoveryCache = new Map<string, LiteLLMEndpointAvailability>()

export async function discoverLiteLLMEndpoints(
  config: GatewayConfig
): Promise<LiteLLMEndpointAvailability> {
  const baseUrl = deriveBaseUrl(config.endpoint)
  const cached = _discoveryCache.get(baseUrl)
  if (cached) return cached

  const headers = buildAuthHeaders(config.auth)

  const probe = async (path: string): Promise<boolean> => {
    try {
      const r = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(6000),
      })
      // 200 = available, 422 = exists but missing params, 400 = exists but bad request
      // 401 = exists but insufficient permissions, 403 = forbidden (admin-only)
      // 404/405 = genuinely not there
      return r.status !== 404 && r.status !== 405
    } catch {
      return false
    }
  }

  const [
    spendLogs,
    dailyActivity,
    spendTags,
    modelInfo,
    models,
    keyInfo,
    userInfo,
    globalSpendModels,
    healthReadiness,
  ] = await Promise.all([
    probe('/spend/logs?start_date=2020-01-01&end_date=2020-01-02'),
    probe('/user/daily/activity?start_date=2020-01-01&end_date=2020-01-02'),
    probe('/spend/tags'),
    probe('/model/info'),
    probe('/models'),
    probe('/key/info'),
    probe('/user/info'),
    probe('/global/spend/models'),
    probe('/health/readiness'),
  ])

  const result: LiteLLMEndpointAvailability = {
    spendLogs,
    dailyActivity,
    spendTags,
    modelInfo,
    models,
    keyInfo,
    userInfo,
    globalSpendModels,
    healthReadiness,
  }
  _discoveryCache.set(baseUrl, result)
  return result
}

// ─── /spend/logs ──────────────────────────────────────────────────────────────

/**
 * Fetch per-model actual spend from /spend/logs for the given date range.
 * Supports date-range caching: past date ranges are cached longer (data is immutable).
 */
export async function fetchModelSpend(
  config: GatewayConfig,
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<GatewayModelSpendResult | null> {
  // Check cache
  const cached = readModelSpendCache(config, startDate, endDate)
  if (cached) return cached

  const baseUrl = deriveBaseUrl(config.endpoint)
  const url = `${baseUrl}/spend/logs?start_date=${startDate}&end_date=${endDate}`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      // 401 likely means the endpoint exists but the key scope is wrong — warn quietly
      if (response.status !== 404) {
        console.warn(`[taco] Gateway /spend/logs returned ${response.status}`)
      }
      return null
    }

    // Response is an array of daily spend objects: [{ models: {...}, spend: n, startTime: "..." }, ...]
    const raw = (await response.json()) as Array<{
      models?: Record<string, number>
      spend?: number
    }>

    if (!Array.isArray(raw)) return null

    // Aggregate all days into one model spend map
    const aggregated: Record<string, number> = {}
    let totalSpend = 0
    for (const day of raw) {
      if (day.models && typeof day.models === 'object') {
        for (const [model, spend] of Object.entries(day.models)) {
          if (typeof spend === 'number') {
            aggregated[model] = (aggregated[model] ?? 0) + spend
            totalSpend += spend
          }
        }
      }
    }

    const result: GatewayModelSpendResult = {
      modelSpend: Object.entries(aggregated).map(([model, spend]) => ({ model, spend })),
      totalSpend,
      fetchedAt: Date.now(),
      cached: false,
      endpoint: url,
    }

    writeModelSpendCache(result, config, startDate, endDate)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[taco] Gateway /spend/logs fetch failed: ${msg}`)
    return null
  }
}

// ─── /user/daily/activity ──────────────────────────────────────────────────────

/**
 * Fetch per-model daily breakdown from /user/daily/activity.
 * Past days are cached permanently (data is immutable); today is cached with TTL.
 */
export async function fetchDailyActivity(
  config: GatewayConfig,
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<GatewayDailyActivityResult | null> {
  // Check cache
  const cached = readDailyActivityCache(config, startDate, endDate)
  if (cached) return cached

  const baseUrl = deriveBaseUrl(config.endpoint)
  const url = `${baseUrl}/user/daily/activity?start_date=${startDate}&end_date=${endDate}`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`[taco] Gateway /user/daily/activity returned ${response.status}`)
      }
      return null
    }

    // LiteLLM response: { results: [{ date, metrics: {...}, breakdown: { models: {...} } }] }
    const raw = (await response.json()) as {
      results?: Array<{
        date?: string
        metrics?: {
          spend?: number
          prompt_tokens?: number
          completion_tokens?: number
          cache_read_input_tokens?: number
          cache_creation_input_tokens?: number
          total_tokens?: number
          api_requests?: number
        }
        breakdown?: {
          models?: Record<
            string,
            {
              metrics?: {
                spend?: number
                prompt_tokens?: number
                completion_tokens?: number
                cache_read_input_tokens?: number
                cache_creation_input_tokens?: number
                total_tokens?: number
                api_requests?: number
              }
            }
          >
        }
      }>
    }

    if (!raw.results || !Array.isArray(raw.results)) return null

    const days: GatewayDailyActivity[] = raw.results
      .filter(r => r.date)
      .map(r => {
        const m = r.metrics ?? {}
        const modelEntries: GatewayDailyModelMetrics[] = Object.entries(
          r.breakdown?.models ?? {}
        ).map(([model, data]) => {
          const dm = data.metrics ?? {}
          return {
            model,
            spend: dm.spend ?? 0,
            promptTokens: dm.prompt_tokens ?? 0,
            completionTokens: dm.completion_tokens ?? 0,
            cacheReadTokens: dm.cache_read_input_tokens ?? 0,
            cacheCreationTokens: dm.cache_creation_input_tokens ?? 0,
            totalTokens: dm.total_tokens ?? 0,
            apiRequests: dm.api_requests ?? 0,
          }
        })

        return {
          date: r.date!,
          totalSpend: m.spend ?? 0,
          totalRequests: m.api_requests ?? 0,
          promptTokens: m.prompt_tokens ?? 0,
          completionTokens: m.completion_tokens ?? 0,
          cacheReadTokens: m.cache_read_input_tokens ?? 0,
          cacheCreationTokens: m.cache_creation_input_tokens ?? 0,
          totalTokens: m.total_tokens ?? 0,
          models: modelEntries,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    const result: GatewayDailyActivityResult = {
      days,
      fetchedAt: Date.now(),
      cached: false,
      endpoint: url,
    }

    writeDailyActivityCache(result, config, startDate, endDate)

    // Persist each day as an immutable per-day snapshot.
    // Past days are written once; today is overwritten on each fetch.
    // Run async so it doesn't block the main response.
    setImmediate(() => {
      for (const day of result.days) {
        writeDailyActivitySnapshot(day, url)
      }
    })

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[taco] Gateway /user/daily/activity fetch failed: ${msg}`)
    return null
  }
}

// ─── Daily activity snapshot helpers ──────────────────────────────────────────

/**
 * Read persisted per-day gateway spend from disk snapshots.
 * Combines snapshot data with any live-fetched days to give the fullest
 * possible date range without hitting the network.
 *
 * Returns a map of YYYY-MM-DD → daily spend in USD.
 */
export function readGatewayDailySpend(fromDate: string, toDate: string): Map<string, number> {
  const snapshots = readDailyActivitySnapshots(fromDate, toDate)
  const result = new Map<string, number>()
  for (const snap of snapshots) {
    result.set(snap.date, snap.totalSpend)
  }
  return result
}

/**
 * Read persisted per-day gateway snapshots and return full GatewayDailyActivity
 * objects reconstructed from disk. Useful for filling gaps in the live fetch.
 */
export function readGatewayDailyActivity(fromDate: string, toDate: string): GatewayDailyActivity[] {
  const snapshots = readDailyActivitySnapshots(fromDate, toDate)
  return snapshots.map(snap => ({
    date: snap.date,
    totalSpend: snap.totalSpend,
    totalRequests: snap.totalRequests ?? 0,
    promptTokens: snap.promptTokens ?? 0,
    completionTokens: snap.completionTokens ?? 0,
    cacheReadTokens: snap.cacheReadTokens ?? 0,
    cacheCreationTokens: snap.cacheCreationTokens ?? 0,
    totalTokens: snap.totalTokens ?? 0,
    models: (snap.models ?? []).map(m => ({
      model: m.model,
      spend: m.spend,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: m.totalTokens,
      apiRequests: 0,
    })),
  }))
}

// ─── /key/info ────────────────────────────────────────────────────────────────

/**
 * Fetch per-key spend and budget from /key/info.
 *
 * This is the most accurate source for the spend attributed to the configured
 * API key. More precise than /user/info when a user has multiple keys.
 * Returns null gracefully if the endpoint is unavailable.
 */
export async function fetchKeyInfo(config: GatewayConfig): Promise<GatewayKeyInfo | null> {
  const baseUrl = deriveBaseUrl(config.endpoint)
  const url = `${baseUrl}/key/info`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null

    const raw = (await response.json()) as {
      key?: string
      info?: {
        key_name?: string | null
        spend?: number
        max_budget?: number | null
        budget_reset_at?: string | null
        budget_duration?: string | null
        user_id?: string | null
        team_id?: string | null
        last_active?: string | null
      }
    }

    if (!raw.info) return null
    const info = raw.info

    return {
      keyHash: raw.key ?? '',
      keyName: info.key_name ?? null,
      spend: typeof info.spend === 'number' ? info.spend : 0,
      maxBudget: typeof info.max_budget === 'number' ? info.max_budget : null,
      budgetResetAt: info.budget_reset_at ?? null,
      budgetDuration: info.budget_duration ?? null,
      userId: info.user_id ?? null,
      teamId: info.team_id ?? null,
      lastActive: info.last_active ?? null,
    }
  } catch {
    return null
  }
}

// ─── /models ──────────────────────────────────────────────────────────────────

/**
 * Fetch the list of available model IDs from the OpenAI-compatible /models endpoint.
 * Returns a sorted array of model ID strings, or null if unavailable.
 */
export async function fetchAvailableModels(config: GatewayConfig): Promise<string[] | null> {
  const baseUrl = deriveBaseUrl(config.endpoint)
  const url = `${baseUrl}/models`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null

    const raw = (await response.json()) as { data?: Array<{ id?: string }> }
    if (!raw.data || !Array.isArray(raw.data)) return null

    return raw.data
      .map(m => m.id ?? '')
      .filter(Boolean)
      .sort()
  } catch {
    return null
  }
}

// ─── /global/spend/models ─────────────────────────────────────────────────────

/**
 * Fetch org-wide per-model spend from /global/spend/models (admin endpoint).
 * Returns null if unavailable or not authorized (non-admin keys get 401).
 */
export async function fetchGlobalSpendModels(
  config: GatewayConfig
): Promise<GatewayModelSpend[] | null> {
  const baseUrl = deriveBaseUrl(config.endpoint)
  const url = `${baseUrl}/global/spend/models`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null

    const raw = (await response.json()) as Array<{
      model?: string
      total_spend?: number
      total_tokens?: number
    }>
    if (!Array.isArray(raw)) return null

    return raw
      .filter(r => typeof r.model === 'string' && typeof r.total_spend === 'number')
      .map(r => ({ model: r.model!, spend: r.total_spend! }))
      .sort((a, b) => b.spend - a.spend)
  } catch {
    return null
  }
}

// ─── /spend/tags ──────────────────────────────────────────────────────────────

/**
 * Fetch spend broken down by request tag (user-agent, custom tags) from /spend/tags.
 * Returns null if unavailable.
 */
export interface GatewaySpendTag {
  tag: string
  logCount: number
  totalSpend: number
}

export async function fetchSpendTags(config: GatewayConfig): Promise<GatewaySpendTag[] | null> {
  const baseUrl = deriveBaseUrl(config.endpoint)
  const url = `${baseUrl}/spend/tags`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return null

    const raw = (await response.json()) as Array<{
      individual_request_tag?: string
      log_count?: number
      total_spend?: number
    }>
    if (!Array.isArray(raw)) return null

    return raw
      .filter(r => typeof r.individual_request_tag === 'string')
      .map(r => ({
        tag: r.individual_request_tag!,
        logCount: r.log_count ?? 0,
        totalSpend: r.total_spend ?? 0,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
  } catch {
    return null
  }
}

// ─── Date-range metrics endpoint ──────────────────────────────────────────────

/**
 * Fetch spend for a specific date range from a custom metrics endpoint
 * (e.g. /self-service-proxy/v1/metrics/?start_date=...&end_date=...).
 *
 * Requires `config.dailyMetricsEndpoint` to be configured.
 * Uses the same auth as the primary gateway endpoint.
 * Caches results with TTL = config.cacheTtlMinutes (default 5 min for today).
 */
export async function fetchDailyMetrics(
  config: GatewayConfig,
  startDate: string,
  endDate: string
): Promise<GatewayDailyMetricsResult | null> {
  const daily = config.dailyMetricsEndpoint
  if (!daily?.url) return null

  const ttlMinutes = config.cacheTtlMinutes ?? 5

  // Check cache
  const cached = readDailyMetricsCache(daily.url, startDate, endDate, ttlMinutes)
  if (cached) return cached

  const url = `${daily.url.replace(/\/$/, '')}?start_date=${startDate}&end_date=${endDate}`
  const headers = buildAuthHeaders(config.auth)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`[taco] Daily metrics endpoint returned ${response.status}`)
      }
      return null
    }

    const raw: unknown = await response.json()

    // Extract total spend via JSONPath
    const totalSpendRaw = resolveJsonPath(raw, daily.mappings.totalSpend)
    const totalSpend = typeof totalSpendRaw === 'number' ? totalSpendRaw : Number(totalSpendRaw)
    if (!isFinite(totalSpend)) {
      console.warn(
        `[taco] Daily metrics: could not resolve totalSpend at "${daily.mappings.totalSpend}"`
      )
      return null
    }

    // Extract model spend array (optional)
    const modelSpend: GatewayModelSpend[] = []
    if (daily.mappings.modelSpend) {
      const rawArr = resolveJsonPath(raw, daily.mappings.modelSpend)
      if (Array.isArray(rawArr)) {
        const modelField = daily.mappings.modelSpendFields?.model ?? 'model'
        const spendField = daily.mappings.modelSpendFields?.spend ?? 'spend'
        for (const item of rawArr) {
          if (item && typeof item === 'object') {
            const model = (item as Record<string, unknown>)[modelField]
            const spend = (item as Record<string, unknown>)[spendField]
            if (typeof model === 'string' && typeof spend === 'number') {
              modelSpend.push({ model, spend })
            }
          }
        }
      }
    }

    const result: GatewayDailyMetricsResult = {
      totalSpend,
      modelSpend,
      fetchedAt: Date.now(),
      cached: false,
      endpoint: url,
    }

    writeDailyMetricsCache(result, daily.url, startDate, endDate, ttlMinutes)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[taco] Daily metrics fetch failed: ${msg}`)
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build HTTP auth headers from the gateway auth config.
 * Supports bearer, basic, and custom header auth.
 */
export function buildAuthHeaders(auth: GatewayAuth): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }

  switch (auth.type) {
    case 'bearer': {
      if (!auth.tokenOrEnv) break
      try {
        headers['Authorization'] = `Bearer ${resolveEnvVar(auth.tokenOrEnv)}`
      } catch {
        /* env var not set — skip */
      }
      break
    }
    case 'basic': {
      if (!auth.usernameOrEnv || !auth.passwordOrEnv) break
      try {
        const user = resolveEnvVar(auth.usernameOrEnv)
        const pass = resolveEnvVar(auth.passwordOrEnv)
        headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
      } catch {
        /* env var not set — skip */
      }
      break
    }
    case 'header': {
      if (!auth.headerName || !auth.headerValueOrEnv) break
      try {
        headers[auth.headerName] = resolveEnvVar(auth.headerValueOrEnv)
      } catch {
        /* env var not set — skip */
      }
      break
    }
  }

  return headers
}

/**
 * Compute the current billing period start/end dates (1st of month → today).
 * Used as default date range when no filters are specified.
 */
export function getCurrentBillingPeriod(): { startDate: string; endDate: string } {
  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA') // YYYY-MM-DD
  const endDate = now.toLocaleDateString('en-CA')
  return { startDate, endDate }
}
