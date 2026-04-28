import type { Command } from 'commander'
import chalk from 'chalk'
import * as readline from 'node:readline'
import { getDbAsync } from '../../data/db.js'
import { loadSessionDetail, loadSessions } from '../../data/queries.js'
import type { SessionDetail, SessionMessage } from '../../data/queries.js'
import { getConfig } from '../../config/index.js'
import { formatTokens, formatCost } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'
import { formatDuration } from '../../utils/dates.js'
import {
  loadObserverChatParams,
  loadObserverStreamingTiming,
  loadObserverContextSnapshots,
  loadObserverToolCalls,
  loadObserverSystemPrompts,
  loadObserverRetrievalRelevance,
  loadObserverToolLatencyBreakdown,
  getObserverDbAsync,
} from '../../data/observer-db.js'
import type {
  ObserverChatParams,
  ObserverStreamingTiming,
  ObserverContextSnapshot,
  ObserverToolCall,
  ObserverRetrievalRelevance,
  ObserverToolLatencyBreakdown,
} from '../../data/observer-db.js'

export function registerSessionDetailCommand(program: Command): void {
  program
    .command('session [id]')
    .description(
      'Show detailed breakdown of an OpenCode session. ' +
        'Omit [id] to pick from an interactive list.'
    )
    .option('--db <path>', 'Override OpenCode database path')
    .option('--tools', 'Show per-message tool call list', false)
    .option('--format <fmt>', 'Output format: visual | json (default: visual)')
    .action(async (id: string | undefined, opts) => {
      const config = getConfig()
      const db = await getDbAsync(opts.db ?? config.db)
      const format = opts.format ?? config.defaultFormat ?? 'visual'

      // Non-interactive (JSON/CSV/format) path — called with explicit ID
      if (id && format !== 'visual') {
        const detail = loadSessionDetail(db, id)
        if (!detail) {
          console.error(`Session not found: ${id}`)
          process.exit(1)
        }
        const [chatParams, timing, snapshots, toolCalls, systemPrompts] = await Promise.all([
          loadObserverChatParams(id),
          loadObserverStreamingTiming(id),
          loadObserverContextSnapshots(id),
          loadObserverToolCalls(id),
          loadObserverSystemPrompts(id),
        ])
        process.stdout.write(
          JSON.stringify(
            { detail, observer: { chatParams, timing, snapshots, toolCalls, systemPrompts } },
            null,
            2
          ) + '\n'
        )
        return
      }

      // If an explicit ID was passed (non-TUI), render detail and exit
      if (id) {
        await renderDetailAndExit(db, id, opts, /*fromTui=*/ false)
        return
      }

      // No ID — TUI picker loop: list → detail → list → detail → …
      await runTuiLoop(db, opts)
    })
}

/** Load and display one session's detail, then exit (static CLI usage). */
async function renderDetailAndExit(
  db: Awaited<ReturnType<typeof getDbAsync>>,
  id: string,
  opts: Record<string, unknown>,
  fromTui: boolean
): Promise<void> {
  const detail = loadSessionDetail(db, id)
  if (!detail) {
    console.error(`Session not found: ${id}`)
    console.error('Run `taco sessions` to list recent sessions.')
    process.exit(1)
  }

  const [chatParams, timing, snapshots, toolCalls, systemPrompts, retrievalRelevance, toolLatency] =
    await Promise.all([
      loadObserverChatParams(id),
      loadObserverStreamingTiming(id),
      loadObserverContextSnapshots(id),
      loadObserverToolCalls(id),
      loadObserverSystemPrompts(id),
      loadObserverRetrievalRelevance(id),
      loadObserverToolLatencyBreakdown(id),
    ])
  const hasObserver = (await getObserverDbAsync()) !== null

  const output = formatSessionDetail(
    detail,
    opts.tools as boolean,
    hasObserver,
    chatParams,
    timing,
    snapshots,
    toolCalls,
    systemPrompts.length > 0 ? (systemPrompts[0]!.tokenCount ?? null) : null,
    retrievalRelevance,
    toolLatency
  )

  if (!fromTui) {
    // Static mode — write and let commander exit naturally
    process.stdout.write(output)
    return
  }

  // TUI mode — write detail then show a navigation footer
  process.stdout.write('\x1B[2J\x1B[H') // clear
  process.stdout.write(output)
}

/**
 * Main TUI loop: show list → user selects → show detail with back navigation.
 * Keeps the terminal raw while navigating; restores it on exit.
 */
