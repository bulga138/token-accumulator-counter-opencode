/**
 * Format a number of tokens with k/M suffix and 1 decimal place.
 * e.g. 1_234_567 → "1.2M", 98_000 → "98.0k", 500 → "500"
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/**
 * Format a USD cost.
 * e.g. 14.37 → "$14.37", 0.004 → "$0.0040"
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/**
 * Format an estimated cost with a tilde prefix to indicate approximation.
 * e.g. 14.37 → "~$14.37"
 */
export function formatEstimatedCost(usd: number): string {
  return `~${formatCost(usd)}`
}

/**
 * Format a percentage: 0.712 → "71.2%"
 */
export function formatPercent(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`
}

/**
 * Format a large integer with comma separators.
 * e.g. 1234567 → "1,234,567"
 */
export function formatInt(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Format tokens/sec.
 * e.g. 42.5 → "42.5 tok/s"
 */
export function formatTps(tps: number): string {
  return `${tps.toFixed(1)} tok/s`
}

/**
 * Pad a string to a given length (right-padding with spaces).
 * Does NOT truncate — use truncate() before calling if you need to clamp.
 */
export function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length)
}

/**
 * Pad a string to a given length (left-padding with spaces).
 * Does NOT truncate — use truncate() before calling if you need to clamp.
 */
export function padStart(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str
}

/**
 * Truncate a string to maxLen, appending "…" if needed.
 * If fromStart is true, truncates from the beginning (preserving the end).
 */
export function truncate(str: string, maxLen: number, fromStart = false): string {
  if (str.length <= maxLen) return str
  if (fromStart) {
    return '…' + str.slice(-(maxLen - 1))
  }
  return str.slice(0, maxLen - 1) + '…'
}

/**
 * Format a delta percentage with ▲/▼ arrows and color hint (returned as plain string).
 * e.g. 0.123 → "+12.3%", -0.08 → "-8.0%"
 */
export function formatDelta(frac: number | null): string {
  if (frac === null) return '—'
  const sign = frac >= 0 ? '+' : ''
  return `${sign}${(frac * 100).toFixed(1)}%`
}
