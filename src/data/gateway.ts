/**
 * Gateway metrics fetcher.
 *
 * Fetches spend/budget data from any configured API gateway, applies the
 * user-defined JSONPath mappings, and returns a normalised GatewayMetrics
 * object. All secrets are resolved from environment variables at runtime.
 *
 * Uses Node's built-in fetch() — no additional dependencies.
 */

import type { GatewayConfig, GatewayAuth } from '../config/index.js'
import type { GatewayMetrics } from './gateway-types.js'
import { resolveJsonPath, resolveEnvVar } from '../utils/jsonpath.js'
import { readGatewayCache, writeGatewayCache } from './gateway-cache.js'

// ─── Public API ──────────────────────────────────────────────────────────────────

/**
 * Fetch gateway metrics, using the local cache when fresh.
 *
 * Returns null (and logs a warning) on any error so callers can fall back to
 * local-only data gracefully.
 */
export async function fetchGatewayMetrics(config: GatewayConfig): Promise<GatewayMetrics | null> {
  // 1. Try cache first
  const cached = readGatewayCache(config)
  if (cached !== null) return cached

  // 2. Fetch from the gateway
  try {
    return await doFetch(config)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[taco] Gateway fetch failed: ${msg}`)
    return null
  }
}

// ─── Internal fetch + parse ───────────────────────────────────────────────────────

async function doFetch(config: GatewayConfig): Promise<GatewayMetrics> {
  const url = buildUrl(config)
  const headers = buildHeaders(config.auth)

  const method = config.method ?? 'GET'
  const requestInit: RequestInit = { method, headers }

  if (method === 'POST' && config.body) {
    requestInit.body = JSON.stringify(config.body)
    ;(headers as Record<string, string>)['Content-Type'] = 'application/json'
  }

  const response = await fetch(url, requestInit)

  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status} ${response.statusText} for ${url}`)
  }

  const json: unknown = await response.json()
  const metrics = parseMetrics(json, config)

  // Write to cache (live + daily snapshot)
  writeGatewayCache(metrics, config)

  return metrics
}

// ─── URL construction ──────────────────────────────────────────────────────────────

function buildUrl(config: GatewayConfig): string {
  let url = config.endpoint

  if (config.queryParams && Object.keys(config.queryParams).length > 0) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(config.queryParams)) {
      params.set(k, resolveEnvVar(v))
    }
    url += (url.includes('?') ? '&' : '?') + params.toString()
  }

  return url
}

// ─── Auth header construction ──────────────────────────────────────────────────────

function buildHeaders(auth: GatewayAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  switch (auth.type) {
    case 'bearer': {
      if (!auth.tokenOrEnv) throw new Error('Gateway auth.tokenOrEnv is required for bearer auth')
      headers['Authorization'] = `Bearer ${resolveEnvVar(auth.tokenOrEnv)}`
      break
    }
    case 'basic': {
      if (!auth.usernameOrEnv || !auth.passwordOrEnv) {
        throw new Error(
          'Gateway auth.usernameOrEnv and auth.passwordOrEnv are required for basic auth'
        )
      }
      const user = resolveEnvVar(auth.usernameOrEnv)
      const pass = resolveEnvVar(auth.passwordOrEnv)
      headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
      break
    }
    case 'header': {
      if (!auth.headerName || !auth.headerValueOrEnv) {
        throw new Error(
          'Gateway auth.headerName and auth.headerValueOrEnv are required for header auth'
        )
      }
      headers[auth.headerName] = resolveEnvVar(auth.headerValueOrEnv)
      break
    }
  }

  return headers
}

// ─── Response parsing ──────────────────────────────────────────────────────────────

function parseMetrics(json: unknown, config: GatewayConfig): GatewayMetrics {
  const { mappings } = config

  const totalSpend = toNumber(resolveJsonPath(json, mappings.totalSpend))
  if (totalSpend === null) {
    throw new Error(
      `Gateway: could not resolve totalSpend at path "${mappings.totalSpend}". ` +
        'Check your gateway.mappings.totalSpend configuration.'
    )
  }

  return {
    totalSpend,
    budgetLimit: toNumber(
      mappings.budgetLimit ? resolveJsonPath(json, mappings.budgetLimit) : undefined
    ),
    budgetResetAt: toString(
      mappings.budgetResetAt ? resolveJsonPath(json, mappings.budgetResetAt) : undefined
    ),
    budgetDuration: toString(
      mappings.budgetDuration ? resolveJsonPath(json, mappings.budgetDuration) : undefined
    ),
    teamSpend: toNumber(mappings.teamSpend ? resolveJsonPath(json, mappings.teamSpend) : undefined),
    teamBudgetLimit: toNumber(
      mappings.teamBudgetLimit ? resolveJsonPath(json, mappings.teamBudgetLimit) : undefined
    ),
    teamName: toString(mappings.teamName ? resolveJsonPath(json, mappings.teamName) : undefined),
    fetchedAt: Date.now(),
    cached: false,
    endpoint: config.endpoint,
  }
}

// ─── Coercion helpers ─────────────────────────────────────────────────────────────

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return isFinite(n) ? n : null
}

function toString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}
