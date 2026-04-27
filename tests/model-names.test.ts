import { describe, it, expect } from 'vitest'
import {
  normalizeModelName,
  aggregateModelSpend,
  matchModelName,
} from '../src/utils/model-names.js'

// ─── normalizeModelName ───────────────────────────────────────────────────────

describe('normalizeModelName — existing prefixes (regression)', () => {
  it('strips vertex_ai/ prefix', () => {
    expect(normalizeModelName('vertex_ai/claude-opus-4-6')).toBe('claude-opus-4-6')
  })

  it('strips bedrock/global.anthropic. prefix', () => {
    expect(normalizeModelName('bedrock/global.anthropic.claude-opus-4-6-v1')).toBe(
      'claude-opus-4-6'
    )
  })

  it('strips bedrock/eu.anthropic. prefix', () => {
    expect(normalizeModelName('bedrock/eu.anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('strips bedrock/us.anthropic. prefix', () => {
    expect(normalizeModelName('bedrock/us.anthropic.claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })

  it('strips bare bedrock/ prefix', () => {
    expect(normalizeModelName('bedrock/claude-opus-4-6')).toBe('claude-opus-4-6')
  })

  it('strips azure_ai/ prefix', () => {
    expect(normalizeModelName('azure_ai/Claude-Opus-4.6')).toBe('claude-opus-4-6')
  })

  it('strips anthropic. prefix', () => {
    expect(normalizeModelName('anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('replaces dots between digits with dashes', () => {
    expect(normalizeModelName('claude-sonnet-4.6')).toBe('claude-sonnet-4-6')
  })

  it('strips trailing wildcard suffixes', () => {
    expect(normalizeModelName('claude-opus-4-6*')).toBe('claude-opus-4-6')
    expect(normalizeModelName('claude-opus-4-6-*')).toBe('claude-opus-4-6')
  })

  it('strips version/date suffixes', () => {
    expect(normalizeModelName('bedrock/global.anthropic.claude-opus-4-6-v1')).toBe(
      'claude-opus-4-6'
    )
    expect(normalizeModelName('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(
      'claude-sonnet-4-5'
    )
  })

  it('lowercases the result', () => {
    expect(normalizeModelName('VERTEX_AI/CLAUDE-OPUS-4-6')).toBe('claude-opus-4-6')
  })
})

describe('normalizeModelName — azure/ prefix (new)', () => {
  it('strips azure/ prefix from GPT models', () => {
    expect(normalizeModelName('azure/gpt-5.2-codex')).toBe('gpt-5-2-codex')
    expect(normalizeModelName('azure/gpt-5.3-codex')).toBe('gpt-5-3-codex')
    expect(normalizeModelName('azure/gpt-5.4-mini')).toBe('gpt-5-4-mini')
    expect(normalizeModelName('azure/gpt-5.4-nano')).toBe('gpt-5-4-nano')
    expect(normalizeModelName('azure/gpt-5.4')).toBe('gpt-5-4')
    expect(normalizeModelName('azure/gpt-5.1-codex')).toBe('gpt-5-1-codex')
    expect(normalizeModelName('azure/gpt-5.1-codex-mini')).toBe('gpt-5-1-codex-mini')
    expect(normalizeModelName('azure/gpt-5.1-codex-max')).toBe('gpt-5-1-codex-max')
    expect(normalizeModelName('azure/gpt-5')).toBe('gpt-5')
    expect(normalizeModelName('azure/gpt-5-pro')).toBe('gpt-5-pro')
    expect(normalizeModelName('azure/gpt-5-mini')).toBe('gpt-5-mini')
    expect(normalizeModelName('azure/gpt-5-codex')).toBe('gpt-5-codex')
  })

  it('does not confuse azure/ with azure_ai/', () => {
    // azure_ai/ → same canonical name but different route
    expect(normalizeModelName('azure_ai/Claude-Opus-4.6')).toBe('claude-opus-4-6')
    expect(normalizeModelName('azure/gpt-5')).toBe('gpt-5')
  })
})

describe('normalizeModelName — qwen. prefix (new)', () => {
  it('strips qwen. prefix', () => {
    expect(normalizeModelName('qwen.qwen3-vl-235b-a22b')).toBe('qwen3-vl-235b-a22b')
    expect(normalizeModelName('qwen.qwen3-next-80b-a3b')).toBe('qwen3-next-80b-a3b')
    expect(normalizeModelName('qwen.qwen3-coder-30b-a3b-v1:0')).toBe('qwen3-coder-30b-a3b')
  })
})

describe('normalizeModelName — zai. prefix (new)', () => {
  it('strips zai. prefix', () => {
    expect(normalizeModelName('zai.glm-4.7-flash')).toBe('glm-4-7-flash')
  })
})

describe('normalizeModelName — minimax. prefix (new)', () => {
  it('strips minimax. prefix', () => {
    expect(normalizeModelName('minimax.minimax-m2.5')).toBe('minimax-m2-5')
  })
})

describe('normalizeModelName — nested vertex_ai/ prefixes (new)', () => {
  it('strips vertex_ai/qwen/ prefix', () => {
    expect(normalizeModelName('vertex_ai/qwen/qwen3-next-80b-a3b-thinking-maas')).toBe(
      'qwen3-next-80b-a3b-thinking-maas'
    )
    expect(normalizeModelName('vertex_ai/qwen/qwen3-235b-a22b-instruct-2507-maas')).toBe(
      'qwen3-235b-a22b-instruct-2507-maas'
    )
    expect(normalizeModelName('vertex_ai/qwen/qwen3-next-80b-a3b-instruct-maas')).toBe(
      'qwen3-next-80b-a3b-instruct-maas'
    )
    expect(normalizeModelName('vertex_ai/qwen/qwen3-coder-480b-a35b-instruct-maas')).toBe(
      'qwen3-coder-480b-a35b-instruct-maas'
    )
  })

  it('strips vertex_ai/zai-org/ prefix', () => {
    expect(normalizeModelName('vertex_ai/zai-org/glm-4.7-maas')).toBe('glm-4-7-maas')
    expect(normalizeModelName('vertex_ai/zai-org/glm-5-maas')).toBe('glm-5-maas')
  })

  it('strips vertex_ai/moonshotai/ prefix', () => {
    expect(normalizeModelName('vertex_ai/moonshotai/kimi-k2-thinking-maas')).toBe(
      'kimi-k2-thinking-maas'
    )
  })

  it('does NOT confuse nested prefixes with bare vertex_ai/', () => {
    // bare vertex_ai/ should still work
    expect(normalizeModelName('vertex_ai/claude-opus-4-6')).toBe('claude-opus-4-6')
    expect(normalizeModelName('vertex_ai/gemini-3-pro-preview')).toBe('gemini-3-pro-preview')
  })
})

describe('normalizeModelName — case insensitivity across new prefixes', () => {
  it('handles uppercase new prefixes', () => {
    expect(normalizeModelName('AZURE/GPT-5.2-CODEX')).toBe('gpt-5-2-codex')
    expect(normalizeModelName('QWEN.Qwen3-VL-235B-A22B')).toBe('qwen3-vl-235b-a22b')
  })
})

// ─── aggregateModelSpend ──────────────────────────────────────────────────────

describe('aggregateModelSpend', () => {
  it('sums spend for multiple provider variants of the same model', () => {
    const raw = {
      'vertex_ai/claude-opus-4-6': 29.16,
      'bedrock/global.anthropic.claude-opus-4-6-v1': 6.09,
      'azure_ai/Claude-Opus-4.6': 0.77,
    }
    const result = aggregateModelSpend(raw)
    expect(result.get('claude-opus-4-6')).toBeCloseTo(36.02, 2)
  })

  it('handles azure/ prefixed models', () => {
    const raw = {
      'azure/gpt-5.2-codex': 12.5,
      'azure/gpt-5.4-mini': 3.2,
    }
    const result = aggregateModelSpend(raw)
    expect(result.get('gpt-5-2-codex')).toBeCloseTo(12.5, 2)
    expect(result.get('gpt-5-4-mini')).toBeCloseTo(3.2, 2)
  })

  it('handles vertex_ai/qwen/ prefixed models', () => {
    const raw = {
      'vertex_ai/qwen/qwen3-next-80b-a3b-thinking-maas': 5.0,
      'qwen.qwen3-next-80b-a3b': 1.5,
    }
    const result = aggregateModelSpend(raw)
    // Both normalize to different names (thinking-maas suffix stays)
    expect(result.get('qwen3-next-80b-a3b-thinking-maas')).toBeCloseTo(5.0, 2)
    expect(result.get('qwen3-next-80b-a3b')).toBeCloseTo(1.5, 2)
  })

  it('keeps distinct models separate', () => {
    const raw = { 'azure/gpt-5': 10, 'azure/gpt-5-mini': 2 }
    const result = aggregateModelSpend(raw)
    expect(result.size).toBe(2)
  })
})

// ─── matchModelName ───────────────────────────────────────────────────────────

describe('matchModelName', () => {
  it('returns exact match', () => {
    const local = new Set(['claude-opus-4-6', 'gpt-4o'])
    expect(matchModelName('vertex_ai/claude-opus-4-6', local)).toBe('claude-opus-4-6')
  })

  it('matches azure/ prefixed gateway model to local name', () => {
    const local = new Set(['gpt-5-2-codex', 'claude-sonnet-4-6'])
    expect(matchModelName('azure/gpt-5.2-codex', local)).toBe('gpt-5-2-codex')
  })

  it('matches qwen. prefixed model', () => {
    const local = new Set(['qwen3-vl-235b-a22b'])
    expect(matchModelName('qwen.qwen3-vl-235b-a22b', local)).toBe('qwen3-vl-235b-a22b')
  })

  it('returns null when no match', () => {
    const local = new Set(['claude-sonnet-4-6'])
    expect(matchModelName('azure/gpt-5', local)).toBeNull()
  })
})
