/**
 * Minimal JSONPath resolver — no dependencies.
 *
 * Supports:
 *   - Dot notation:    $.user_info.spend
 *   - Array indices:   $.keys[0].max_budget
 *   - Chained mixed:   $.teams[0].keys[1].spend
 *
 * Does NOT support wildcards (*), filters ([?()]), recursive descent (..),
 * or slices ([0:3]). These are not needed for gateway metric mappings.
 */

/**
 * Resolve a simple JSONPath expression against a parsed JSON object.
 *
 * @param obj   The parsed JSON value to traverse.
 * @param path  A JSONPath string starting with "$." (e.g. "$.a.b[0].c").
 * @returns     The resolved value, or `undefined` if not found.
 */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (typeof path !== 'string' || !path.startsWith('$.')) return undefined

  // Split "a.b[0].c" into ["a", "b", "0", "c"]
  const segments = path
    .slice(2) // strip "$."
    .split(/\.|\[(\d+)\]/) // split on "." or "[n]"
    .filter(Boolean)

  let current: unknown = obj
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined
    const key = /^\d+$/.test(seg) ? Number(seg) : seg
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/**
 * Resolve an env-var reference of the form "${ENV_VAR_NAME}".
 * Returns the raw string unchanged if it does not match the pattern.
 *
 * @throws {Error} if the env var is referenced but not set.
 */
export function resolveEnvVar(value: string): string {
  const match = value.match(/^\$\{(.+)\}$/)
  if (!match) return value

  const name = match[1]
  const envVal = process.env[name]
  if (envVal === undefined || envVal === '') {
    throw new Error(
      `[taco] Gateway: environment variable "${name}" is not set. ` +
        `Set it before running taco, e.g.: export ${name}=<your-key>`
    )
  }
  return envVal
}

/**
 * Resolve all "${ENV_VAR}" patterns in a Record's string values.
 * Non-string values are passed through unchanged.
 */
export function resolveEnvVarsInRecord(record: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    resolved[k] = typeof v === 'string' ? resolveEnvVar(v) : v
  }
  return resolved
}
