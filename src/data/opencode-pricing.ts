/**
 * OpenCode pricing loader.
 *
 * Reads the `provider.*.models` sections from `~/.config/opencode/opencode.json`
 * and builds a lookup map of normalizedModelName → per-token rates.
 *
 * This lets TACO estimate costs locally when OpenCode writes `cost: 0` to the
 * database (e.g. for dot-format model IDs like `claude-sonnet-4.6`, or for
 * any model whose pricing OpenCode doesn't recognise).
 *
 * Design:
 *   - Read-only: TACO never writes to opencode.json
 *   - Silent on failure: missing file or parse errors return null
 *   - Normalise on load: all provider variants map to the same canonical name
 *   - In-memory cache: file is read once per CLI invocation (5-minute TTL)
 *   - Cross-platform paths: uses homedir() + path.join()
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { normalizeModelName } from '../utils/model-names.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-token pricing rates (USD per token, not per 1M). */
export interface ModelPricing {
  /** Cost per input token in USD. */
  input: number
  /** Cost per output token in USD. */
  output: number
  /** Cost per cache-read token in USD (optional). */
  cacheRead?: number
  /** Cost per cache-write token in USD (optional). */
  cacheWrite?: number
}

// ─── opencode.json shape (partial) ───────────────────────────────────────────

interface OpenCodeModelCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  context_over_200k?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
  }
}

interface OpenCodeModelDef {
  name?: string
  cost?: OpenCodeModelCost
  limit?: Record<string, unknown>
}

interface OpenCodeProviderDef {
  models?: Record<string, OpenCodeModelDef>
  [key: string]: unknown
}

interface OpenCodeConfig {
  provider?: Record<string, OpenCodeProviderDef>
  [key: string]: unknown
}

// ─── Cache ────────────────────────────────────────────────────────────────────

// Default path — can be overridden in tests via _setConfigPathForTesting()
let _configPath: string = join(homedir(), '.config', 'opencode', 'opencode.json')

// 5-minute TTL so a config change is picked up quickly without re-reading
// on every DB query within the same invocation.
const CACHE_TTL_MS = 5 * 60 * 1000

let _cache: Map<string, ModelPricing> | null = null
let _cacheLoadedAt = 0

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load pricing from opencode.json and return a map of
 * normalizedModelName → ModelPricing.
 *
 * Returns null when the file is missing, unreadable, or has no model pricing.
 * Never throws.
 */
export function loadOpenCodePricing(): Map<string, ModelPricing> | null {
  const now = Date.now()
  if (_cache !== null && now - _cacheLoadedAt < CACHE_TTL_MS) {
    return _cache.size > 0 ? _cache : null
  }

  _cache = buildPricingMap()
  _cacheLoadedAt = now
  return _cache.size > 0 ? _cache : null
}

/** Reset the in-memory cache (useful in tests). */
export function resetPricingCache(): void {
  _cache = null
  _cacheLoadedAt = 0
}

/**
 * Override the path to opencode.json — for use in tests only.
 * Call resetPricingCache() after this to force a fresh load.
 */
export function _setConfigPathForTesting(path: string): void {
  _configPath = path
  resetPricingCache()
}

// ─── Implementation ───────────────────────────────────────────────────────────

function buildPricingMap(): Map<string, ModelPricing> {
  const result = new Map<string, ModelPricing>()

  if (!existsSync(_configPath)) return result

  let config: OpenCodeConfig
  try {
    const raw = readFileSync(_configPath, 'utf-8')
    config = JSON.parse(raw) as OpenCodeConfig
  } catch {
    // Malformed JSON or unreadable file — fail silently
    return result
  }

  if (!config.provider || typeof config.provider !== 'object') return result

  for (const providerDef of Object.values(config.provider)) {
    if (!providerDef?.models || typeof providerDef.models !== 'object') continue

    for (const [rawName, modelDef] of Object.entries(providerDef.models)) {
      const cost = modelDef?.cost
      if (!cost || typeof cost !== 'object') continue

      const input = cost.input
      const output = cost.output
      if (typeof input !== 'number' || typeof output !== 'number') continue

      const pricing: ModelPricing = { input, output }
      if (typeof cost.cache_read === 'number') pricing.cacheRead = cost.cache_read
      if (typeof cost.cache_write === 'number') pricing.cacheWrite = cost.cache_write

      // Normalise the model name and register it.
      // If two provider variants normalise to the same name (e.g.
      // vertex_ai/claude-opus-4-6 and anthropic.claude-opus-4-6), we keep
      // the first entry — they should have identical rates.
      const normalized = normalizeModelName(rawName)
      if (!result.has(normalized)) {
        result.set(normalized, pricing)
      }
    }
  }

  return result
}

// ─── Cost estimation helper ───────────────────────────────────────────────────

/**
 * Estimate cost in USD from token counts and per-token rates.
 *
 * @param tokens  Token usage breakdown
 * @param rates   Per-token pricing from opencode.json
 * @returns       Estimated cost in USD
 */
export function estimateCostFromPricing(
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  },
  rates: ModelPricing
): number {
  return (
    tokens.input * rates.input +
    tokens.output * rates.output +
    tokens.cacheRead * (rates.cacheRead ?? 0) +
    tokens.cacheWrite * (rates.cacheWrite ?? 0)
  )
}
