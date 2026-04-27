import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  estimateCostFromPricing,
  loadOpenCodePricing,
  resetPricingCache,
  _setConfigPathForTesting,
} from '../src/data/opencode-pricing.js'

// ─── Temp fixture helpers ─────────────────────────────────────────────────────

const TEMP_DIR = join(tmpdir(), `taco-pricing-test-${process.pid}`)
const TEMP_CONFIG = join(TEMP_DIR, 'opencode.json')

function writeConfig(config: unknown): void {
  mkdirSync(TEMP_DIR, { recursive: true })
  writeFileSync(TEMP_CONFIG, JSON.stringify(config))
  _setConfigPathForTesting(TEMP_CONFIG)
}

function pointToNonExistent(): void {
  _setConfigPathForTesting(join(TEMP_DIR, 'does-not-exist.json'))
}

beforeEach(() => {
  resetPricingCache()
})

afterEach(() => {
  if (existsSync(TEMP_CONFIG)) rmSync(TEMP_CONFIG)
  // Restore to real path so other tests are unaffected
  _setConfigPathForTesting(join(homedir(), '.config', 'opencode', 'opencode.json'))
  resetPricingCache()
})

// ─── estimateCostFromPricing ──────────────────────────────────────────────────

describe('estimateCostFromPricing', () => {
  it('computes cost from input + output tokens', () => {
    const rates = { input: 0.000003, output: 0.000015 }
    const tokens = { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 }
    const cost = estimateCostFromPricing(tokens, rates)
    // 1000 * 0.000003 + 200 * 0.000015 = 0.003 + 0.003 = 0.006
    expect(cost).toBeCloseTo(0.006, 6)
  })

  it('includes cache_read cost when rate is provided', () => {
    const rates = { input: 0.000003, output: 0.000015, cacheRead: 0.0000003 }
    const tokens = { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 0 }
    const cost = estimateCostFromPricing(tokens, rates)
    // 1000*0.000003 + 200*0.000015 + 5000*0.0000003 = 0.003 + 0.003 + 0.0015 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6)
  })

  it('includes cache_write cost when rate is provided', () => {
    const rates = {
      input: 0.000003,
      output: 0.000015,
      cacheRead: 0.0000003,
      cacheWrite: 0.00000375,
    }
    const tokens = { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 2000 }
    const cost = estimateCostFromPricing(tokens, rates)
    // 0.003 + 0.003 + 0.0015 + 2000*0.00000375 = 0.0075 + 0.0075 = 0.015
    expect(cost).toBeCloseTo(0.015, 6)
  })

  it('handles zero tokens gracefully', () => {
    const rates = { input: 0.000003, output: 0.000015, cacheRead: 0.0000003 }
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    expect(estimateCostFromPricing(tokens, rates)).toBe(0)
  })

  it('ignores cacheRead/cacheWrite when rates are undefined', () => {
    const rates = { input: 0.000003, output: 0.000015 }
    const tokens = { input: 1000, output: 200, cacheRead: 9999, cacheWrite: 9999 }
    const cost = estimateCostFromPricing(tokens, rates)
    // cache tokens should not contribute since no rate is defined
    expect(cost).toBeCloseTo(0.006, 6)
  })
})

// ─── loadOpenCodePricing ──────────────────────────────────────────────────────

