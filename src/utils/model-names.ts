/**
 * Model name normalization utilities.
 *
 * Gateway providers return model names in many formats:
 *   vertex_ai/claude-opus-4-6
 *   bedrock/global.anthropic.claude-opus-4-6-v1
 *   azure_ai/Claude-Opus-4.6
 *   claude-opus-4-6-*
 *
 * OpenCode stores names like:
 *   claude-opus-4-6
 *   claude-sonnet-4.6   (dot format in older versions)
 *
 * This module normalizes all variants to a canonical lowercase-dash form
 * so gateway spend can be matched and aggregated against local model stats.
 */

// ─── Provider prefix stripping ────────────────────────────────────────────────

const PROVIDER_PREFIXES = [
  'bedrock/global.anthropic.',
  'bedrock/eu.anthropic.',
  'bedrock/us.anthropic.',
  'bedrock/',
  'azure_ai/',
  'vertex_ai/',
  'global.anthropic.',
  'eu.anthropic.',
  'us.anthropic.',
  'anthropic.',
]

// ─── Version/suffix patterns ──────────────────────────────────────────────────

// Matches: -v1:0, -v1, @20250929, -20260115, -20251001-v1:0, etc.
const VERSION_SUFFIX = /([-@](?:v\d+(?::\d+)?|\d{8}(?:-v\d+(?::\d+)?)?))+$/

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a gateway or local model name to a canonical form.
 *
 * Examples:
 *   "vertex_ai/claude-opus-4-6"            → "claude-opus-4-6"
 *   "bedrock/global.anthropic.claude-opus-4-6-v1" → "claude-opus-4-6"
 *   "azure_ai/Claude-Opus-4.6"             → "claude-opus-4-6"
 *   "claude-opus-4-6*"                     → "claude-opus-4-6"
 *   "claude-sonnet-4.6"                    → "claude-sonnet-4-6"
 */
export function normalizeModelName(name: string): string {
  let n = name.toLowerCase()

  // Strip provider prefix (longest match first)
  for (const prefix of PROVIDER_PREFIXES) {
    if (n.startsWith(prefix)) {
      n = n.slice(prefix.length)
      break
    }
  }

  // Strip version/date suffixes
  n = n.replace(VERSION_SUFFIX, '')

  // Replace dots with dashes (e.g. claude-sonnet-4.6 → claude-sonnet-4-6)
  // Only replace dots surrounded by digits to avoid stripping legitimate dots
  n = n.replace(/(\d)\.(\d)/g, '$1-$2')

  // Strip trailing wildcard suffixes: *, -*, *-
  n = n.replace(/[-*]+$/, '')

  return n.trim()
}

/**
 * Aggregate a gateway model spend map (model → USD) by normalized model name.
 *
 * Multiple provider variants of the same model are summed together:
 *   vertex_ai/claude-opus-4-6   → $29.16
 *   bedrock/.../claude-opus-4-6-v1 → $6.09
 *   azure_ai/Claude-Opus-4.6    → $0.77
 *   ──────────────────────────────────────
 *   claude-opus-4-6 (aggregated) → $36.02
 *
 * @param models  Raw model→spend map from the gateway
 * @returns       Map of normalizedModelName → total spend
 */
export function aggregateModelSpend(models: Record<string, number>): Map<string, number> {
  const result = new Map<string, number>()
  for (const [model, spend] of Object.entries(models)) {
    const normalized = normalizeModelName(model)
    result.set(normalized, (result.get(normalized) ?? 0) + spend)
  }
  return result
}

/**
 * Find the best matching normalized name from a Set of known local model names,
 * given a gateway-reported model name. Returns null if no reasonable match found.
 *
 * Matching strategy:
 *   1. Exact normalized match
 *   2. Local name starts with normalized gateway name (prefix match)
 *   3. Normalized gateway name starts with local name
 */
export function matchModelName(gatewayName: string, localNames: Set<string>): string | null {
  const normalized = normalizeModelName(gatewayName)

  // 1. Exact match
  if (localNames.has(normalized)) return normalized

  // 2. Prefix matches
  for (const local of localNames) {
    const normalizedLocal = normalizeModelName(local)
    if (normalizedLocal === normalized) return local
    if (normalizedLocal.startsWith(normalized) || normalized.startsWith(normalizedLocal)) {
      return local
    }
  }

  return null
}
