import type { Command } from 'commander'
import chalk from 'chalk'
import { getDbAsync } from '../../data/db.js'
import { loadSessionDetail } from '../../data/queries.js'
import type { SessionDetail, SessionMessage } from '../../data/queries.js'
import { getConfig } from '../../config/index.js'
import { formatTokens, formatCost } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'
import { formatDuration } from '../../utils/dates.js'

export function registerSessionDetailCommand(program: Command): void {
  program
    .command('session <id>')
    .description('Show detailed breakdown of a single OpenCode session')
    .option('--db <path>', 'Override OpenCode database path')
    .option('--tools', 'Show per-message tool call list', false)
    .option('--format <fmt>', 'Output format: visual | json (default: visual)')
    .action(async (id: string, opts) => {
      const config = getConfig()
      const db = await getDbAsync(opts.db ?? config.db)

      const detail = loadSessionDetail(db, id)
      if (!detail) {
        console.error(`Session not found: ${id}`)
        console.error('Run `taco sessions` to list recent sessions.')
        process.exit(1)
      }

      const format = opts.format ?? config.defaultFormat ?? 'visual'

      if (format === 'json') {
        process.stdout.write(JSON.stringify(detail, null, 2) + '\n')
        return
      }

      process.stdout.write(formatSessionDetail(detail, opts.tools as boolean))
    })
}

// ─── Visual formatter ──────────────────────────────────────────────────────────

function formatSessionDetail(detail: SessionDetail, showTools: boolean): string {
  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  const dim = (s: string) => (useColor ? chalk.dim(s) : s)
  const bold = (s: string) => (useColor ? chalk.bold(s) : s)
  const divider = (len = 60) => (useColor ? colors.muted('─'.repeat(len)) : '─'.repeat(len))

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
  const kv = (label: string, value: string) => `  ${label.padEnd(20)} ${value}`

  lines.push(kv('Session ID:', detail.sessionId))
  lines.push(kv('Directory:', dir.length > 55 ? '…' + dir.slice(-54) : dir))
  lines.push(kv('Started:', created))
  lines.push(kv('Last active:', updated))
  lines.push(kv('Duration:', formatDuration(durationMs)))
  if (
    detail.summaryFiles !== null &&
    detail.summaryFiles !== undefined &&
    detail.summaryFiles > 0
  ) {
    const adds = detail.summaryAdditions ?? 0
    const dels = detail.summaryDeletions ?? 0
    const files = detail.summaryFiles
    lines.push(
      kv(
        'Files changed:',
        `${files}  ${useColor ? chalk.green(`+${adds}`) : `+${adds}`} ${useColor ? chalk.red(`-${dels}`) : `-${dels}`}`
      )
    )
  }

  lines.push('')
  lines.push('  ' + divider(56))
  lines.push('')

  // ── Aggregate token + cost summary ──
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
    for (const t of m.tools) {
      toolCounts[t.tool] = (toolCounts[t.tool] ?? 0) + 1
    }
  }

  const totalTools = Object.values(toolCounts).reduce((s, n) => s + n, 0)

  lines.push(bold('  Token usage'))
  lines.push('')
  lines.push(kv('  Total tokens:', formatTokens(totalTok)))
  lines.push(kv('  Input:', formatTokens(totalIn)))
  lines.push(kv('  Output:', formatTokens(totalOut)))
  if (totalCacheR > 0) lines.push(kv('  Cache read:', formatTokens(totalCacheR)))
  if (totalCacheW > 0) lines.push(kv('  Cache write:', formatTokens(totalCacheW)))
  if (totalReason > 0) lines.push(kv('  Reasoning:', formatTokens(totalReason)))
  lines.push('')
  lines.push(kv('  Cost:', formatCost(totalCost)))
  lines.push(kv('  Messages:', `${assistantMsgs.length} assistant  ${userMsgs.length} user`))
  lines.push(kv('  Tool calls:', String(totalTools)))

  // ── Models used ──
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
    for (const [tool, count] of sorted) {
      const bar = '█'.repeat(Math.max(1, Math.round((count / sorted[0][1]) * 20)))
      lines.push(
        `    ${tool.padEnd(40)} ${String(count).padStart(4)}  ${useColor ? chalk.cyan(bar) : bar}`
      )
    }
  }

  // ── Finish reasons ──
  const nonStop = Object.entries(finishCounts).filter(([k]) => k !== 'stop')
  if (nonStop.length > 0) {
    lines.push('')
    lines.push(bold('  Finish reasons'))
    lines.push('')
    for (const [reason, count] of Object.entries(finishCounts).sort((a, b) => b[1] - a[1])) {
      const color = reason === 'stop' ? dim : reason === 'error' ? chalk.red : chalk.yellow
      const label = useColor ? color(reason) : reason
      lines.push(`    ${label.padEnd(useColor ? 35 : 20)} ${count}`)
    }
  }

  // ── Per-message timeline (when --tools flag is set) ──
  if (showTools) {
    lines.push('')
    lines.push('  ' + divider(56))
    lines.push('')
    lines.push(bold('  Message timeline'))
    lines.push('')

    for (const msg of detail.messages) {
      lines.push(...formatMessageRow(msg, useColor, dim, colors))
    }
  }

  lines.push('')
  return lines.join('\n')
}

function formatMessageRow(
  msg: SessionMessage,
  useColor: boolean,
  dim: (s: string) => string,
  colors: ReturnType<typeof getColors>
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

  // Assistant message
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

  // Token breakdown when non-trivial
  if (msg.tokens.cacheRead > 0 || msg.tokens.reasoning > 0) {
    const parts = [`in:${formatTokens(msg.tokens.input)}`, `out:${formatTokens(msg.tokens.output)}`]
    if (msg.tokens.cacheRead > 0) parts.push(`cacheR:${formatTokens(msg.tokens.cacheRead)}`)
    if (msg.tokens.cacheWrite > 0) parts.push(`cacheW:${formatTokens(msg.tokens.cacheWrite)}`)
    if (msg.tokens.reasoning > 0) parts.push(`reason:${formatTokens(msg.tokens.reasoning)}`)
    lines.push(dim(`             ${parts.join('  ')}`))
  }

  // Tool calls
  for (const t of msg.tools) {
    const statusColor =
      t.status === 'completed' ? chalk.green : t.status === 'error' ? chalk.red : chalk.yellow
    const status = useColor ? statusColor('●') : t.status === 'completed' ? '✓' : '✗'
    const trunc = t.outputTruncated ? dim(' [truncated]') : ''
    const summary = t.inputSummary ? dim(`  ${t.inputSummary}`) : ''
    lines.push(`    ${status} ${t.tool}${summary}${trunc}`)
  }

  return lines
}