describe('loadOpenCodePricing', () => {
  it('returns null when config file does not exist', () => {
    pointToNonExistent()
    expect(loadOpenCodePricing()).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    mkdirSync(TEMP_DIR, { recursive: true })
    writeFileSync(TEMP_CONFIG, '{ not valid json }')
    _setConfigPathForTesting(TEMP_CONFIG)
    expect(loadOpenCodePricing()).toBeNull()
  })

  it('returns null when no provider has model pricing', () => {
    writeConfig({ provider: { anthropic: { options: { apiKey: 'test' } } } })
    expect(loadOpenCodePricing()).toBeNull()
  })

  it('parses model pricing from a valid opencode.json', () => {
    writeConfig({
      provider: {
        litellm: {
          models: {
            'anthropic.claude-sonnet-4-6': {
              cost: {
                input: 0.000003,
                output: 0.000015,
                cache_read: 3e-7,
                cache_write: 0.00000375,
              },
            },
            'vertex_ai/claude-opus-4-6': {
              cost: {
                input: 0.000005,
                output: 0.000025,
                cache_read: 5e-7,
              },
            },
          },
        },
      },
    })

    const result = loadOpenCodePricing()
    expect(result).not.toBeNull()

    // anthropic.claude-sonnet-4-6 normalises to claude-sonnet-4-6
    const sonnet = result!.get('claude-sonnet-4-6')
    expect(sonnet).toBeDefined()
    expect(sonnet!.input).toBe(0.000003)
    expect(sonnet!.output).toBe(0.000015)
    expect(sonnet!.cacheRead).toBe(3e-7)
    expect(sonnet!.cacheWrite).toBe(0.00000375)

    // vertex_ai/claude-opus-4-6 normalises to claude-opus-4-6
    const opus = result!.get('claude-opus-4-6')
    expect(opus).toBeDefined()
    expect(opus!.input).toBe(0.000005)
    expect(opus!.cacheRead).toBe(5e-7)
    // no cache_write in source
    expect(opus!.cacheWrite).toBeUndefined()
  })

  it('normalises all new provider prefixes when loading', () => {
    writeConfig({
      provider: {
        litellm: {
          models: {
            'azure/gpt-5.2-codex': { cost: { input: 0.00000175, output: 0.000014 } },
            'qwen.qwen3-vl-235b-a22b': { cost: { input: 5.3e-7, output: 2.66e-6 } },
            'zai.glm-4.7-flash': { cost: { input: 7e-8, output: 4e-7 } },
            'minimax.minimax-m2.5': { cost: { input: 3e-7, output: 1.2e-6 } },
            'vertex_ai/qwen/qwen3-next-80b-a3b-thinking-maas': {
              cost: { input: 1.5e-7, output: 1.2e-6 },
            },
            'vertex_ai/zai-org/glm-4.7-maas': { cost: { input: 6e-7, output: 2.2e-6 } },
            'vertex_ai/moonshotai/kimi-k2-thinking-maas': {
              cost: { input: 6e-7, output: 2.5e-6 },
            },
          },
        },
      },
    })

    const result = loadOpenCodePricing()
    expect(result).not.toBeNull()
    expect(result!.get('gpt-5-2-codex')).toBeDefined()
    expect(result!.get('qwen3-vl-235b-a22b')).toBeDefined()
    expect(result!.get('glm-4-7-flash')).toBeDefined()
    expect(result!.get('minimax-m2-5')).toBeDefined()
    expect(result!.get('qwen3-next-80b-a3b-thinking-maas')).toBeDefined()
    expect(result!.get('glm-4-7-maas')).toBeDefined()
    expect(result!.get('kimi-k2-thinking-maas')).toBeDefined()
  })

  it('deduplicates models that normalise to the same name (first wins)', () => {
    // Both normalise to "claude-opus-4-6" — first entry wins
    writeConfig({
      provider: {
        litellm: {
          models: {
            'anthropic.claude-opus-4-6': { cost: { input: 0.000005, output: 0.000025 } },
            'vertex_ai/claude-opus-4-6': { cost: { input: 0.000099, output: 0.000099 } },
          },
        },
      },
    })

    const result = loadOpenCodePricing()
    expect(result!.get('claude-opus-4-6')!.input).toBe(0.000005) // first wins
  })

  it('skips models without valid input/output cost', () => {
    writeConfig({
      provider: {
        litellm: {
          models: {
            'anthropic.claude-sonnet-4-6': { cost: { input: 0.000003, output: 0.000015 } },
            'bad-model': { cost: { input: 'not-a-number', output: 0.000015 } },
            'no-cost-model': { limit: { context: 64000 } },
          },
        },
      },
    })

    const result = loadOpenCodePricing()
    expect(result!.size).toBe(1) // only claude-sonnet-4-6
    expect(result!.has('bad-model')).toBe(false)
    expect(result!.has('no-cost-model')).toBe(false)
  })

  it('returns cached result within TTL', () => {
    writeConfig({
      provider: {
        litellm: {
          models: {
            'anthropic.claude-sonnet-4-6': { cost: { input: 0.000003, output: 0.000015 } },
          },
        },
      },
    })

    const first = loadOpenCodePricing()
    // Delete the file — next call should still return cached result
    rmSync(TEMP_CONFIG)
    const second = loadOpenCodePricing()
    expect(second).not.toBeNull()
    expect(second).toBe(first) // same reference = cache hit
  })

  it('returns fresh result after resetPricingCache()', () => {
    writeConfig({
      provider: {
        litellm: {
          models: {
            'anthropic.claude-sonnet-4-6': { cost: { input: 0.000003, output: 0.000015 } },
          },
        },
      },
    })

    const first = loadOpenCodePricing()
    expect(first).not.toBeNull()

    // Remove the file and reset the cache
    rmSync(TEMP_CONFIG)
    resetPricingCache()

    const second = loadOpenCodePricing()
    expect(second).toBeNull() // file is gone, fresh read returns null
  })
})
