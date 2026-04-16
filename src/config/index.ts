import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface TacoConfig {
  db?: string
  defaultFormat?: 'visual' | 'json' | 'csv' | 'markdown'
  defaultRange?: string
  currency?: string
  budget?: {
    daily?: number
    monthly?: number
  }
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
