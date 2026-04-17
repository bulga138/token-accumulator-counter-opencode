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
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import type {
  GatewayMetrics,
  GatewayDailySnapshot,
  GatewayModelSpendResult,
  GatewayDailyActivityResult,
} from './gateway-types.js'
import type { GatewayConfig } from '../config/index.js'

// ─── Paths ──────────────────────────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), '.cache', 'taco')
const LIVE_CACHE_FILE = join(CACHE_DIR, 'gateway-metrics.json')
const DAILY_DIR = join(CACHE_DIR, 'gateway-daily')
const MODEL_SPEND_CACHE_FILE = join(CACHE_DIR, 'gateway-model-spend.json')
const DAILY_ACTIVITY_CACHE_FILE = join(CACHE_DIR, 'gateway-daily-activity.json')

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
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
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

// ─── Daily snapshots ────────────────────────────────────────────────────────────

/**
 * Writes (or overwrites) the snapshot for today (local time).
 * Overwrites are fine — we always want the last value of the day.
 */
function writeDailySnapshot(data: GatewayMetrics, endpoint: string): void {
  ensureDir(DAILY_DIR)

  const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
  const snapshot: GatewayDailySnapshot = {
    date,
    fetchedAt: data.fetchedAt,
    totalSpend: data.totalSpend,
    teamSpend: data.teamSpend,
    endpoint,
  }

  try {
    writeFileSync(join(DAILY_DIR, `${date}.json`), JSON.stringify(snapshot, null, 2), 'utf-8')
  } catch {
    // Non-fatal
  }
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

  const { readdirSync } = require('node:fs') as typeof import('node:fs')
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
  } catch {
    /* non-fatal */
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // ignore — write will fail naturally if dir cannot be created
    }
  }
}
