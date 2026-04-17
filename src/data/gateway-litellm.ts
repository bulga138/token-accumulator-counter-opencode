/**
 * LiteLLM-compliant gateway auto-discovery and data fetching.
 *
 * When a gateway is configured, TACO derives the base URL from the primary
 * endpoint and probes standard LiteLLM API paths:
 *
 *   /spend/logs             → per-model actual spend by date range
 *   /user/daily/activity    → per-model daily breakdown with tokens
 *   /model/info             → per-model pricing rates
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
} from './gateway-types.js'
import { resolveEnvVar } from '../utils/jsonpath.js'
import {
  readModelSpendCache,
  writeModelSpendCache,
  readDailyActivityCache,
  writeDailyActivityCache,
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
        signal: AbortSignal.timeout(5000),
      })
      // 200, 422 (missing params), or 401 (auth issue) all mean the endpoint exists
      return r.status !== 404 && r.status !== 405
    } catch {
      return false
    }
  }

  const [spendLogs, dailyActivity, modelInfo] = await Promise.all([
    probe('/spend/logs?start_date=2020-01-01&end_date=2020-01-02'),
    probe('/user/daily/activity?start_date=2020-01-01&end_date=2020-01-02'),
    probe('/model/info'),
  ])

  const result: LiteLLMEndpointAvailability = { spendLogs, dailyActivity, modelInfo }
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
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[taco] Gateway /user/daily/activity fetch failed: ${msg}`)
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
