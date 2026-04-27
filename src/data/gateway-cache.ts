/**
 * File-based cache for gateway metrics.
 *
 * Two layers:
 *
 * 1. Live cache (~/.cache/taco/gateway-metrics.json)
 *    Stores the most recent fetch result with a configurable TTL (default 15 min).
 *    Invalidated when the endpoint URL changes.
 *
 * 2. Daily snapshots (~/.cache/taco/gateway-daily/YYYY-MM-DD.json)
 *    Written after each successful fetch, one file per calendar day.
 *    Never expire — past days' gateway costs are immutable.
 *    Enables historical cost comparison and charting.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  statSync,
  readdirSync,
  chmodSync,
} from 'node:fs'
import type {
  GatewayMetrics,
  GatewayDailySnapshot,
  GatewayModelSpendResult,
  GatewayDailyActivityResult,
  GatewayDailyMetricsResult,
  GatewayDailyActivity,
} from './gateway-types.js'
import type { GatewayConfig } from '../config/index.js'

// Cache retention: 90 days for daily snapshots
const CACHE_RETENTION_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

// ─── Paths ──────────────────────────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), '.cache', 'taco')
const LIVE_CACHE_FILE = join(CACHE_DIR, 'gateway-metrics.json')
const DAILY_DIR = join(CACHE_DIR, 'gateway-daily')
const MODEL_SPEND_CACHE_FILE = join(CACHE_DIR, 'gateway-model-spend.json')
const DAILY_ACTIVITY_CACHE_FILE = join(CACHE_DIR, 'gateway-daily-activity.json')
const DAILY_METRICS_CACHE_FILE = join(CACHE_DIR, 'gateway-daily-metrics.json')

// ─── Internal types ─────────────────────────────────────────────────────────────

interface LiveCacheEntry {
  fetchedAt: number
  ttlMinutes: number
  endpoint: string
  data: GatewayMetrics
}

// ─── Live cache ─────────────────────────────────────────────────────────────────

/**
 * Returns cached gateway metrics if they are still fresh and from the same
 * endpoint. Returns null if the cache is missing, expired, or stale.
 */
export function readGatewayCache(config: GatewayConfig): GatewayMetrics | null {
  if (!existsSync(LIVE_CACHE_FILE)) return null

  let entry: LiveCacheEntry
  try {
    entry = JSON.parse(readFileSync(LIVE_CACHE_FILE, 'utf-8')) as LiveCacheEntry
  } catch {
    return null
  }

  // Invalidate if the endpoint changed
  if (entry.endpoint !== config.endpoint) return null

  const ttlMs = (entry.ttlMinutes ?? 15) * 60 * 1000
  const age = Date.now() - entry.fetchedAt
  if (age > ttlMs) return null

  return { ...entry.data, cached: true }
}

/**
 * Writes gateway metrics to the live cache file.
 * Also triggers a daily snapshot write.
 */
