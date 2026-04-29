import type { Command } from 'commander'
import chalk from 'chalk'
import * as readline from 'node:readline'
import { getDbAsync } from '../../data/db.js'
import { loadSessions } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { getConfig } from '../../config/index.js'
import { formatTokens, formatCost } from '../../utils/formatting.js'
import { getColors } from '../../theme/index.js'
import {
  getObserverDbAsync,
  loadToolCostStats,
  loadCacheEfficiencyStats,
  loadObserverContextSnapshots,
  loadObserverStreamingTiming,
  loadObserverTokenEstimates,
  loadObserverChatParams,
  loadObserverRetrievalRelevance,
  loadObserverToolLatencyBreakdown,
  loadObserverBenchmarkRuns,
  loadBenchmarkRunsByTask,
} from '../../data/observer-db.js'
import type {
  ObserverRetrievalRelevance,
  ObserverToolLatencyBreakdown,
} from '../../data/observer-db.js'

export function registerBenchmarkCommand(program: Command): void {
  const cmd = program
    .command('benchmark')
    .description('Token efficiency benchmark across sessions')
    .option('--db <path>', 'Override OpenCode database path')
    .option('--session <id>', 'Benchmark a single session')
    .option('--compare <ids>', 'Compare two sessions (comma-separated IDs)')
    .option(
      '--task <id>',
      'Task ID: aggregate session into benchmark_runs, or show all runs for task'
    )
    .option(
      '--strategy <name>',
      'Strategy label when recording a benchmark run (e.g. rag, full-file)'
    )
    .option('--from <date>', 'Start date filter (ISO or relative: 7d, 30d)')
    .option('--to <date>', 'End date filter')
    .option('--format <fmt>', 'Output format: visual | json | csv | markdown (default: visual)')
    .option('--clear', 'Clear the observer DB (requires confirmation)')

  cmd.action(async opts => {
    const config = getConfig()
    const db = await getDbAsync(opts.db ?? config.db)

    if (opts.clear) {
      await runClear()
      return
    }

    const observerDb = await getObserverDbAsync()
    if (!observerDb) {
      console.error(
        'Observer DB not found at ~/.local/share/taco/observer.db\n' +
          'Install the taco-observer plugin in opencode.json to start collecting data:\n' +
          '  { "plugin": ["taco-observer"] }'
      )
      process.exit(1)
    }

    const format = opts.format ?? config.defaultFormat ?? 'visual'

    if (opts.compare) {
      const ids = (opts.compare as string).split(',').map(s => s.trim())
      if (ids.length < 2) {
        console.error('--compare requires two comma-separated session IDs')
        process.exit(1)
      }
      const [idA, idB] = ids as [string, string]
      await runComparison(idA, idB, format)
      return
    }

    if (opts.session) {
      await runSingleBenchmark(
        opts.session as string,
        format,
        opts.task as string | undefined,
        opts.strategy as string | undefined
      )
      return
    }

    if (opts.task && !opts.session) {
      await runTaskComparison(opts.task as string, format)
      return
    }

    const filters = buildFilters({ from: opts.from, to: opts.to })
    const sessions = loadSessions(db, filters)
    const sessionIds = sessions.map(s => s.id)

    if (sessionIds.length === 0) {
      console.error('No sessions found for the given date range.')
      process.exit(1)
    }

    await runMultiBenchmark(sessionIds, format)
  })
}

async function runClear(): Promise<void> {
  const { OBSERVER_DB_PATH } = await import('../../data/observer-db.js')
  const { existsSync, statSync } = await import('node:fs')

  if (!existsSync(OBSERVER_DB_PATH)) {
    console.log('Observer DB does not exist — nothing to clear.')
    return
  }

  const size = statSync(OBSERVER_DB_PATH).size
  const sizeMb = (size / 1024 / 1024).toFixed(1)

  process.stdout.write(
    `Observer DB: ${OBSERVER_DB_PATH}\n` +
      `Size: ${sizeMb} MB\n\n` +
      'This will permanently delete all observer data (tool I/O, streaming timing,\n' +
      'context snapshots, LLM parameters, token estimates).\n\n' +
      'Are you sure? [y/N] '
  )

  const answer = await new Promise<string>(resolve => {
    const rl = readline.createInterface({ input: process.stdin })
    rl.once('line', line => {
      rl.close()
      resolve(line.trim().toLowerCase())
    })
  })

  if (answer !== 'y' && answer !== 'yes') {
    console.log('Aborted.')
    return
  }

  const { unlinkSync } = await import('node:fs')
  try {
    unlinkSync(OBSERVER_DB_PATH)
    for (const ext of ['-wal', '-shm']) {
      try {
        unlinkSync(OBSERVER_DB_PATH + ext)
      } catch {
        /* ok */
      }
    }
    console.log('Observer DB cleared.')
  } catch (err) {
    console.error('Failed to clear:', (err as Error).message)
    process.exit(1)
  }
}