async function runTuiLoop(
  db: Awaited<ReturnType<typeof getDbAsync>>,
  opts: Record<string, unknown>
): Promise<void> {
  if (!process.stdout.isTTY) {
    // Non-interactive — just print the most recent session and exit
    const sessions = loadSessions(db).slice(-1)
    if (sessions[0]) await renderDetailAndExit(db, sessions[0].id, opts, false)
    process.exit(0)
  }

  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)

  const restoreTerminal = () => {
    try {
      process.stdin.setRawMode(false)
      process.stdin.pause()
    } catch {
      /* ignore */
    }
  }

  process.on('exit', restoreTerminal)
  process.on('SIGTERM', () => {
    restoreTerminal()
    process.exit(0)
  })

  while (true) {
    const picked = await pickSessionFromList(db)

    if (!picked) {
      // User quit from the list
      restoreTerminal()
      process.stdout.write('\x1B[2J\x1B[H')
      process.exit(0)
    }

    // Render the detail
    await renderDetailAndExit(db, picked, opts, true)

    // Show footer and wait for keypress
    const footer = chalk.dim('\n  ← b: back to list   q / Enter: quit\n')
    process.stdout.write(footer)

    const action = await waitForDetailKey()
    if (action === 'back') continue // go back to list
    // 'quit' or anything else
    restoreTerminal()
    process.stdout.write('\x1B[2J\x1B[H')
    process.exit(0)
  }
}

/** Wait for a single keypress on the detail screen. Returns 'back' or 'quit'. */
function waitForDetailKey(): Promise<'back' | 'quit'> {
  return new Promise(resolve => {
    const onKey = (_: string, key: readline.Key) => {
      if (!key) return
      if (key.name === 'b') {
        process.stdin.off('keypress', onKey)
        resolve('back')
      } else if (
        key.name === 'q' ||
        key.name === 'return' ||
        key.name === 'enter' ||
        (key.ctrl && key.name === 'c')
      ) {
        process.stdin.off('keypress', onKey)
        resolve('quit')
      }
    }
    process.stdin.on('keypress', onKey)
  })
}

// ─── Interactive session list picker ─────────────────────────────────────────
// Assumes stdin is already in raw mode (set by runTuiLoop).

async function pickSessionFromList(
  db: Awaited<ReturnType<typeof getDbAsync>>
): Promise<string | null> {
  const sessions = loadSessions(db).slice(-50).reverse()
  if (sessions.length === 0) {
    process.stdout.write('No sessions found in the database.\n')
    return null
  }

  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  let selected = 0
  const total = sessions.length

  const renderList = () => {
    process.stdout.write('\x1B[2J\x1B[H')
    process.stdout.write(
      (useColor
        ? `${colors.header.bold('TACO')} — Select a session\n`
        : 'TACO — Select a session\n') +
        chalk.dim('  ↑/↓  j/k  navigate    Enter  open    q  quit\n\n')
    )

    const visible = Math.min(total, 22)
    const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), total - visible))

    for (let i = start; i < start + visible; i++) {
      const s = sessions[i]!
      const isSel = i === selected
      const date = new Date(s.timeUpdated).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      const title = (s.title ?? '(untitled)').slice(0, 48).padEnd(48)
      const dir = (s.directory ?? '').split('/').slice(-2).join('/').slice(0, 24)
      const line = `  ${isSel ? '▶' : ' '} ${title}  ${chalk.dim(date)}  ${chalk.dim(dir)}`
      process.stdout.write((isSel && useColor ? chalk.bold(chalk.cyan(line)) : line) + '\n')
    }

    if (total > visible) {
      process.stdout.write(chalk.dim(`\n  … ${total - visible} more sessions\n`))
    }
  }

  renderList()

  return new Promise(resolve => {
    const onKey = (_: string, key: readline.Key) => {
      if (!key) return
      if (key.name === 'up' || key.name === 'k') {
        selected = Math.max(0, selected - 1)
        renderList()
      } else if (key.name === 'down' || key.name === 'j') {
        selected = Math.min(total - 1, selected + 1)
        renderList()
      } else if (key.name === 'return' || key.name === 'enter') {
        process.stdin.off('keypress', onKey)
        resolve(sessions[selected]?.id ?? null)
      } else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        process.stdin.off('keypress', onKey)
        resolve(null)
      }
    }
    process.stdin.on('keypress', onKey)
  })
}

// ─── Visual formatter ─────────────────────────────────────────────────────────