export function writeGatewayCache(data: GatewayMetrics, config: GatewayConfig): void {
  ensureDir(CACHE_DIR)

  const entry: LiveCacheEntry = {
    fetchedAt: data.fetchedAt,
    ttlMinutes: config.cacheTtlMinutes ?? 15,
    endpoint: config.endpoint,
    data,
  }

  try {
    writeFileSync(LIVE_CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8')
    // Set file permissions to 0600 (owner read/write only)
    try {
      chmodSync(LIVE_CACHE_FILE, 0o600)
    } catch {
      // Non-fatal: chmod may fail on Windows
    }
  } catch {
    // Non-fatal — cache write failure should not break the main flow
  }

  // Write a daily snapshot for historical records
  writeDailySnapshot(data, config.endpoint)
}

/**
 * Deletes the live cache file. Daily snapshots are preserved.
 */
export function clearGatewayCache(): void {
  if (existsSync(LIVE_CACHE_FILE)) {
    try {
      unlinkSync(LIVE_CACHE_FILE)
    } catch {
      // ignore
    }
  }
}

/**
 * Deletes both the live cache file and all daily snapshot files.
 */
export function clearAllGatewayData(): void {
  clearGatewayCache()

  if (existsSync(DAILY_DIR)) {
    try {
      const files = readdirSync(DAILY_DIR)
      for (const f of files) {
        if (f.endsWith('.json')) {
          unlinkSync(join(DAILY_DIR, f))
        }
      }
    } catch {
      // ignore
    }
  }
}

// ─── Cache rotation ─────────────────────────────────────────────────────────────

/**
 * Removes daily snapshot files older than CACHE_RETENTION_DAYS (90 days).
 * Called periodically to prevent unbounded cache growth.
 */
function rotateDailyCache(): void {
  if (!existsSync(DAILY_DIR)) return

  const cutoffTime = Date.now() - CACHE_RETENTION_DAYS * MS_PER_DAY

  try {
    const files = readdirSync(DAILY_DIR)
    let deletedCount = 0

    for (const f of files) {
      if (!f.endsWith('.json')) continue

      const filePath = join(DAILY_DIR, f)
      try {
        const stats = statSync(filePath)
        if (stats.mtimeMs < cutoffTime) {
          unlinkSync(filePath)
          deletedCount++
        }
      } catch {
        // Skip files we can't stat/unlink
      }
    }

    if (deletedCount > 0) {
      console.log(`Rotated ${deletedCount} old cache files (> ${CACHE_RETENTION_DAYS} days)`)
    }
  } catch {
    // Non-fatal: rotation failure shouldn't break main flow
  }
}

// ─── Daily snapshots ────────────────────────────────────────────────────────────

/**
 * Writes (or overwrites) the snapshot for today (local time).
 * Overwrites are fine — we always want the last value of the day.
 * Also triggers cache rotation to clean up old files.
 */
function writeDailySnapshot(data: GatewayMetrics, endpoint: string): void {
  ensureDir(DAILY_DIR)

  const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
  const snapshot: GatewayDailySnapshot = {
    date,
    version: 1,
    fetchedAt: data.fetchedAt,
    totalSpend: data.totalSpend,
    teamSpend: data.teamSpend,
    endpoint,
  }

  try {
    writeFileSync(join(DAILY_DIR, `${date}.json`), JSON.stringify(snapshot, null, 2), 'utf-8')
    // Set file permissions to 0600 (owner read/write only)
    try {
      chmodSync(join(DAILY_DIR, `${date}.json`), 0o600)
    } catch {
      // Non-fatal: chmod may fail on Windows
    }
  } catch {
    // Non-fatal
  }

  // Rotate old cache files (run asynchronously, don't block)
  setImmediate(() => rotateDailyCache())
}

/**
 * Returns daily snapshots within the given date range (inclusive).
 * Dates outside the stored range are simply absent from the result.
 */
export function readDailySnapshots(
  fromDate: string, // YYYY-MM-DD
  toDate: string // YYYY-MM-DD
): GatewayDailySnapshot[] {
  if (!existsSync(DAILY_DIR)) return []

  let files: string[]
  try {
    files = readdirSync(DAILY_DIR)
  } catch {
    return []
  }

  const snapshots: GatewayDailySnapshot[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const date = f.replace('.json', '')
    if (date < fromDate || date > toDate) continue

    try {
      const raw = readFileSync(join(DAILY_DIR, f), 'utf-8')
      snapshots.push(JSON.parse(raw) as GatewayDailySnapshot)
    } catch {
      // skip corrupt file
    }
  }

  return snapshots.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Daily activity snapshots (/user/daily/activity) ───────────────────────────

/**
 * Write a version-2 daily snapshot from a /user/daily/activity day record.
 *
 * Past days are written once and never overwritten (immutable gateway data).
 * Today's file is always overwritten — spend accumulates through the day.
 */
export function writeDailyActivitySnapshot(day: GatewayDailyActivity, endpoint: string): void {
  ensureDir(DAILY_DIR)

  const today = new Date().toLocaleDateString('en-CA')
  const isPastDay = day.date < today

  const filePath = join(DAILY_DIR, `${day.date}.json`)

  // Skip writing if the file already exists for a past day — it's immutable
  if (isPastDay && existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, 'utf-8')) as GatewayDailySnapshot
      // Only skip if it's already a v2 snapshot (v1 had wrong cumulative data)
      if (existing.version === 2) return
    } catch {
      // File is corrupt — fall through and overwrite
    }
  }

  const snapshot: GatewayDailySnapshot = {
    date: day.date,
    version: 2,
    fetchedAt: Date.now(),
    totalSpend: day.totalSpend,
    totalTokens: day.totalTokens,
    promptTokens: day.promptTokens,
    completionTokens: day.completionTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    totalRequests: day.totalRequests,
    models: day.models.map(m => ({
      model: m.model,
      spend: m.spend,
      totalTokens: m.totalTokens,
    })),
    endpoint,
  }

  try {
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
    try {
      chmodSync(filePath, 0o600)
    } catch {
      /* non-fatal on Windows */
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Read version-2 daily activity snapshots for the given date range.
 * Skips version-1 snapshots (they contain wrong cumulative data).
 * Returns only days that have actual per-day spend data.
 */
export function readDailyActivitySnapshots(
  fromDate: string, // YYYY-MM-DD
  toDate: string // YYYY-MM-DD
): GatewayDailySnapshot[] {
  if (!existsSync(DAILY_DIR)) return []

  let files: string[]
  try {
    files = readdirSync(DAILY_DIR)
  } catch {
    return []
  }

  const snapshots: GatewayDailySnapshot[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const date = f.replace('.json', '')
    if (date < fromDate || date > toDate) continue

    try {
      const raw = readFileSync(join(DAILY_DIR, f), 'utf-8')
      const snap = JSON.parse(raw) as GatewayDailySnapshot
      // Only include v2 snapshots — v1 had cumulative billing totals (not daily spend)
      if (snap.version === 2) snapshots.push(snap)
    } catch {
      // skip corrupt file
    }
  }

  return snapshots.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Daily metrics cache (/self-service-proxy/v1/metrics/ or similar) ─────────

interface DailyMetricsCacheEntry {
  fetchedAt: number
  ttlMinutes: number
  endpointUrl: string
  startDate: string
  endDate: string
  data: GatewayDailyMetricsResult
}

/**
 * Returns cached daily metrics for the given date range, or null if stale/missing.
 * Today's range uses config TTL; past ranges are cached for 24h (immutable).
 */
export function readDailyMetricsCache(
  endpointUrl: string,
  startDate: string,
  endDate: string,
  ttlMinutes: number
): GatewayDailyMetricsResult | null {
  if (!existsSync(DAILY_METRICS_CACHE_FILE)) return null
  try {
    const entry = JSON.parse(
      readFileSync(DAILY_METRICS_CACHE_FILE, 'utf-8')
    ) as DailyMetricsCacheEntry
    if (entry.endpointUrl !== endpointUrl) return null
    if (entry.startDate !== startDate || entry.endDate !== endDate) return null

    const today = new Date().toLocaleDateString('en-CA')
    const isPastRange = endDate < today
    const ttlMs = isPastRange ? 24 * 60 * 60 * 1000 : ttlMinutes * 60 * 1000
    if (Date.now() - entry.fetchedAt > ttlMs) return null

    return { ...entry.data, cached: true }
  } catch {
    return null
  }
}

/** Write daily metrics to cache. */
export function writeDailyMetricsCache(
  data: GatewayDailyMetricsResult,
  endpointUrl: string,
  startDate: string,
  endDate: string,
  ttlMinutes: number
): void {
  ensureDir(CACHE_DIR)
  try {
    const entry: DailyMetricsCacheEntry = {
      fetchedAt: data.fetchedAt,
      ttlMinutes,
      endpointUrl,
      startDate,
      endDate,
      data,
    }
    writeFileSync(DAILY_METRICS_CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8')
    try {
      chmodSync(DAILY_METRICS_CACHE_FILE, 0o600)
    } catch {
      /* non-fatal */
    }
  } catch {
    /* non-fatal */
  }
}

// ─── Model spend cache (/spend/logs) ─────────────────────────────────────────

interface ModelSpendCacheEntry {
  fetchedAt: number
  ttlMinutes: number
  baseUrl: string
  startDate: string
  endDate: string
  data: GatewayModelSpendResult
}

/**
 * Returns cached model spend data for the given date range, or null if stale/missing.
 * Past date ranges (where endDate < today) are cached for 24h (immutable data).
 * Current date range is cached for the gateway's configured TTL.
 */
export function readModelSpendCache(
  config: GatewayConfig,
  startDate: string,
  endDate: string
): GatewayModelSpendResult | null {
  if (!existsSync(MODEL_SPEND_CACHE_FILE)) return null
  try {
    const entry = JSON.parse(readFileSync(MODEL_SPEND_CACHE_FILE, 'utf-8')) as ModelSpendCacheEntry
    if (entry.startDate !== startDate || entry.endDate !== endDate) return null
    if (!config.endpoint.includes(entry.baseUrl) && !entry.baseUrl.includes(config.endpoint))
      return null

    const today = new Date().toLocaleDateString('en-CA')
    const isPastRange = endDate < today
    // Past ranges: cache for 24h. Current range: use config TTL (default 60 min)
    const ttlMs = isPastRange ? 24 * 60 * 60 * 1000 : (config.cacheTtlMinutes ?? 60) * 60 * 1000
    if (Date.now() - entry.fetchedAt > ttlMs) return null

    return { ...entry.data, cached: true }
  } catch {
    return null
  }
}

/** Write model spend data to the cache. */
export function writeModelSpendCache(
  data: GatewayModelSpendResult,
  config: GatewayConfig,
  startDate: string,
  endDate: string
): void {
  ensureDir(CACHE_DIR)
  try {
    const entry: ModelSpendCacheEntry = {
      fetchedAt: data.fetchedAt,
      ttlMinutes: config.cacheTtlMinutes ?? 60,
      baseUrl: new URL(config.endpoint).host,
      startDate,
      endDate,
      data,
    }
    writeFileSync(MODEL_SPEND_CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8')
    // Set file permissions to 0600 (owner read/write only)
    try {
      chmodSync(MODEL_SPEND_CACHE_FILE, 0o600)
    } catch {
      // Non-fatal: chmod may fail on Windows
    }
  } catch {
    /* non-fatal */
  }
}

// ─── Daily activity cache (/user/daily/activity) ──────────────────────────────

interface DailyActivityCacheEntry {
  fetchedAt: number
  ttlMinutes: number
  baseUrl: string
  startDate: string
  endDate: string
  data: GatewayDailyActivityResult
}

/**
 * Returns cached daily activity data for the given date range, or null if stale/missing.
 * Same TTL logic as model spend: past ranges cached 24h, current range uses config TTL.
 */
export function readDailyActivityCache(
  config: GatewayConfig,
  startDate: string,
  endDate: string
): GatewayDailyActivityResult | null {
  if (!existsSync(DAILY_ACTIVITY_CACHE_FILE)) return null
  try {
    const entry = JSON.parse(
      readFileSync(DAILY_ACTIVITY_CACHE_FILE, 'utf-8')
    ) as DailyActivityCacheEntry
    if (entry.startDate !== startDate || entry.endDate !== endDate) return null
    if (!config.endpoint.includes(entry.baseUrl) && !entry.baseUrl.includes(config.endpoint))
      return null

    const today = new Date().toLocaleDateString('en-CA')
    const isPastRange = endDate < today
    const ttlMs = isPastRange ? 24 * 60 * 60 * 1000 : (config.cacheTtlMinutes ?? 60) * 60 * 1000
    if (Date.now() - entry.fetchedAt > ttlMs) return null

    return { ...entry.data, cached: true }
  } catch {
    return null
  }
}

/** Write daily activity data to the cache. */
export function writeDailyActivityCache(
  data: GatewayDailyActivityResult,
  config: GatewayConfig,
  startDate: string,
  endDate: string
): void {
  ensureDir(CACHE_DIR)
  try {
    const entry: DailyActivityCacheEntry = {
      fetchedAt: data.fetchedAt,
      ttlMinutes: config.cacheTtlMinutes ?? 60,
      baseUrl: new URL(config.endpoint).host,
      startDate,
      endDate,
      data,
    }
    writeFileSync(DAILY_ACTIVITY_CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8')
    // Set file permissions to 0600 (owner read/write only)
    try {
      chmodSync(DAILY_ACTIVITY_CACHE_FILE, 0o600)
    } catch {
      // Non-fatal: chmod may fail on Windows
    }
  } catch {
    /* non-fatal */
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 }) // Owner only: rwx------
    } catch {
      // ignore — write will fail naturally if dir cannot be created
    }
  }
}
