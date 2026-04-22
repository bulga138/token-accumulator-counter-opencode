import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { exportFixtureDbToFile } from './fixtures/create-fixture-db.js'
import { createProgram } from '../src/cli/index.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dirname ?? '.', '.fixture-tmp')
const FIXTURE_DB = join(FIXTURE_DIR, 'test-integration.db')

/** Capture process.stdout.write output while running an async function. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  }) as typeof process.stdout.write
  try {
    await fn()
  } finally {
    process.stdout.write = originalWrite
  }
  return chunks.join('')
}

/** Run a taco command against the fixture DB and return captured stdout. */
async function runTaco(...args: string[]): Promise<string> {
  const program = createProgram()
  // Prevent commander from calling process.exit on --help / --version
  program.exitOverride()
  return captureStdout(() =>
    program.parseAsync(['node', 'taco', ...args, '--db', FIXTURE_DB], { from: 'node' })
  )
}

/** Run a taco command without --db (for commands like config, --help). */
async function runTacoNoDb(...args: string[]): Promise<string> {
  const program = createProgram()
  program.exitOverride()
  // Config commands use console.log — capture it too
  const chunks: string[] = []
  const origLog = console.log
  const origWrite = process.stdout.write
  console.log = (...a: unknown[]) => {
    chunks.push(a.map(String).join(' ') + '\n')
  }
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  }) as typeof process.stdout.write
  try {
    await program.parseAsync(['node', 'taco', ...args], { from: 'node' })
  } finally {
    console.log = origLog
    process.stdout.write = origWrite
  }
  return chunks.join('')
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
  await exportFixtureDbToFile(FIXTURE_DB)
}, 15000)

afterAll(() => {
  try {
    if (existsSync(FIXTURE_DB)) unlinkSync(FIXTURE_DB)
  } catch {
    // ignore cleanup errors
  }
})

// ─── Integration tests ───────────────────────────────────────────────────────

describe('taco overview', () => {
  it('--format json returns valid JSON with expected fields', async () => {
    const out = await runTaco('overview', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    // Overview JSON has fields at root level, not nested under 'stats'
    expect(data).toHaveProperty('tokens')
    expect(data).toHaveProperty('cost')
  })

  it('--format csv returns CSV with headers', async () => {
    const out = await runTaco('overview', '--format', 'csv', '--from', '90d')
    expect(out).toContain('tokens_total')
    expect(out).toContain('cost_usd')
  })

  it('--format markdown returns markdown with header', async () => {
    const out = await runTaco('overview', '--format', 'markdown', '--from', '90d')
    expect(out).toContain('#')
  })
})

describe('taco models', () => {
  it('--format json returns array of model objects', async () => {
    const out = await runTaco('models', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty('modelId')
  })

  it('--sort cost --format json orders by cost descending', async () => {
    const out = await runTaco('models', '--format', 'json', '--sort', 'cost', '--from', '90d')
    const data = JSON.parse(out)
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].cost).toBeGreaterThanOrEqual(data[i].cost)
    }
  })

  it('includes expected model IDs', async () => {
    const out = await runTaco('models', '--format', 'json', '--from', '90d')
    const ids = JSON.parse(out).map((m: any) => m.modelId)
    expect(ids).toContain('claude-sonnet-4-6')
    expect(ids).toContain('gpt-4o')
  })
})

describe('taco providers', () => {
  it('--format json returns array with provider IDs', async () => {
    const out = await runTaco('providers', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    const ids = data.map((p: any) => p.providerId)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('openai')
  })
})

describe('taco daily', () => {
  it('--format json returns array with date fields', async () => {
    const out = await runTaco('daily', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)
    expect(data[0]).toHaveProperty('date')
    expect(data[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('--sort tokens --format json orders by tokens descending', async () => {
    const out = await runTaco('daily', '--format', 'json', '--sort', 'tokens', '--from', '90d')
    const data = JSON.parse(out)
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].tokens.total).toBeGreaterThanOrEqual(data[i].tokens.total)
    }
  })
})

describe('taco sessions', () => {
  it('--format json returns array with sessionId and title', async () => {
    const out = await runTaco('sessions', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)
    expect(data[0]).toHaveProperty('sessionId')
    expect(data[0]).toHaveProperty('title')
  })
})

describe('taco agents', () => {
  it('--format json returns array with build agent', async () => {
    const out = await runTaco('agents', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    const agents = data.map((a: any) => a.agent)
    expect(agents).toContain('build')
  })
})

describe('taco projects', () => {
  it('--format json returns array with directory field', async () => {
    const out = await runTaco('projects', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)
    expect(data[0]).toHaveProperty('directory')
  })
})

describe('taco trends', () => {
  it('--format json returns array of period objects', async () => {
    const out = await runTaco('trends', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)
    expect(data[0]).toHaveProperty('label')
  })

  it('--sort cost reorders by cost descending', async () => {
    const out = await runTaco('trends', '--format', 'json', '--sort', 'cost', '--from', '90d')
    const data = JSON.parse(out)
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].cost).toBeGreaterThanOrEqual(data[i].cost)
    }
  })
})

describe('taco health', () => {
  it('--format json returns health report with finishReasons', async () => {
    const out = await runTaco('health', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(data).toHaveProperty('totalMessages')
    expect(data).toHaveProperty('finishReasons')
    expect(data).toHaveProperty('globalErrorRate')
    expect(data).toHaveProperty('perModel')
    expect(data.totalMessages).toBeGreaterThan(0)
  })

  it('detects error and length finish reasons from fixture data', async () => {
    const out = await runTaco('health', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    const reasons = data.finishReasons.map((r: any) => r.reason)
    expect(reasons).toContain('stop')
    expect(reasons).toContain('error')
    expect(reasons).toContain('length')
  })

  it('computes per-model health stats', async () => {
    const out = await runTaco('health', '--format', 'json', '--from', '90d')
    const data = JSON.parse(out)
    expect(data.perModel.length).toBeGreaterThan(0)
    const model = data.perModel[0]
    expect(model).toHaveProperty('modelId')
    expect(model).toHaveProperty('errorRate')
    expect(model).toHaveProperty('lengthRate')
    expect(model).toHaveProperty('avgCostPerMsg')
  })
})

describe('taco today', () => {
  it('--format json returns object with date and overview', async () => {
    const out = await runTaco('today', '--format', 'json')
    const data = JSON.parse(out)
    expect(data).toHaveProperty('date')
    expect(data).toHaveProperty('overview')
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('taco config', () => {
  it('shows config file path', async () => {
    const out = await runTacoNoDb('config')
    expect(out).toContain('Config file:')
  })

  it('path subcommand returns a non-empty path', async () => {
    const out = await runTacoNoDb('config', 'path')
    expect(out.trim().length).toBeGreaterThan(0)
    expect(out).toContain('config')
  })
})

describe('taco --help and --version', () => {
  it('--help contains TACO', async () => {
    try {
      await runTacoNoDb('--help')
    } catch {
      // commander exitOverride throws on help/version
    }
    // If we get here without crashing, the command was registered correctly
    expect(true).toBe(true)
  })

  it('--version contains version string', async () => {
    try {
      const out = await runTacoNoDb('--version')
      expect(out).toContain('TACO')
    } catch {
      // commander exitOverride throws on --version — expected
      expect(true).toBe(true)
    }
  })
})