function formatSessionDetail(
  detail: SessionDetail,
  showTools: boolean,
  hasObserver: boolean,
  chatParams: ObserverChatParams[],
  timing: ObserverStreamingTiming[],
  snapshots: ObserverContextSnapshot[],
  toolCallsFull: ObserverToolCall[],
  systemPromptTokens: number | null,
  retrievalRelevance: ObserverRetrievalRelevance[] = [],
  toolLatency: ObserverToolLatencyBreakdown[] = []
): string {
  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  const dim = (s: string) => (useColor ? chalk.dim(s) : s)
  const bold = (s: string) => (useColor ? chalk.bold(s) : s)
  const divider = (len = 60) => (useColor ? colors.muted('─'.repeat(len)) : '─'.repeat(len))
  const kv = (label: string, value: string) => `  ${label.padEnd(22)} ${value}`

  const lines: string[] = []

  // ── Header ──
  const title = detail.title ?? '(untitled session)'
  lines.push(
    useColor
      ? `\n${colors.header.bold('TACO')} — Session · ${title}\n`
      : `\nTACO — Session · ${title}\n`
  )

  // ── Session metadata ──
  const created = new Date(detail.timeCreated).toLocaleString()
  const updated = new Date(detail.timeUpdated).toLocaleString()
  const durationMs = detail.timeUpdated - detail.timeCreated
  const dir = detail.directory ?? '—'

  lines.push(kv('Session ID:', detail.sessionId))
  lines.push(kv('Directory:', dir.length > 55 ? '…' + dir.slice(-54) : dir))
  lines.push(kv('Started:', created))
  lines.push(kv('Last active:', updated))
  lines.push(kv('Duration:', formatDuration(durationMs)))
  if (detail.summaryFiles && detail.summaryFiles > 0) {
    const adds = detail.summaryAdditions ?? 0
    const dels = detail.summaryDeletions ?? 0
    lines.push(
      kv(
        'Files changed:',
        `${detail.summaryFiles}  ${useColor ? chalk.green(`+${adds}`) : `+${adds}`} ${useColor ? chalk.red(`-${dels}`) : `-${dels}`}`
      )
    )
  }

  lines.push('')
  lines.push('  ' + divider(56))
  lines.push('')

  // ── Aggregate token + cost summary (from opencode.db) ──
  const assistantMsgs = detail.messages.filter(m => m.role === 'assistant')
  const userMsgs = detail.messages.filter(m => m.role === 'user')

  let totalIn = 0,
    totalOut = 0,
    totalCacheR = 0,
    totalCacheW = 0,
    totalReason = 0
  let totalCost = 0,
    totalTok = 0
  const toolCounts: Record<string, number> = {}
  const modelCounts: Record<string, number> = {}
  const agentCounts: Record<string, number> = {}
  const finishCounts: Record<string, number> = {}

  for (const m of assistantMsgs) {
    totalIn += m.tokens.input
    totalOut += m.tokens.output
    totalCacheR += m.tokens.cacheRead
    totalCacheW += m.tokens.cacheWrite
    totalReason += m.tokens.reasoning
    totalTok += m.tokens.total
    totalCost += m.cost
    if (m.modelId) modelCounts[m.modelId] = (modelCounts[m.modelId] ?? 0) + 1
    if (m.agent) agentCounts[m.agent] = (agentCounts[m.agent] ?? 0) + 1
    if (m.finish) finishCounts[m.finish] = (finishCounts[m.finish] ?? 0) + 1
    for (const t of m.tools) toolCounts[t.tool] = (toolCounts[t.tool] ?? 0) + 1
  }

  const totalTools = Object.values(toolCounts).reduce((s, n) => s + n, 0)
  const cacheReadPct = totalTok > 0 ? ((totalCacheR / totalTok) * 100).toFixed(1) : '0.0'

  lines.push(bold('  Token usage'))
  lines.push('')
  lines.push(kv('  Total tokens:', formatTokens(totalTok)))
  lines.push(kv('  Input:', formatTokens(totalIn)))
  lines.push(kv('  Output:', formatTokens(totalOut)))
  if (totalCacheR > 0)
    lines.push(
      kv('  Cache read:', `${formatTokens(totalCacheR)}  ${dim(`(${cacheReadPct}% of total)`)}`)
    )
  if (totalCacheW > 0) lines.push(kv('  Cache write:', formatTokens(totalCacheW)))
  if (totalReason > 0) lines.push(kv('  Reasoning:', formatTokens(totalReason)))
  lines.push('')
  lines.push(kv('  Cost:', formatCost(totalCost)))
  lines.push(kv('  Messages:', `${assistantMsgs.length} assistant  ${userMsgs.length} user`))
  lines.push(kv('  Tool calls:', String(totalTools)))

  // ── Models ──
  if (Object.keys(modelCounts).length > 0) {
    lines.push('')
    lines.push(bold('  Models'))
    lines.push('')
    for (const [model, count] of Object.entries(modelCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${model.padEnd(45)} ${String(count).padStart(4)} msgs`)
    }
  }

  // ── Agents ──
  if (Object.keys(agentCounts).length > 1) {
    lines.push('')
    lines.push(bold('  Agents'))
    lines.push('')
    for (const [agent, count] of Object.entries(agentCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${agent.padEnd(20)} ${String(count).padStart(4)} msgs`)
    }
  }

  // ── Tool call breakdown ──
  if (Object.keys(toolCounts).length > 0) {
    lines.push('')
    lines.push(bold('  Tool calls'))
    lines.push('')
    const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])
    const maxCount = sorted[0]?.[1] ?? 1
    for (const [tool, count] of sorted) {
      const bar = '█'.repeat(Math.max(1, Math.round((count / maxCount) * 20)))
      lines.push(
        `    ${tool.padEnd(40)} ${String(count).padStart(4)}  ${useColor ? chalk.cyan(bar) : bar}`
      )
    }
  }

  // ── Finish reasons ──
  if (Object.keys(finishCounts).length > 0) {
    const hasInteresting = Object.keys(finishCounts).some(k => k !== 'stop')
    if (hasInteresting) {
      lines.push('')
      lines.push(bold('  Finish reasons'))
      lines.push('')
      for (const [reason, count] of Object.entries(finishCounts).sort((a, b) => b[1] - a[1])) {
        const colorFn = reason === 'stop' ? dim : reason === 'error' ? chalk.red : chalk.yellow
        const label = useColor ? colorFn(reason) : reason
        lines.push(`    ${label.padEnd(useColor ? 35 : 20)} ${count}`)
      }
    }
  }

  // ══ Observer sections (only if taco-observer has data) ═══════════════════

  if (hasObserver) {
    lines.push('')
    lines.push('  ' + divider(56))
    lines.push(dim('  Observer data (taco-observer plugin)'))
    lines.push('')

    // ── LLM Parameters ──
    const firstParams = chatParams[0]
    if (firstParams) {
      lines.push(bold('  LLM Parameters'))
      lines.push('')
      if (firstParams.temperature !== null)
        lines.push(kv('  Temperature:', String(firstParams.temperature)))
      if (firstParams.topP !== null) lines.push(kv('  Top-P:', String(firstParams.topP)))
      if (firstParams.maxOutputTokens !== null)
        lines.push(kv('  Max output tokens:', formatTokens(firstParams.maxOutputTokens)))
      if (firstParams.modelContextLimit !== null)
        lines.push(kv('  Context limit:', formatTokens(firstParams.modelContextLimit)))
      if (firstParams.modelOutputLimit !== null)
        lines.push(kv('  Output limit:', formatTokens(firstParams.modelOutputLimit)))
      lines.push('')
    }

    // ── Cache Efficiency ──
    lines.push(bold('  Cache Efficiency'))
    lines.push('')
    if (totalTok > 0) {
      const freshPct = totalTok > 0 ? ((totalIn / totalTok) * 100).toFixed(1) : '0.0'
      const writePct = totalTok > 0 ? ((totalCacheW / totalTok) * 100).toFixed(1) : '0.0'
      lines.push(
        kv(
          '  Cache read ratio:',
          `${cacheReadPct}%  ${dim(`(${formatTokens(totalCacheR)} / ${formatTokens(totalTok)})`)}`
        )
      )
      lines.push(kv('  Cache write ratio:', `${writePct}%`))
      lines.push(kv('  Fresh input ratio:', `${freshPct}%`))

      // Effective cost per million tokens
      if (totalCost > 0 && totalTok > 0) {
        const costPer1M = (totalCost / totalTok) * 1_000_000
        lines.push(kv('  Effective $/1M tok:', `${formatCost(costPer1M)}`))
      }

      // System prompt footprint
      if (systemPromptTokens !== null && systemPromptTokens > 0) {
        const sysPct =
          totalCacheR > 0 ? ((systemPromptTokens / totalCacheR) * 100).toFixed(1) : null
        lines.push(
          kv(
            '  System prompt:',
            `${formatTokens(systemPromptTokens)} tokens${sysPct ? dim(` (≈${sysPct}% of cache reads)`) : ''}`
          )
        )
      }
    } else {
      lines.push(dim('    No token data available.'))
    }

    // ── Context Window Utilization ──
    if (snapshots.length > 0) {
      lines.push('')
      lines.push(bold('  Context Window Utilization'))
      lines.push('')

      const contextLimit = firstParams?.modelContextLimit
      const header = `    ${'Turn'.padEnd(6)} ${'Tokens'.padStart(10)}  ${'Utilization'.padStart(12)}  ${'Composition'.padEnd(30)}`
      lines.push(dim(header))

      // Show every 10th snapshot + first + last
      const indices = new Set([0, snapshots.length - 1])
      for (let i = 0; i < snapshots.length; i += Math.max(1, Math.floor(snapshots.length / 8))) {
        indices.add(i)
      }
      const toShow = [...indices].sort((a, b) => a - b)

      for (const idx of toShow) {
        const snap = snapshots[idx]!
        const turn = String(idx + 1).padEnd(6)
        const tok = formatTokens(snap.estimatedTokens ?? 0).padStart(10)
        const util =
          snap.contextUtilization !== null
            ? `${(snap.contextUtilization * 100).toFixed(1)}%`.padStart(12)
            : '       n/a'
        const overLimit =
          contextLimit && snap.estimatedTokens !== null && snap.estimatedTokens > contextLimit

        // Composition bar
        const toolPct = snap.toolOutputTokenPct ?? 0
        const convPct = snap.conversationTokenPct ?? 0
        const barWidth = 20
        const toolBars = Math.round(toolPct * barWidth)
        const convBars = Math.round(convPct * barWidth)

        const bar = useColor
          ? chalk.blue('█'.repeat(toolBars)) +
            chalk.green('█'.repeat(convBars)) +
            dim('░'.repeat(barWidth - toolBars - convBars))
          : '█'.repeat(toolBars) + '▒'.repeat(convBars) + '░'.repeat(barWidth - toolBars - convBars)

        const utilStr = overLimit ? (useColor ? chalk.red(util) : `${util}!`) : util
        lines.push(`    ${turn} ${tok}  ${utilStr}  ${bar}`)
      }

      lines.push('')
      lines.push(dim('    ■ blue=tool outputs  ■ green=conversation'))
      if (contextLimit) {
        lines.push(dim(`    Context limit: ${formatTokens(contextLimit)} tokens`))
      }
    }

    // ── Streaming Performance ──
    if (timing.length > 0) {
      const validTtft = timing
        .map(t => t.timeToFirstTokenMs)
        .filter((t): t is number => t !== null && t > 0)
      const validTotal = timing
        .map(t => t.totalStreamingMs)
        .filter((t): t is number => t !== null && t > 0)

      if (validTtft.length > 0) {
        lines.push('')
        lines.push(bold('  Streaming Performance'))
        lines.push('')
        validTtft.sort((a, b) => a - b)
        validTotal.sort((a, b) => a - b)

        const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
        const median = (arr: number[]) => arr[Math.floor(arr.length / 2)]!
        const p95 = (arr: number[]) => arr[Math.floor(arr.length * 0.95)]!

        const fmtMs = (ms: number) =>
          ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`

        lines.push(kv('  Avg TTFT:', fmtMs(avg(validTtft))))
        lines.push(kv('  Median TTFT:', fmtMs(median(validTtft))))
        lines.push(kv('  P95 TTFT:', fmtMs(p95(validTtft))))
        if (validTotal.length > 0) {
          lines.push(kv('  Avg response:', fmtMs(avg(validTotal))))
          lines.push(kv('  Fastest:', fmtMs(validTotal[0]!)))
          lines.push(kv('  Slowest:', fmtMs(validTotal[validTotal.length - 1]!)))
        }
        lines.push(kv('  Sample size:', `${validTtft.length} messages`))
      }
    }

    // ── Tool I/O Detail (observer data: input/output sizes, cost share) ──────
    if (toolCallsFull.length > 0) {
      const completedCalls = toolCallsFull.filter(t => t.status === 'completed')
      if (completedCalls.length > 0) {
        lines.push('')
        lines.push(bold('  Tool I/O Detail'))
        lines.push('')

        // Determine cost source note
        const firstParams = chatParams[0]
        const hasCostRates = firstParams?.costInput !== null && firstParams?.costInput !== undefined
        const costSource = hasCostRates
          ? dim(`  Cost rates from opencode.json model config`)
          : dim(`  ~cost = proportional share of step-finish (approximate)`)
        lines.push(costSource)
        lines.push('')

        const hasCostShare = completedCalls.some(t => t.costShare !== null)
        const hasImpact = completedCalls.some(t => t.nextTurnTokenImpact !== null)

        // Aggregate by tool
        const byTool: Record<
          string,
          {
            calls: number
            totalInputTok: number
            totalOutputTok: number
            totalDurationMs: number
            durCount: number
            truncated: number
            totalImpact: number
            impactCount: number
            totalCostShare: number
            costShareCount: number
          }
        > = {}

        for (const tc of completedCalls) {
          const t = byTool[tc.tool] ?? {
            calls: 0,
            totalInputTok: 0,
            totalOutputTok: 0,
            totalDurationMs: 0,
            durCount: 0,
            truncated: 0,
            totalImpact: 0,
            impactCount: 0,
            totalCostShare: 0,
            costShareCount: 0,
          }
          t.calls++
          t.totalInputTok += tc.inputEstimatedTokens ?? 0
          t.totalOutputTok += tc.outputEstimatedTokens ?? 0
          if (tc.durationMs !== null) {
            t.totalDurationMs += tc.durationMs
            t.durCount++
          }
          if (tc.truncated) t.truncated++
          if (tc.nextTurnTokenImpact !== null) {
            t.totalImpact += tc.nextTurnTokenImpact
            t.impactCount++
          }
          if (tc.costShare !== null) {
            t.totalCostShare += tc.costShare
            t.costShareCount++
          }
          byTool[tc.tool] = t
        }

        const header = [
          '    ' + 'Tool'.padEnd(36),
          'Calls'.padStart(5),
          'Avg In'.padStart(8),
          'Avg Out'.padStart(8),
          'Avg ms'.padStart(7),
          hasImpact ? 'Next-turn'.padStart(10) : '',
          hasCostShare ? '~Cost/call'.padStart(11) : '',
          'Trunc',
        ]
          .filter(Boolean)
          .join('  ')
        lines.push(dim(header))

        for (const [tool, s] of Object.entries(byTool).sort((a, b) => b[1].calls - a[1].calls)) {
          const avgIn = formatTokens(
            Math.round(s.calls > 0 ? s.totalInputTok / s.calls : 0)
          ).padStart(8)
          const avgOut = formatTokens(
            Math.round(s.calls > 0 ? s.totalOutputTok / s.calls : 0)
          ).padStart(8)
          const avgMs =
            s.durCount > 0
              ? `${Math.round(s.totalDurationMs / s.durCount)}ms`.padStart(7)
              : '      —'
          const trunc =
            s.truncated > 0
              ? useColor
                ? chalk.yellow(`${s.truncated}`)
                : String(s.truncated)
              : dim('0')

          const impactStr = hasImpact
            ? s.impactCount > 0
              ? formatTokens(Math.round(s.totalImpact / s.impactCount)).padStart(10)
              : '         —'
            : ''
          const costShareStr = hasCostShare
            ? s.costShareCount > 0
              ? (useColor ? chalk.dim('~') : '~') +
                formatCost(s.totalCostShare / s.costShareCount).padStart(10)
              : '          —'
            : ''

          const parts = [
            `    ${tool.padEnd(36)}`,
            String(s.calls).padStart(5),
            avgIn,
            avgOut,
            avgMs,
            hasImpact ? impactStr : '',
            hasCostShare ? costShareStr : '',
            trunc,
          ]
            .filter(Boolean)
            .join('  ')
          lines.push(parts)
        }

        // Summary totals
        const totalCostShare = completedCalls.reduce((s, t) => s + (t.costShare ?? 0), 0)
        if (hasCostShare && totalCostShare > 0) {
          lines.push('')
          lines.push(dim(`    Total ~cost from observer: ${formatCost(totalCostShare)}`))
          if (totalCost > 0) {
            const pct = ((totalCostShare / totalCost) * 100).toFixed(0)
            lines.push(
              dim(`    (covers ${pct}% of session cost — messages with observer data only)`)
            )
          }
        }
      }
    }

    // ── Retrieval Relevance ──
    if (retrievalRelevance.length > 0) {
      lines.push('')
      lines.push('  ' + divider(56))
      lines.push('')
      lines.push(bold('  Retrieval Relevance'))
      lines.push('')

      // Aggregate by tool
      const byTool = new Map<
        string,
        {
          calls: number
          fetchedTokens: number
          referencedTokens: number
          ratioSum: number
          ratioCount: number
          method: string
        }
      >()
      for (const r of retrievalRelevance) {
        const entry = byTool.get(r.tool) ?? {
          calls: 0,
          fetchedTokens: 0,
          referencedTokens: 0,
          ratioSum: 0,
          ratioCount: 0,
          method: r.scoringMethod,
        }
        entry.calls++
        entry.fetchedTokens += r.fetchedTokens
        entry.referencedTokens += r.referencedTokens ?? 0
        if (r.relevanceRatio !== null) {
          entry.ratioSum += r.relevanceRatio
          entry.ratioCount++
        }
        byTool.set(r.tool, entry)
      }

      lines.push(
        dim(
          `    ${'Tool'.padEnd(22)}  ${'Calls'.padStart(5)}  ${'Fetched'.padStart(8)}  ${'Referenced'.padStart(10)}  ${'Relevance'.padStart(9)}  Method`
        )
      )
      for (const [tool, s] of [...byTool.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
        const fetched = formatTokens(s.fetchedTokens).padStart(8)
        const referenced = formatTokens(s.referencedTokens).padStart(10)
        const relevance =
          s.ratioCount > 0
            ? `${((s.ratioSum / s.ratioCount) * 100).toFixed(1)}%`.padStart(9)
            : '        —'
        lines.push(
          `    ${tool.padEnd(22)}  ${String(s.calls).padStart(5)}  ${fetched}  ${referenced}  ${relevance}  ${s.method}`
        )
      }

      // Overall precision
      const totalFetched = retrievalRelevance.reduce((s, r) => s + r.fetchedTokens, 0)
      const totalReferenced = retrievalRelevance.reduce((s, r) => s + (r.referencedTokens ?? 0), 0)
      if (totalFetched > 0) {
        const precision = ((totalReferenced / totalFetched) * 100).toFixed(1)
        lines.push('')
        lines.push(
          dim(
            `    Overall precision: ${precision}%  (${formatTokens(totalReferenced)} referenced / ${formatTokens(totalFetched)} fetched)`
          )
        )
      }
    }

    // ── Tool Latency ──
    if (toolLatency.length > 0) {
      lines.push('')
      lines.push('  ' + divider(56))
      lines.push('')
      lines.push(bold('  Tool Latency'))
      lines.push('')

      // Aggregate by tool_call_id to get total per-call duration, then group by tool
      const byCallId = new Map<string, { tool: string; total: number }>()
      for (const l of toolLatency) {
        const entry = byCallId.get(l.toolCallId) ?? { tool: '', total: 0 }
        entry.total += l.durationMs
        // Infer tool name from matched tool_calls data if possible, else use phase prefix
        const matchedCall = toolCallsFull.find(tc => tc.id === l.toolCallId)
        entry.tool = matchedCall?.tool ?? (entry.tool || l.toolCallId)
        byCallId.set(l.toolCallId, entry)
      }

      // Group per-call totals by tool
      const byTool2 = new Map<string, number[]>()
      for (const { tool, total } of byCallId.values()) {
        const arr = byTool2.get(tool) ?? []
        arr.push(total)
        byTool2.set(tool, arr)
      }

      const percentile = (arr: number[], p: number) => {
        const sorted = [...arr].sort((a, b) => a - b)
        return sorted[Math.floor(sorted.length * p)] ?? sorted[sorted.length - 1] ?? 0
      }

      lines.push(
        dim(
          `    ${'Tool'.padEnd(22)}  ${'Calls'.padStart(5)}  ${'Avg'.padStart(7)}  ${'p50'.padStart(7)}  ${'p95'.padStart(7)}  ${'Max'.padStart(7)}`
        )
      )
      for (const [tool, durations] of [...byTool2.entries()].sort(
        (a, b) => b[1].length - a[1].length
      )) {
        const avg = durations.reduce((s, d) => s + d, 0) / durations.length
        const p50 = percentile(durations, 0.5)
        const p95 = percentile(durations, 0.95)
        const max = Math.max(...durations)
        lines.push(
          `    ${tool.padEnd(22)}  ${String(durations.length).padStart(5)}  ${`${Math.round(avg)}ms`.padStart(7)}  ${`${Math.round(p50)}ms`.padStart(7)}  ${`${Math.round(p95)}ms`.padStart(7)}  ${`${Math.round(max)}ms`.padStart(7)}`
        )
      }

      // Session wall-clock
      if (timing.length > 0) {
        const starts = timing.map(t => t.requestSent).filter((t): t is number => t !== null)
        const ends = timing.map(t => t.messageCompleted).filter((t): t is number => t !== null)
        if (starts.length > 0 && ends.length > 0) {
          const wallMs = Math.max(...ends) - Math.min(...starts)
          lines.push('')
          lines.push(dim(`    Session wall-clock: ${(wallMs / 1000).toFixed(1)}s`))
        }
      }
    }
  } else {
    lines.push('')
    lines.push(
      dim('  No observer data. Install taco-observer plugin to see streaming timing,') +
        '\n' +
        dim('  context window utilization, LLM parameters, and full tool I/O detail.')
    )
  }

  // ── Per-message timeline (--tools flag) ──
  if (showTools) {
    lines.push('')
    lines.push('  ' + divider(56))
    lines.push('')
    lines.push(bold('  Message timeline'))
    lines.push('')

    // Build callId → observer tool call map for enriched output
    const observerByCallId = new Map(toolCallsFull.map(t => [t.id, t]))

    for (const msg of detail.messages) {
      lines.push(...formatMessageRow(msg, useColor, dim, colors, observerByCallId))
    }
  }

  lines.push('')
  return lines.join('\n')
}

function formatMessageRow(
  msg: SessionMessage,
  useColor: boolean,
  dim: (s: string) => string,
  colors: ReturnType<typeof getColors>,
  observerByCallId: Map<string, ObserverToolCall>
): string[] {
  const lines: string[] = []
  const time = new Date(msg.timeCreated).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  if (msg.role === 'user') {
    lines.push(dim(`  [${time}] user`))
    return lines
  }

  const model = msg.modelId ?? 'unknown'
  const agent = msg.agent ?? ''
  const cost = formatCost(msg.cost)
  const tok = formatTokens(msg.tokens.total)
  const durationMs = msg.timeCompleted ? msg.timeCompleted - msg.timeCreated : null
  const dur = durationMs ? `  ${(durationMs / 1000).toFixed(1)}s` : ''
  const toolLen = msg.tools.length

  const header = useColor
    ? `  [${time}] ${colors.value(model)} ${colors.muted(`(${agent})`)}  ${colors.highlight(tok)}  ${colors.warning(cost)}${dur}  ${toolLen > 0 ? chalk.cyan(`${toolLen} tools`) : ''}`
    : `  [${time}] ${model} (${agent})  ${tok}  ${cost}${dur}  ${toolLen > 0 ? `${toolLen} tools` : ''}`

  lines.push(header)

  // Token breakdown
  if (msg.tokens.cacheRead > 0 || msg.tokens.reasoning > 0) {
    const parts = [`in:${formatTokens(msg.tokens.input)}`, `out:${formatTokens(msg.tokens.output)}`]
    if (msg.tokens.cacheRead > 0) parts.push(`cacheR:${formatTokens(msg.tokens.cacheRead)}`)
    if (msg.tokens.cacheWrite > 0) parts.push(`cacheW:${formatTokens(msg.tokens.cacheWrite)}`)
    if (msg.tokens.reasoning > 0) parts.push(`reason:${formatTokens(msg.tokens.reasoning)}`)
    lines.push(dim(`             ${parts.join('  ')}`))
  }

  // Tool calls
  for (const t of msg.tools) {
    const obs = observerByCallId.get(t.callId)
    const statusColor =
      t.status === 'completed' ? chalk.green : t.status === 'error' ? chalk.red : chalk.yellow
    const status = useColor ? statusColor('●') : t.status === 'completed' ? '✓' : '✗'
    const trunc = t.outputTruncated ? dim(' [truncated]') : ''
    const summary = t.inputSummary ? dim(`  ${t.inputSummary}`) : ''

    // Observer enrichment: show input/output token estimates + duration
    let obsStr = ''
    if (obs) {
      const parts: string[] = []
      if (obs.inputEstimatedTokens) parts.push(`in:${formatTokens(obs.inputEstimatedTokens)}`)
      if (obs.outputEstimatedTokens) parts.push(`out:${formatTokens(obs.outputEstimatedTokens)}`)
      if (obs.durationMs) parts.push(`${obs.durationMs}ms`)
      if (parts.length > 0) obsStr = dim(`  [${parts.join(' ')}]`)
    }

    lines.push(`    ${status} ${t.tool}${summary}${obsStr}${trunc}`)
  }

  return lines
}