async function runSingleBenchmark(
  sessionId: string,
  format: string,
  taskId?: string,
  strategy?: string
): Promise<void> {
  const [chatParams, timing, snapshots, tokenEsts, retrievalRelevance, toolLatency, existingRuns] =
    await Promise.all([
      loadObserverChatParams(sessionId),
      loadObserverStreamingTiming(sessionId),
      loadObserverContextSnapshots(sessionId),
      loadObserverTokenEstimates(sessionId),
      loadObserverRetrievalRelevance(sessionId),
      loadObserverToolLatencyBreakdown(sessionId),
      loadObserverBenchmarkRuns(sessionId),
    ])
  const toolStats = await loadToolCostStats([sessionId])
  const cacheStats = await loadCacheEfficiencyStats([sessionId])

  if (taskId && strategy) {
    await writeBenchmarkRun(
      sessionId,
      taskId,
      strategy,
      tokenEsts,
      timing,
      retrievalRelevance,
      toolLatency
    )
  }

  const data = {
    sessionId,
    chatParams,
    timing,
    snapshots,
    tokenEsts,
    toolStats,
    cacheStats,
    retrievalRelevance,
    toolLatency,
    existingRuns,
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  if (format === 'csv') {
    process.stdout.write(renderBenchmarkCsv(toolStats, cacheStats, retrievalRelevance, toolLatency))
    return
  }
  if (format === 'markdown') {
    process.stdout.write(
      renderBenchmarkMarkdown(
        sessionId,
        chatParams,
        timing,
        snapshots,
        tokenEsts,
        toolStats,
        cacheStats,
        retrievalRelevance,
        toolLatency
      )
    )
    return
  }

  process.stdout.write(
    renderBenchmarkVisual(
      sessionId,
      chatParams,
      timing,
      snapshots,
      tokenEsts,
      toolStats,
      cacheStats,
      retrievalRelevance,
      toolLatency
    )
  )
}

async function writeBenchmarkRun(
  sessionId: string,
  taskId: string,
  strategy: string,
  tokenEsts: Awaited<ReturnType<typeof loadObserverTokenEstimates>>,
  timing: Awaited<ReturnType<typeof loadObserverStreamingTiming>>,
  retrievalRelevance: ObserverRetrievalRelevance[],
  toolLatency: ObserverToolLatencyBreakdown[]
): Promise<void> {
  const db = await getObserverDbAsync()
  if (!db) return

  const opencodeEsts = tokenEsts.filter(e => e.approach === 'opencode')
  const totalInputTokens = opencodeEsts.reduce((s, e) => s + (e.inputTokens ?? 0), 0)
  const totalOutputTokens = opencodeEsts.reduce((s, e) => s + (e.outputTokens ?? 0), 0)
  const totalCost = opencodeEsts.reduce((s, e) => s + (e.estimatedCost ?? 0), 0)

  const totalFetchedTokens = retrievalRelevance.reduce((s, r) => s + r.fetchedTokens, 0)
  const totalReferencedTokens = retrievalRelevance.reduce(
    (s, r) => s + (r.referencedTokens ?? 0),
    0
  )
  const precisionScore = totalFetchedTokens > 0 ? totalReferencedTokens / totalFetchedTokens : null
  const avgRelevance =
    retrievalRelevance.length > 0
      ? retrievalRelevance.reduce((s, r) => s + (r.relevanceRatio ?? 0), 0) /
        retrievalRelevance.length
      : null

  const validTtft = timing
    .map(t => t.timeToFirstTokenMs)
    .filter((t): t is number => t !== null && t > 0)
  const avgTtftMs =
    validTtft.length > 0 ? validTtft.reduce((a, b) => a + b, 0) / validTtft.length : null

  const callTotals = new Map<string, number>()
  for (const l of toolLatency) {
    callTotals.set(l.toolCallId, (callTotals.get(l.toolCallId) ?? 0) + l.durationMs)
  }
  const allDurations = [...callTotals.values()].sort((a, b) => a - b)
  const avgToolDurationMs =
    allDurations.length > 0 ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length : null
  const avgQueryMs = avgToolDurationMs
  const p50QueryMs =
    allDurations.length > 0 ? (allDurations[Math.floor(allDurations.length * 0.5)] ?? null) : null
  const p95QueryMs =
    allDurations.length > 0 ? (allDurations[Math.floor(allDurations.length * 0.95)] ?? null) : null

  const starts = timing.map(t => t.requestSent).filter((t): t is number => t !== null)
  const ends = timing.map(t => t.messageCompleted).filter((t): t is number => t !== null)
  const totalSessionMs =
    starts.length > 0 && ends.length > 0 ? Math.max(...ends) - Math.min(...starts) : null

  try {
    db.prepare(
      `INSERT INTO benchmark_runs (
        task_id, session_id, strategy,
        total_input_tokens, total_output_tokens, total_cost, total_tool_calls,
        total_fetched_tokens, total_referenced_tokens,
        precision_score, avg_relevance,
        avg_ttft_ms, avg_tool_duration_ms, total_session_ms,
        avg_query_ms, p50_query_ms, p95_query_ms, timestamp
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run([
      taskId,
      sessionId,
      strategy,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      opencodeEsts.length,
      totalFetchedTokens,
      totalReferencedTokens,
      precisionScore,
      avgRelevance,
      avgTtftMs,
      avgToolDurationMs,
      totalSessionMs,
      avgQueryMs,
      p50QueryMs,
      p95QueryMs,
      Date.now(),
    ])
    console.error(`Benchmark run recorded: task=${taskId} strategy=${strategy}`)
  } catch (err) {
    console.error(`Failed to write benchmark run: ${(err as Error).message}`)
  }
}

async function runTaskComparison(taskId: string, format: string): Promise<void> {
  const runs = await loadBenchmarkRunsByTask(taskId)

  if (runs.length === 0) {
    console.error(`No benchmark runs found for task: ${taskId}`)
    console.error('Use --session <id> --task <id> --strategy <name> to record a run first.')
    process.exit(1)
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify({ taskId, runs }, null, 2) + '\n')
    return
  }
  if (format === 'csv') {
    const { stringify } = await import('csv-stringify/sync')
    process.stdout.write(
      stringify(
        runs.map(r => ({
          task_id: r.taskId,
          session_id: r.sessionId,
          strategy: r.strategy,
          total_cost: r.totalCost,
          total_input_tokens: r.totalInputTokens,
          total_output_tokens: r.totalOutputTokens,
          total_tool_calls: r.totalToolCalls,
          precision_score: r.precisionScore,
          avg_relevance: r.avgRelevance,
          avg_ttft_ms: r.avgTtftMs,
          avg_tool_duration_ms: r.avgToolDurationMs,
          total_session_ms: r.totalSessionMs,
          p50_query_ms: r.p50QueryMs,
          p95_query_ms: r.p95QueryMs,
        })),
        { header: true }
      )
    )
    return
  }

  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  const dim = (s: string) => (useColor ? chalk.dim(s) : s)
  const divider = (len = 64) => (useColor ? colors.muted('─'.repeat(len)) : '─'.repeat(len))

  const lines: string[] = []
  lines.push(
    useColor
      ? `\n${colors.header.bold('TACO')} — Benchmark Task · ${taskId}\n`
      : `\nTACO — Benchmark Task · ${taskId}\n`
  )
  lines.push(`  ${runs.length} run(s) recorded`)
  lines.push('')

  const stratW = 16
  const valW = 14
  lines.push('  ' + divider())
  lines.push('')
  lines.push(
    dim(
      `  ${'Strategy'.padEnd(stratW)}  ${'Session'.padEnd(16)}  ${'Cost'.padStart(valW)}  ${'Precision'.padStart(10)}  ${'Avg tool'.padStart(9)}  ${'p95 query'.padStart(10)}  ${'Wall-clock'.padStart(11)}`
    )
  )

  for (const r of runs) {
    const cost = r.totalCost !== null ? formatCost(r.totalCost) : '—'
    const precision = r.precisionScore !== null ? `${(r.precisionScore * 100).toFixed(1)}%` : '—'
    const avgTool = r.avgToolDurationMs !== null ? `${Math.round(r.avgToolDurationMs)}ms` : '—'
    const p95 = r.p95QueryMs !== null ? `${Math.round(r.p95QueryMs)}ms` : '—'
    const wall = r.totalSessionMs !== null ? `${(r.totalSessionMs / 1000).toFixed(1)}s` : '—'
    lines.push(
      `  ${r.strategy.slice(0, stratW).padEnd(stratW)}  ${r.sessionId.slice(0, 16).padEnd(16)}  ${cost.padStart(valW)}  ${precision.padStart(10)}  ${avgTool.padStart(9)}  ${p95.padStart(10)}  ${wall.padStart(11)}`
    )
  }

  lines.push('')
  process.stdout.write(lines.join('\n'))
}

async function runMultiBenchmark(sessionIds: string[], format: string): Promise<void> {
  const toolStats = await loadToolCostStats(sessionIds)
  const cacheStats = await loadCacheEfficiencyStats(sessionIds)

  const allRelevance = (
    await Promise.all(sessionIds.map(id => loadObserverRetrievalRelevance(id)))
  ).flat()
  const allLatency = (
    await Promise.all(sessionIds.map(id => loadObserverToolLatencyBreakdown(id)))
  ).flat()

  const data = { sessionCount: sessionIds.length, toolStats, cacheStats, allRelevance, allLatency }

  if (format === 'json') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  if (format === 'csv') {
    process.stdout.write(renderBenchmarkCsv(toolStats, cacheStats, allRelevance, allLatency))
    return
  }

  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  const dim = (s: string) => (useColor ? chalk.dim(s) : s)
  const bold = (s: string) => (useColor ? chalk.bold(s) : s)
  const divider = (len = 64) => (useColor ? colors.muted('─'.repeat(len)) : '─'.repeat(len))

  const lines: string[] = []
  lines.push(
    useColor
      ? `\n${colors.header.bold('TACO')} — Benchmark · ${sessionIds.length} sessions\n`
      : `\nTACO — Benchmark · ${sessionIds.length} sessions\n`
  )

  if (toolStats.length > 0) {
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Cost per Tool Call'))
    lines.push('')
    lines.push(
      dim(
        `    ${'Tool'.padEnd(38)} ${'Calls'.padStart(6)}  ${'Avg In'.padStart(8)}  ${'Avg Out'.padStart(8)}  ${'Avg ms'.padStart(7)}`
      )
    )
    for (const s of toolStats) {
      const avgIn = formatTokens(Math.round(s.avgInputTokens)).padStart(8)
      const avgOut = formatTokens(Math.round(s.avgOutputTokens)).padStart(8)
      const avgMs =
        s.avgDurationMs !== null ? `${Math.round(s.avgDurationMs)}ms`.padStart(7) : '      —'
      lines.push(
        `    ${s.tool.padEnd(38)} ${String(s.callCount).padStart(6)}  ${avgIn}  ${avgOut}  ${avgMs}`
      )
    }
  }

  if (cacheStats.length > 0) {
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Cache Efficiency by Model'))
    lines.push('')
    lines.push(
      dim(
        `    ${'Model'.padEnd(45)} ${'Cache Read%'.padStart(12)} ${'Cache Write%'.padStart(13)} ${'Fresh%'.padStart(7)}`
      )
    )
    for (const s of cacheStats) {
      const cR = `${(s.cacheReadPct * 100).toFixed(1)}%`.padStart(12)
      const cW = `${(s.cacheWritePct * 100).toFixed(1)}%`.padStart(13)
      const fr = `${(s.freshInputPct * 100).toFixed(1)}%`.padStart(7)
      lines.push(`    ${s.modelId.padEnd(45)} ${cR} ${cW} ${fr}`)
    }
  }

  if (allRelevance.length > 0) {
    const totalFetched = allRelevance.reduce((s, r) => s + r.fetchedTokens, 0)
    const totalReferenced = allRelevance.reduce((s, r) => s + (r.referencedTokens ?? 0), 0)
    const avgPrecision = totalFetched > 0 ? totalReferenced / totalFetched : null
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Aggregate Retrieval Efficiency'))
    lines.push('')
    lines.push(`    Total fetched:     ${formatTokens(totalFetched)}`)
    lines.push(`    Total referenced:  ${formatTokens(totalReferenced)}`)
    if (avgPrecision !== null) {
      lines.push(`    Avg precision:     ${(avgPrecision * 100).toFixed(1)}%`)
    }
  }

  if (allLatency.length > 0) {
    const callTotals = new Map<string, number>()
    for (const l of allLatency) {
      callTotals.set(l.toolCallId, (callTotals.get(l.toolCallId) ?? 0) + l.durationMs)
    }
    const durations = [...callTotals.values()].sort((a, b) => a - b)
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Query Speed Summary'))
    lines.push('')
    lines.push(`    Tool calls:  ${durations.length}`)
    lines.push(`    Avg:         ${Math.round(avg)}ms`)
    lines.push(`    p50:         ${Math.round(p50)}ms`)
    lines.push(`    p95:         ${Math.round(p95)}ms`)
  }

  lines.push('')
  process.stdout.write(lines.join('\n'))
}

async function runComparison(idA: string, idB: string, format: string): Promise<void> {
  const [
    [timingA, snapsA, tokenEstsA, cacheA, relevanceA, latencyA],
    [timingB, snapsB, tokenEstsB, cacheB, relevanceB, latencyB],
  ] = await Promise.all([
    Promise.all([
      loadObserverStreamingTiming(idA),
      loadObserverContextSnapshots(idA),
      loadObserverTokenEstimates(idA),
      loadCacheEfficiencyStats([idA]),
      loadObserverRetrievalRelevance(idA),
      loadObserverToolLatencyBreakdown(idA),
    ]),
    Promise.all([
      loadObserverStreamingTiming(idB),
      loadObserverContextSnapshots(idB),
      loadObserverTokenEstimates(idB),
      loadCacheEfficiencyStats([idB]),
      loadObserverRetrievalRelevance(idB),
      loadObserverToolLatencyBreakdown(idB),
    ]),
  ])

  const summarise = (
    timing: typeof timingA,
    snaps: typeof snapsA,
    ests: typeof tokenEstsA,
    cache: typeof cacheA,
    relevance: ObserverRetrievalRelevance[],
    latency: ObserverToolLatencyBreakdown[]
  ) => {
    const opencodeEsts = ests.filter(e => e.approach === 'opencode')
    const totalCost = opencodeEsts.reduce((s, e) => s + (e.estimatedCost ?? 0), 0)
    const totalTok = opencodeEsts.reduce((s, e) => s + (e.totalTokens ?? 0), 0)
    const totalCacheR = opencodeEsts.reduce((s, e) => s + (e.cacheReadTokens ?? 0), 0)
    const validTtft = timing
      .map(t => t.timeToFirstTokenMs)
      .filter((t): t is number => t !== null && t > 0)
    const avgTtft =
      validTtft.length > 0 ? validTtft.reduce((a, b) => a + b, 0) / validTtft.length : null
    const avgCtxUtil =
      snaps.length > 0
        ? snaps.reduce((s, n) => s + (n.contextUtilization ?? 0), 0) / snaps.length
        : null
    const cacheReadPct = totalTok > 0 ? totalCacheR / totalTok : null

    const totalFetched = relevance.reduce((s, r) => s + r.fetchedTokens, 0)
    const totalReferenced = relevance.reduce((s, r) => s + (r.referencedTokens ?? 0), 0)
    const precisionScore = totalFetched > 0 ? totalReferenced / totalFetched : null

    const callTotals = new Map<string, number>()
    for (const l of latency) {
      callTotals.set(l.toolCallId, (callTotals.get(l.toolCallId) ?? 0) + l.durationMs)
    }
    const durations = [...callTotals.values()].sort((a, b) => a - b)
    const avgToolDurationMs =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null
    const p95ToolDurationMs =
      durations.length > 0 ? (durations[Math.floor(durations.length * 0.95)] ?? null) : null

    const starts = timing.map(t => t.requestSent).filter((t): t is number => t !== null)
    const ends = timing.map(t => t.messageCompleted).filter((t): t is number => t !== null)
    const wallMs =
      starts.length > 0 && ends.length > 0 ? Math.max(...ends) - Math.min(...starts) : null

    return {
      totalCost,
      totalTok,
      cacheReadPct,
      avgTtft,
      avgCtxUtil,
      msgCount: opencodeEsts.length,
      cacheModel: cache[0]?.modelId ?? 'unknown',
      precisionScore,
      avgToolDurationMs,
      p95ToolDurationMs,
      wallMs,
    }
  }

  const A = summarise(timingA, snapsA, tokenEstsA, cacheA, relevanceA, latencyA)
  const B = summarise(timingB, snapsB, tokenEstsB, cacheB, relevanceB, latencyB)

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({ A: { id: idA, ...A }, B: { id: idB, ...B } }, null, 2) + '\n'
    )
    return
  }

  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  const dim = (s: string) => (useColor ? chalk.dim(s) : s)

  const lines: string[] = []
  lines.push(
    useColor
      ? `\n${colors.header.bold('TACO')} — Session Comparison\n`
      : `\nTACO — Session Comparison\n`
  )

  const colW = 22
  const valW = 16

  const header = `  ${'Metric'.padEnd(colW)} ${idA.slice(0, valW).padStart(valW)} ${idB.slice(0, valW).padStart(valW)} ${'Delta'.padStart(12)}`
  lines.push(dim(header))
  lines.push(dim(`  ${'─'.repeat(colW + valW * 2 + 16)}`))

  const row = (
    label: string,
    a: number | null,
    b: number | null,
    fmt: (n: number) => string,
    lowerIsBetter = true
  ) => {
    const aStr = a !== null ? fmt(a) : '—'
    const bStr = b !== null ? fmt(b) : '—'
    let deltaStr = '—'
    let deltaColor = dim

    if (a !== null && b !== null && a !== 0) {
      const pct = ((b - a) / Math.abs(a)) * 100
      const sign = pct > 0 ? '+' : ''
      deltaStr = `${sign}${pct.toFixed(1)}%`
      const improved = lowerIsBetter ? pct < 0 : pct > 0
      deltaColor = improved ? chalk.green : Math.abs(pct) < 2 ? dim : chalk.yellow
    }

    const delta = useColor ? deltaColor(deltaStr.padStart(12)) : deltaStr.padStart(12)
    lines.push(`  ${label.padEnd(colW)} ${aStr.padStart(valW)} ${bStr.padStart(valW)} ${delta}`)
  }

  row('Total cost', A.totalCost, B.totalCost, formatCost)
  row('Total tokens', A.totalTok, B.totalTok, v => formatTokens(Math.round(v)))
  row('Cache read ratio', A.cacheReadPct, B.cacheReadPct, v => `${(v * 100).toFixed(1)}%`, false)
  row('Avg context util.', A.avgCtxUtil, B.avgCtxUtil, v => `${(v * 100).toFixed(1)}%`)
  row('Avg TTFT', A.avgTtft, B.avgTtft, v => `${(v / 1000).toFixed(2)}s`)
  row('Messages', A.msgCount, B.msgCount, v => String(v))
  row(
    'Retrieval precision',
    A.precisionScore,
    B.precisionScore,
    v => `${(v * 100).toFixed(1)}%`,
    false
  )
  row('Avg tool latency', A.avgToolDurationMs, B.avgToolDurationMs, v => `${Math.round(v)}ms`)
  row('p95 tool latency', A.p95ToolDurationMs, B.p95ToolDurationMs, v => `${Math.round(v)}ms`)
  row('Session wall-clock', A.wallMs, B.wallMs, v => `${(v / 1000).toFixed(1)}s`)

  lines.push('')
  process.stdout.write(lines.join('\n'))
}

function renderBenchmarkCsv(
  toolStats: Awaited<ReturnType<typeof loadToolCostStats>>,
  cacheStats: Awaited<ReturnType<typeof loadCacheEfficiencyStats>>,
  retrievalRelevance: ObserverRetrievalRelevance[] = [],
  toolLatency: ObserverToolLatencyBreakdown[] = []
): string {
  const lines: string[] = []
  lines.push('section,key,value')
  for (const s of toolStats) {
    lines.push(`tool,${s.tool} calls,${s.callCount}`)
    lines.push(`tool,${s.tool} avg_input_tokens,${Math.round(s.avgInputTokens)}`)
    lines.push(`tool,${s.tool} avg_output_tokens,${Math.round(s.avgOutputTokens)}`)
    if (s.avgDurationMs !== null)
      lines.push(`tool,${s.tool} avg_duration_ms,${Math.round(s.avgDurationMs)}`)
  }
  for (const s of cacheStats) {
    lines.push(`cache,${s.modelId} cache_read_pct,${(s.cacheReadPct * 100).toFixed(2)}`)
    lines.push(`cache,${s.modelId} cache_write_pct,${(s.cacheWritePct * 100).toFixed(2)}`)
    lines.push(`cache,${s.modelId} fresh_pct,${(s.freshInputPct * 100).toFixed(2)}`)
  }
  if (retrievalRelevance.length > 0) {
    const totalFetched = retrievalRelevance.reduce((s, r) => s + r.fetchedTokens, 0)
    const totalReferenced = retrievalRelevance.reduce((s, r) => s + (r.referencedTokens ?? 0), 0)
    lines.push(`retrieval,total_fetched_tokens,${totalFetched}`)
    lines.push(`retrieval,total_referenced_tokens,${totalReferenced}`)
    if (totalFetched > 0)
      lines.push(`retrieval,precision_pct,${((totalReferenced / totalFetched) * 100).toFixed(2)}`)
  }
  if (toolLatency.length > 0) {
    const callTotals = new Map<string, number>()
    for (const l of toolLatency)
      callTotals.set(l.toolCallId, (callTotals.get(l.toolCallId) ?? 0) + l.durationMs)
    const durations = [...callTotals.values()].sort((a, b) => a - b)
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0
    lines.push(`latency,avg_tool_duration_ms,${Math.round(avg)}`)
    lines.push(`latency,p50_tool_duration_ms,${Math.round(p50)}`)
    lines.push(`latency,p95_tool_duration_ms,${Math.round(p95)}`)
  }
  return lines.join('\n') + '\n'
}

function renderBenchmarkMarkdown(
  sessionId: string,
  _chatParams: unknown[],
  timing: Awaited<ReturnType<typeof loadObserverStreamingTiming>>,
  snapshots: Awaited<ReturnType<typeof loadObserverContextSnapshots>>,
  tokenEsts: Awaited<ReturnType<typeof loadObserverTokenEstimates>>,
  toolStats: Awaited<ReturnType<typeof loadToolCostStats>>,
  cacheStats: Awaited<ReturnType<typeof loadCacheEfficiencyStats>>,
  retrievalRelevance: ObserverRetrievalRelevance[] = [],
  toolLatency: ObserverToolLatencyBreakdown[] = []
): string {
  const lines: string[] = []
  lines.push(`# TACO Benchmark — ${sessionId}\n`)

  if (toolStats.length > 0) {
    lines.push('## Tool Call Stats\n')
    lines.push('| Tool | Calls | Avg In | Avg Out | Avg ms |')
    lines.push('|------|------:|-------:|--------:|-------:|')
    for (const s of toolStats) {
      const avgMs = s.avgDurationMs !== null ? `${Math.round(s.avgDurationMs)}ms` : '—'
      lines.push(
        `| ${s.tool} | ${s.callCount} | ${formatTokens(Math.round(s.avgInputTokens))} | ${formatTokens(Math.round(s.avgOutputTokens))} | ${avgMs} |`
      )
    }
    lines.push('')
  }

  if (cacheStats.length > 0) {
    lines.push('## Cache Efficiency\n')
    lines.push('| Model | Cache Read% | Cache Write% | Fresh% |')
    lines.push('|-------|------------:|-------------:|-------:|')
    for (const s of cacheStats) {
      lines.push(
        `| ${s.modelId} | ${(s.cacheReadPct * 100).toFixed(1)}% | ${(s.cacheWritePct * 100).toFixed(1)}% | ${(s.freshInputPct * 100).toFixed(1)}% |`
      )
    }
    lines.push('')
  }

  const validTtft = timing
    .map(t => t.timeToFirstTokenMs)
    .filter((t): t is number => t !== null && t > 0)
  if (validTtft.length > 0) {
    validTtft.sort((a, b) => a - b)
    const avg = validTtft.reduce((a, b) => a + b, 0) / validTtft.length
    const median = validTtft[Math.floor(validTtft.length / 2)]!
    lines.push('## Streaming Performance\n')
    lines.push(`- Avg TTFT: ${(avg / 1000).toFixed(2)}s`)
    lines.push(`- Median TTFT: ${(median / 1000).toFixed(2)}s`)
    lines.push(`- Sample: ${validTtft.length} messages`)
    lines.push('')
  }

  const approaches = [...new Set(tokenEsts.map(e => e.approach))]
  if (approaches.length > 1 && approaches.includes('opencode')) {
    lines.push('## Token Estimation Accuracy\n')
    lines.push('| Approach | Avg Error vs opencode |')
    lines.push('|----------|-----------------------:|')
    const opencode = tokenEsts.filter(e => e.approach === 'opencode')
    const ocMap = new Map(opencode.map(e => [e.messageId, e.totalTokens]))
    for (const approach of approaches.filter(a => a !== 'opencode')) {
      const thisApproach = tokenEsts.filter(e => e.approach === approach)
      const errors = thisApproach
        .map(e => {
          const oc = ocMap.get(e.messageId)
          if (!oc || oc === 0) return null
          return Math.abs(((e.totalTokens ?? 0) - oc) / oc) * 100
        })
        .filter((e): e is number => e !== null)
      if (errors.length > 0) {
        const avgErr = errors.reduce((a, b) => a + b, 0) / errors.length
        lines.push(`| ${approach} | ±${avgErr.toFixed(1)}% |`)
      }
    }
    lines.push('')
  }

  if (snapshots.length > 0) {
    const peak = Math.max(...snapshots.map(s => s.contextUtilization ?? 0))
    const avg = snapshots.reduce((s, n) => s + (n.contextUtilization ?? 0), 0) / snapshots.length
    lines.push('## Context Window\n')
    lines.push(`- Peak utilization: ${(peak * 100).toFixed(1)}%`)
    lines.push(`- Avg utilization: ${(avg * 100).toFixed(1)}%`)
    lines.push(`- Snapshots: ${snapshots.length}`)
    lines.push('')
  }

  if (retrievalRelevance.length > 0) {
    lines.push('## Retrieval Efficiency\n')
    lines.push('| Tool | Calls | Fetched | Referenced | Relevance | Method |')
    lines.push('|------|------:|--------:|-----------:|----------:|--------|')
    const byTool = new Map<
      string,
      {
        calls: number
        fetched: number
        referenced: number
        ratioSum: number
        ratioCount: number
        method: string
      }
    >()
    for (const r of retrievalRelevance) {
      const e = byTool.get(r.tool) ?? {
        calls: 0,
        fetched: 0,
        referenced: 0,
        ratioSum: 0,
        ratioCount: 0,
        method: r.scoringMethod,
      }
      e.calls++
      e.fetched += r.fetchedTokens
      e.referenced += r.referencedTokens ?? 0
      if (r.relevanceRatio !== null) {
        e.ratioSum += r.relevanceRatio
        e.ratioCount++
      }
      byTool.set(r.tool, e)
    }
    for (const [tool, s] of byTool.entries()) {
      const rel = s.ratioCount > 0 ? `${((s.ratioSum / s.ratioCount) * 100).toFixed(1)}%` : '—'
      lines.push(`| ${tool} | ${s.calls} | ${s.fetched} | ${s.referenced} | ${rel} | ${s.method} |`)
    }
    const totalFetched = retrievalRelevance.reduce((s, r) => s + r.fetchedTokens, 0)
    const totalReferenced = retrievalRelevance.reduce((s, r) => s + (r.referencedTokens ?? 0), 0)
    if (totalFetched > 0) {
      lines.push(
        `\n**Overall precision:** ${((totalReferenced / totalFetched) * 100).toFixed(1)}% (${totalReferenced} referenced / ${totalFetched} fetched)`
      )
    }
    lines.push('')
  }

  if (toolLatency.length > 0) {
    lines.push('## Tool Latency Distribution\n')
    lines.push('| Tool | Calls | Avg | p50 | p95 | Max |')
    lines.push('|------|------:|----:|----:|----:|----:|')
    const byCallId = new Map<string, { tool: string; total: number }>()
    for (const l of toolLatency) {
      const e = byCallId.get(l.toolCallId) ?? { tool: l.toolCallId, total: 0 }
      e.total += l.durationMs
      byCallId.set(l.toolCallId, e)
    }
    const byTool2 = new Map<string, number[]>()
    for (const { tool, total } of byCallId.values()) {
      const arr = byTool2.get(tool) ?? []
      arr.push(total)
      byTool2.set(tool, arr)
    }
    for (const [tool, durations] of byTool2.entries()) {
      const sorted = [...durations].sort((a, b) => a - b)
      const avg2 = sorted.reduce((a, b) => a + b, 0) / sorted.length
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
      const max = Math.max(...sorted)
      lines.push(
        `| ${tool} | ${durations.length} | ${Math.round(avg2)}ms | ${Math.round(p50)}ms | ${Math.round(p95)}ms | ${Math.round(max)}ms |`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

function renderBenchmarkVisual(
  sessionId: string,
  chatParams: Awaited<ReturnType<typeof loadObserverChatParams>>,
  timing: Awaited<ReturnType<typeof loadObserverStreamingTiming>>,
  snapshots: Awaited<ReturnType<typeof loadObserverContextSnapshots>>,
  tokenEsts: Awaited<ReturnType<typeof loadObserverTokenEstimates>>,
  toolStats: Awaited<ReturnType<typeof loadToolCostStats>>,
  cacheStats: Awaited<ReturnType<typeof loadCacheEfficiencyStats>>,
  retrievalRelevance: ObserverRetrievalRelevance[] = [],
  toolLatency: ObserverToolLatencyBreakdown[] = []
): string {
  const useColor = process.stdout.isTTY !== false
  const colors = getColors()
  const dim = (s: string) => (useColor ? chalk.dim(s) : s)
  const bold = (s: string) => (useColor ? chalk.bold(s) : s)
  const divider = (len = 64) => (useColor ? colors.muted('─'.repeat(len)) : '─'.repeat(len))

  const lines: string[] = []
  lines.push(
    useColor
      ? `\n${colors.header.bold('TACO')} — Benchmark · ${sessionId.slice(0, 24)}\n`
      : `\nTACO — Benchmark · ${sessionId.slice(0, 24)}\n`
  )

  const firstParams = chatParams[0]
  if (firstParams) {
    lines.push(
      dim(
        `  Model: ${firstParams.modelId}  Context limit: ${firstParams.modelContextLimit ? formatTokens(firstParams.modelContextLimit) : '?'}`
      )
    )
    lines.push('')
  }

  if (toolStats.length > 0) {
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Tool Call Stats'))
    lines.push('')
    lines.push(
      dim(
        `    ${'Tool'.padEnd(38)} ${'Calls'.padStart(6)}  ${'Avg In'.padStart(8)}  ${'Avg Out'.padStart(8)}`
      )
    )
    for (const s of toolStats.slice(0, 15)) {
      const bar = '█'.repeat(
        Math.max(1, Math.round((s.callCount / (toolStats[0]?.callCount ?? 1)) * 15))
      )
      const avgIn = formatTokens(Math.round(s.avgInputTokens)).padStart(8)
      const avgOut = formatTokens(Math.round(s.avgOutputTokens)).padStart(8)
      lines.push(
        `    ${s.tool.padEnd(38)} ${String(s.callCount).padStart(6)}  ${avgIn}  ${avgOut}  ${useColor ? chalk.cyan(bar) : bar}`
      )
    }
  }

  if (cacheStats.length > 0) {
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Cache Efficiency'))
    lines.push('')
    for (const s of cacheStats) {
      const cR = `${(s.cacheReadPct * 100).toFixed(1)}%`
      const cW = `${(s.cacheWritePct * 100).toFixed(1)}%`
      const fr = `${(s.freshInputPct * 100).toFixed(1)}%`
      lines.push(`    ${s.modelId}`)
      lines.push(`      Cache read:  ${cR}  (${formatTokens(s.cacheReadTokens)})`)
      lines.push(`      Cache write: ${cW}`)
      lines.push(`      Fresh input: ${fr}  (${formatTokens(s.freshInputTokens)})`)
    }
  }

  if (snapshots.length > 0) {
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Context Window Utilization'))
    lines.push('')

    const peak = Math.max(...snapshots.map(s => s.contextUtilization ?? 0))
    const avg = snapshots.reduce((s, n) => s + (n.contextUtilization ?? 0), 0) / snapshots.length

    const WIDTH = 40
    const step = Math.max(1, Math.floor(snapshots.length / WIDTH))
    const vals = []
    for (let i = 0; i < WIDTH; i++) {
      const snap = snapshots[Math.min(i * step, snapshots.length - 1)]!
      vals.push(snap.contextUtilization ?? 0)
    }
    const maxVal = Math.max(...vals, 0.01)
    const HEIGHT = 6
    const rows: string[] = Array.from({ length: HEIGHT }, () => ' '.repeat(WIDTH))
    for (let col = 0; col < WIDTH; col++) {
      const h = Math.round((vals[col]! / maxVal) * HEIGHT)
      for (let row = HEIGHT - h; row < HEIGHT; row++) {
        rows[row] = rows[row]!.substring(0, col) + '█' + rows[row]!.substring(col + 1)
      }
    }

    for (let row = 0; row < HEIGHT; row++) {
      const pct = ((1 - row / HEIGHT) * maxVal * 100).toFixed(0)
      const bar = rows[row]!
      const colored = useColor ? chalk.cyan(bar) : bar
      lines.push(`    ${pct.padStart(4)}% │${colored}│`)
    }
    lines.push(`         └${'─'.repeat(WIDTH)}┘`)
    lines.push(`         Turn 1${' '.repeat(WIDTH - 14)}Turn ${snapshots.length}`)
    lines.push('')
    lines.push(
      `    Peak: ${(peak * 100).toFixed(1)}%  Avg: ${(avg * 100).toFixed(1)}%  Samples: ${snapshots.length}`
    )
  }

  const validTtft = timing
    .map(t => t.timeToFirstTokenMs)
    .filter((t): t is number => t !== null && t > 0)
  if (validTtft.length > 0) {
    validTtft.sort((a, b) => a - b)
    const avg = validTtft.reduce((a, b) => a + b, 0) / validTtft.length
    const median = validTtft[Math.floor(validTtft.length / 2)]!
    const p95 = validTtft[Math.floor(validTtft.length * 0.95)]!
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Streaming Performance'))
    lines.push('')
    lines.push(`    Avg TTFT:     ${(avg / 1000).toFixed(2)}s`)
    lines.push(`    Median TTFT:  ${(median / 1000).toFixed(2)}s`)
    lines.push(`    P95 TTFT:     ${(p95 / 1000).toFixed(2)}s`)
    lines.push(`    Sample:       ${validTtft.length} messages`)
  }

  const approaches = [...new Set(tokenEsts.map(e => e.approach))]
  if (approaches.length > 1 && approaches.includes('opencode')) {
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Token Estimation Accuracy vs opencode ground truth'))
    lines.push('')
    lines.push(
      dim(
        `    ${'Approach'.padEnd(20)} ${'Avg Error'.padStart(12)} ${'Max Error'.padStart(12)} ${'Samples'.padStart(8)}`
      )
    )

    const opencode = tokenEsts.filter(e => e.approach === 'opencode')
    const ocMap = new Map(opencode.map(e => [e.messageId, e.totalTokens]))

    for (const approach of approaches.filter(a => a !== 'opencode')) {
      const thisApproach = tokenEsts.filter(e => e.approach === approach)
      const errors = thisApproach
        .map(e => {
          const oc = ocMap.get(e.messageId)
          if (!oc || oc === 0) return null
          return Math.abs(((e.totalTokens ?? 0) - oc) / oc) * 100
        })
        .filter((e): e is number => e !== null)

      if (errors.length > 0) {
        const avgErr = errors.reduce((a, b) => a + b, 0) / errors.length
        const maxErr = Math.max(...errors)
        lines.push(
          `    ${approach.padEnd(20)} ${`±${avgErr.toFixed(1)}%`.padStart(12)} ${`±${maxErr.toFixed(1)}%`.padStart(12)} ${String(errors.length).padStart(8)}`
        )
      }
    }
  }

  if (retrievalRelevance.length > 0) {
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Retrieval Efficiency'))
    lines.push('')

    const byTool = new Map<
      string,
      {
        calls: number
        fetched: number
        referenced: number
        ratioSum: number
        ratioCount: number
        method: string
      }
    >()
    for (const r of retrievalRelevance) {
      const e = byTool.get(r.tool) ?? {
        calls: 0,
        fetched: 0,
        referenced: 0,
        ratioSum: 0,
        ratioCount: 0,
        method: r.scoringMethod,
      }
      e.calls++
      e.fetched += r.fetchedTokens
      e.referenced += r.referencedTokens ?? 0
      if (r.relevanceRatio !== null) {
        e.ratioSum += r.relevanceRatio
        e.ratioCount++
      }
      byTool.set(r.tool, e)
    }

    lines.push(
      dim(
        `    ${'Tool'.padEnd(22)}  ${'Calls'.padStart(5)}  ${'Fetched'.padStart(8)}  ${'Referenced'.padStart(10)}  ${'Relevance'.padStart(9)}`
      )
    )
    for (const [tool, s] of [...byTool.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
      const rel =
        s.ratioCount > 0
          ? `${((s.ratioSum / s.ratioCount) * 100).toFixed(1)}%`.padStart(9)
          : '        —'
      lines.push(
        `    ${tool.padEnd(22)}  ${String(s.calls).padStart(5)}  ${formatTokens(s.fetched).padStart(8)}  ${formatTokens(s.referenced).padStart(10)}  ${rel}`
      )
    }

    const totalFetched = retrievalRelevance.reduce((s, r) => s + r.fetchedTokens, 0)
    const totalReferenced = retrievalRelevance.reduce((s, r) => s + (r.referencedTokens ?? 0), 0)
    if (totalFetched > 0) {
      const precision = ((totalReferenced / totalFetched) * 100).toFixed(1)
      const callTotalsEff = new Map<string, number>()
      for (const l of toolLatency)
        callTotalsEff.set(l.toolCallId, (callTotalsEff.get(l.toolCallId) ?? 0) + l.durationMs)
      const avgQueryMs =
        callTotalsEff.size > 0
          ? [...callTotalsEff.values()].reduce((a, b) => a + b, 0) / callTotalsEff.size
          : null
      lines.push('')
      lines.push(
        dim(
          `    Overall precision: ${precision}%  (${formatTokens(totalReferenced)} referenced / ${formatTokens(totalFetched)} fetched)`
        )
      )
      if (avgQueryMs !== null && avgQueryMs > 0) {
        const effScore = ((totalReferenced / totalFetched) * (1000 / avgQueryMs)).toFixed(3)
        lines.push(dim(`    Efficiency score:  ${effScore}  (precision × 1/avg_query_ms)`))
      }
    }
  }

  if (toolLatency.length > 0) {
    lines.push('')
    lines.push('  ' + divider())
    lines.push('')
    lines.push(bold('  Tool Latency Distribution'))
    lines.push('')

    const byCallId2 = new Map<string, number>()
    for (const l of toolLatency)
      byCallId2.set(l.toolCallId, (byCallId2.get(l.toolCallId) ?? 0) + l.durationMs)
    const byTool2 = new Map<string, number[]>()
    for (const [callId, total] of byCallId2.entries()) {
      const tool = callId
      const arr = byTool2.get(tool) ?? []
      arr.push(total)
      byTool2.set(tool, arr)
    }

    const allDurations = [...byCallId2.values()].sort((a, b) => a - b)
    const avgAll = allDurations.reduce((a, b) => a + b, 0) / allDurations.length
    const p50All = allDurations[Math.floor(allDurations.length * 0.5)] ?? 0
    const p95All = allDurations[Math.floor(allDurations.length * 0.95)] ?? 0
    lines.push(`    All tool calls:  ${allDurations.length}`)
    lines.push(`    Avg:             ${Math.round(avgAll)}ms`)
    lines.push(`    p50:             ${Math.round(p50All)}ms`)
    lines.push(`    p95:             ${Math.round(p95All)}ms`)

    const starts = timing.map(t => t.requestSent).filter((t): t is number => t !== null)
    const ends = timing.map(t => t.messageCompleted).filter((t): t is number => t !== null)
    if (starts.length > 0 && ends.length > 0) {
      const wallMs = Math.max(...ends) - Math.min(...starts)
      lines.push(`    Session wall-clock: ${(wallMs / 1000).toFixed(1)}s`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
