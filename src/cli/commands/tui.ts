import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents, loadSessions } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import {
  computeOverview,
  computeModelStats,
  computeProviderStats,
  computeSessionStats,
} from '../../aggregator/index.js'
import { getConfig } from '../../config/index.js'
import { renderModelPanels } from '../../viz/chart.js'
import { getColors } from '../../theme/index.js'
import { fetchGatewayMetrics } from '../../data/gateway.js'
import { fetchModelSpend, getCurrentBillingPeriod } from '../../data/gateway-litellm.js'
import { aggregateModelSpend, normalizeModelName } from '../../utils/model-names.js'
import type { GatewayMetrics } from '../../data/gateway-types.js'

/** Strip ANSI escape codes so we can measure the visible width of a string. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}

/** Truncate a styled string so its visible width does not exceed maxWidth. */
function clampLine(str: string, maxWidth: number): string {
  const visible = stripAnsi(str)
  if (visible.length <= maxWidth) return str
  // We can't cut into the raw string safely (ANSI codes span multiple chars),
  // so rebuild it: collect visible chars up to maxWidth-1, then append '…'.
  // Simple approach: cut the raw string at the proportion and append reset+ellipsis.
  const ratio = (maxWidth - 1) / visible.length
  const cutAt = Math.floor(str.length * ratio)
  return str.slice(0, cutAt) + '\x1B[0m…'
}

function formatTokens(t: number): string {
  if (t >= 1_000_000_000) return `${(t / 1_000_000_000).toFixed(2)}B`
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(2)}M`
  if (t >= 1_000) return `${(t / 1_000).toFixed(2)}K`
  return t.toString()
}

function formatDur(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

export function registerTuiCommand(program: Command): void {
  program
    .command('tui')
    .description('Interactive TUI dashboard')
    .action(async () => {
      try {
        const COLORS = getColors()
        const config = getConfig()
        const filters = buildFilters({})
        const db = await getDbAsync(config.db)

        const events = loadUsageEvents(db, filters)
        const sessions = loadSessions(db, filters)
        const overview = computeOverview(events, sessions)
        const modelStats = computeModelStats(events)
        const providerStats = computeProviderStats(events)
        const sessionStats = computeSessionStats(events, sessions)

        // Fetch gateway metrics in the background (non-blocking).
        // renderReady gates re-render calls so they only fire after the first
        // synchronous render() has been called.
        let gatewayMetrics: GatewayMetrics | null = null
        let gatewayModelSpend: Map<string, number> | null = null
        let renderReady = false

        if (config.gateway) {
          fetchGatewayMetrics(config.gateway)
            .then(m => {
              gatewayMetrics = m
              if (renderReady) render()
            })
            .catch(() => {
              /* non-fatal */
            })

          // Fetch per-model spend for the Models tab
          const { startDate, endDate } = getCurrentBillingPeriod()
          fetchModelSpend(config.gateway, startDate, endDate)
            .then(result => {
              if (result && result.modelSpend.length > 0) {
                const rawMap: Record<string, number> = {}
                for (const { model, spend } of result.modelSpend) {
                  rawMap[model] = (rawMap[model] ?? 0) + spend
                }
                gatewayModelSpend = aggregateModelSpend(rawMap)
                if (renderReady) render()
              }
            })
            .catch(() => {
              /* non-fatal */
            })
        }

        let activeTab = 0
        const tabs = ['Overview', 'Models', 'Providers', 'Sessions']
        let modelsScrollOffset = 0

        // Chrome lines that are always rendered regardless of tab content:
        //   header, blank, tab bar, top divider, bottom divider, footer = 6
        const CHROME_LINES = 6

        /** Compute how many model panels fit in the current terminal. */
        function currentModelsPerPage(): number {
          const rows = process.stdout.rows || 24
          const availableRows = Math.max(4, rows - CHROME_LINES)
          const useCompact = (process.stdout.columns || 80) < 100
          const modelsChrome = 7
          const linesPerModel = useCompact ? 3 : 9
          return Math.max(1, Math.floor((availableRows - modelsChrome) / linesPerModel))
        }

        // Check if running in a TTY before enabling raw mode
        if (!process.stdin.isTTY) {
          console.error('Error: TUI requires an interactive terminal (TTY).')
          console.error('Try running: taco overview')
          process.exit(1)
        }

        // Enable raw mode for keyboard input
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.setEncoding('utf8')

        // Enter the alternate screen buffer.
        // This is the same approach used by vim, htop, less, etc.: we own a
        // separate screen surface and the original terminal content is preserved
        // behind it.  On exit we restore the original buffer, giving the user
        // back exactly what they had before running taco.
        //
        // This completely eliminates the "cursor-up N lines" counting problem
        // that caused the "eating lines" bug when navigating with 1-4:
        // instead of trying to move the cursor by exactly the right number of
        // visual rows (which breaks whenever a line wraps), we simply home the
        // cursor to (0,0) and clear the screen on every render.
        process.stdout.write('\x1B[?1049h') // enter alternate screen
        process.stdout.write('\x1B[?25l') // hide cursor while painting

        // Enable mouse tracking
        process.stdout.write('\x1B[?1000h\x1B[?1002h\x1B[?1005h')

        function clearScreen() {
          // Home the cursor then erase the full screen.  Because we are on the
          // alternate screen buffer there is nothing above (0,0) to disturb —
          // no shell history, no previous taco output, nothing.
          process.stdout.write('\x1B[H\x1B[2J')
        }

        function renderTabs() {
          let tabLine = '  '
          tabs.forEach((tab, i) => {
            if (i === activeTab) {
              tabLine += COLORS.activeTab.bold(` ${tab} `)
            } else {
              tabLine += COLORS.inactiveTab(` ${tab} `)
            }
            tabLine += '  '
          })
          return tabLine
        }

        function renderTop3Section(
          title: string,
          items: Array<{ name: string; value: string; detail?: string }>
        ) {
          let content = `${COLORS.label.bold(`${title}:`)}\n`
          items.forEach((item, i) => {
            const num = COLORS.highlight(`${i + 1}.`)
            const detail = item.detail ? ` ${COLORS.muted(item.detail)}` : ''
            content += `  ${num} ${COLORS.value(item.name)} ${COLORS.highlight(item.value)}${detail}\n`
          })
          return content
        }

        function renderCompactModel(
          model: any,
          index: number,
          gwSpend: Map<string, number> | null
        ) {
          const percentage = (model.percentage * 100).toFixed(1)
          const color = [COLORS.info, COLORS.highlight, COLORS.warning, COLORS.label][index % 4]

          // Look up gateway spend for this model
          let gwCostStr = ''
          if (gwSpend) {
            const normalized = normalizeModelName(model.modelId)
            let gwCost: number | undefined = gwSpend.get(normalized)
            if (gwCost === undefined) {
              for (const [key, val] of gwSpend) {
                const nk = normalizeModelName(key)
                if (nk === normalized || nk.startsWith(normalized) || normalized.startsWith(nk)) {
                  gwCost = (gwCost ?? 0) + val
                }
              }
            }
            if (gwCost !== undefined) {
              gwCostStr = ` | ${COLORS.label('GW:')} ${COLORS.info('$' + gwCost.toFixed(2))}`
            }
          }

          let content = `${index + 1}. ${color.bold(model.modelId)} ${COLORS.muted(`(${model.providerId})`)} ${COLORS.highlight(percentage + '%')}\n`
          const costLabel = gwSpend ? 'Local $:' : 'Cost:'
          content += `   ${COLORS.label('Tokens:')} ${formatTokens(model.tokens.total)} | `
          content += `${COLORS.label(costLabel)} $${model.cost.toFixed(2)}${gwCostStr} | `
          content += `${COLORS.label('Msgs:')} ${model.messageCount}\n`
          return content
        }

        function renderContent(uiWidth: number, availableRows: number) {
          let content = ''

          if (activeTab === 0) {
            modelsScrollOffset = 0

            // ── Overview tab — height-aware section trimming ──────────────────
            // Build sections in priority order (highest priority = kept longest).
            // When the terminal is short we drop lowest-priority sections first.

            // KV block — always shown (core data), ~8-9 lines
            let kvBlock = `\n${COLORS.label.bold('Overview')}\n\n`
            kvBlock += `${COLORS.label('Total Tokens:')}     ${COLORS.highlight(formatTokens(overview.tokens.total))}\n`
            kvBlock += `${COLORS.label('Total Sessions:')}   ${COLORS.info(overview.sessionCount.toString())}\n`
            kvBlock += `${COLORS.label(config.gateway ? 'Local Cost:' : 'Total Cost:')}       ${COLORS.warning('$' + overview.cost.toFixed(4))}\n`
            if (gatewayMetrics) {
              const diff = overview.cost - gatewayMetrics.totalSpend
              const diffStr =
                diff >= 0
                  ? COLORS.muted(`  (+$${diff.toFixed(2)} vs gateway)`)
                  : COLORS.muted(`  (-$${Math.abs(diff).toFixed(2)} vs gateway)`)
              kvBlock += `${COLORS.label('Gateway Cost:')}     ${COLORS.info('$' + gatewayMetrics.totalSpend.toFixed(4))}${diffStr}\n`
            }
            kvBlock += `${COLORS.label('Active Days:')}      ${overview.activedays}/${overview.totalDays}\n`
            kvBlock += `${COLORS.label('Current Streak:')}   ${overview.currentStreak} days\n\n`

            // Top Models section — priority 3 (drop fourth)
            let topModelsBlock = ''
            if (modelStats.length > 0) {
              const topModels = modelStats.slice(0, 3).map(m => ({
                name: m.modelId.split('/').pop() || m.modelId,
                value: `${(m.percentage * 100).toFixed(1)}%`,
                detail: `(${formatTokens(m.tokens.total)})`,
              }))
              topModelsBlock = renderTop3Section('Top Models', topModels) + '\n'
            }

            // Top Providers section — priority 2 (drop third)
            let topProvidersBlock = ''
            if (providerStats.length > 0) {
              const topProviders = providerStats.slice(0, 3).map(p => {
                let detail: string
                if (gatewayMetrics && p.cost > 0 && p.cost >= overview.cost * 0.5) {
                  detail = `(local $${p.cost.toFixed(2)} | gw $${gatewayMetrics.totalSpend.toFixed(2)})`
                } else {
                  detail = `($${p.cost.toFixed(2)})`
                }
                return { name: p.providerId, value: `${(p.percentage * 100).toFixed(1)}%`, detail }
              })
              topProvidersBlock = renderTop3Section('Top Providers', topProviders) + '\n'
            }

            // Recent Sessions section — priority 1 (drop second)
            let topSessionsBlock = ''
            if (sessionStats.length > 0) {
              const topSessions = sessionStats.slice(0, 3).map(s => ({
                name: (s.title || s.sessionId.substring(0, 8)).substring(0, 25),
                value: new Date(s.timeCreated).toLocaleDateString(),
              }))
              topSessionsBlock = renderTop3Section('Recent Sessions', topSessions) + '\n'
            }

            // Token Breakdown — priority 0 (drop first)
            const breakdownBlock =
              `${COLORS.label.bold('Token Breakdown:')}\n` +
              `  ${COLORS.muted('Input:')}      ${formatTokens(overview.tokens.input)}\n` +
              `  ${COLORS.muted('Output:')}     ${formatTokens(overview.tokens.output)}\n` +
              `  ${COLORS.muted('Cache Read:')} ${formatTokens(overview.tokens.cacheRead)}\n` +
              `  ${COLORS.muted('Cache Write:')}${formatTokens(overview.tokens.cacheWrite)}\n` +
              `  ${COLORS.muted('Reasoning:')}  ${formatTokens(overview.tokens.reasoning)}\n`

            // Gateway Spend section (only if configured)
            let gatewayBlock = ''
            if (config.gateway) {
              if (gatewayMetrics) {
                const gw = gatewayMetrics
                const spendStr = `$${gw.totalSpend.toFixed(2)}`
                const budgetStr =
                  gw.budgetLimit !== null
                    ? ` / $${gw.budgetLimit.toFixed(2)}  (${((gw.totalSpend / gw.budgetLimit) * 100).toFixed(1)}%)`
                    : ''
                const cacheIndicator = gw.cached ? COLORS.muted(' cached') : COLORS.muted(' live')
                gatewayBlock += `\n${COLORS.label.bold('Gateway Spend:')}\n`
                gatewayBlock += `  ${COLORS.info(spendStr)}${COLORS.muted(budgetStr)}${cacheIndicator}\n`
                if (gw.teamSpend !== null) {
                  const teamStr = gw.teamName ? ` (${gw.teamName})` : ''
                  const teamBudget =
                    gw.teamBudgetLimit !== null
                      ? ` / $${gw.teamBudgetLimit.toFixed(2)}  (${((gw.teamSpend / gw.teamBudgetLimit) * 100).toFixed(1)}%)`
                      : ''
                  gatewayBlock += `  ${COLORS.muted('Team:')} $${gw.teamSpend.toFixed(2)}${COLORS.muted(teamBudget + teamStr)}\n`
                }
                const diff = overview.cost - gw.totalSpend
                const diffStr =
                  diff >= 0
                    ? `+$${diff.toFixed(2)} local vs gateway`
                    : `-$${Math.abs(diff).toFixed(2)} local vs gateway`
                gatewayBlock += `  ${COLORS.muted(diffStr)}\n`
              } else {
                gatewayBlock = `\n${COLORS.muted('Gateway: fetching…')}\n`
              }
            }

            // ── Fit sections to available height ─────────────────────────────
            // Sections from lowest priority (drop first) to highest (keep last):
            //   breakdownBlock, topSessionsBlock, topProvidersBlock, topModelsBlock, gatewayBlock, kvBlock
            // We accumulate sections greedily from the most important ones.
            const countLines = (s: string) => (s ? s.split('\n').length : 0)

            // Always include kvBlock — it's the minimum viable content.
            let usedLines = countLines(kvBlock)
            let showBreakdown = false
            let showTopModels = false
            let showTopProviders = false
            let showTopSessions = false
            let showGateway = false

            // Add sections in priority order, highest first
            if (usedLines + countLines(topModelsBlock) <= availableRows) {
              showTopModels = true
              usedLines += countLines(topModelsBlock)
            }
            if (usedLines + countLines(topProvidersBlock) <= availableRows) {
              showTopProviders = true
              usedLines += countLines(topProvidersBlock)
            }
            if (usedLines + countLines(topSessionsBlock) <= availableRows) {
              showTopSessions = true
              usedLines += countLines(topSessionsBlock)
            }
            if (usedLines + countLines(breakdownBlock) <= availableRows) {
              showBreakdown = true
              usedLines += countLines(breakdownBlock)
            }
            if (usedLines + countLines(gatewayBlock) <= availableRows) {
              showGateway = true
            }

            content = kvBlock
            if (showTopModels) content += topModelsBlock
            if (showTopProviders) content += topProvidersBlock
            if (showTopSessions) content += topSessionsBlock
            if (showBreakdown) content += breakdownBlock
            if (showGateway) content += gatewayBlock
          } else if (activeTab === 1) {
            // ── Models tab — dynamic MODELS_PER_PAGE ─────────────────────────
            // Chart mode: header(2) + scroll-hint(1) + blank(1) + per-panel ~9 lines + pagination(2)
            // Compact mode: header(2) + scroll-hint(1) + blank(1) + per-model 3 lines + blank(1) + pagination(2)
            const useCompactView = (process.stdout.columns || 80) < 100
            const modelsChrome = 7 // header + hint + blank + blank + pagination lines
            const linesPerModel = useCompactView ? 3 : 9
            const modelsPerPage = Math.max(
              1,
              Math.floor((availableRows - modelsChrome) / linesPerModel)
            )

            if (modelStats.length === 0) {
              content = `\n${COLORS.label.bold('Models')}\n\nNo model data available.\n`
              modelsScrollOffset = 0
            } else {
              // Clamp scroll offset to new page size
              modelsScrollOffset = Math.min(
                modelsScrollOffset,
                Math.max(0, modelStats.length - modelsPerPage)
              )
              content = `\n${COLORS.label.bold('Models')} ${COLORS.muted(`(showing ${Math.min(modelsScrollOffset + 1, modelStats.length)}-${Math.min(modelsScrollOffset + modelsPerPage, modelStats.length)} of ${modelStats.length})`)}\n`
              content += COLORS.muted('Use ↑/↓ arrows to scroll through models\n\n')

              const visibleModels = modelStats.slice(
                modelsScrollOffset,
                modelsScrollOffset + modelsPerPage
              )

              if (useCompactView) {
                visibleModels.forEach((m, i) => {
                  content += renderCompactModel(m, modelsScrollOffset + i, gatewayModelSpend) + '\n'
                })
              } else {
                const panelLines = renderModelPanels(
                  visibleModels,
                  uiWidth,
                  4,
                  true,
                  gatewayModelSpend
                )
                content += panelLines.join('\n')
              }

              if (modelStats.length > modelsPerPage) {
                content +=
                  '\n' +
                  COLORS.muted(
                    `${modelsScrollOffset > 0 ? '◀ ' : ''}${modelsScrollOffset + 1}-${Math.min(modelsScrollOffset + modelsPerPage, modelStats.length)}${modelsScrollOffset + modelsPerPage < modelStats.length ? ' ▶' : ''}`
                  ) +
                  '\n'
              }
            }
          } else if (activeTab === 2) {
            // ── Providers tab — cap rows to viewport ─────────────────────────
            modelsScrollOffset = 0
            content = `\n${COLORS.label.bold('Providers')}\n\n`

            if (providerStats.length === 0) {
              content += 'No provider data available.\n'
            } else {
              // availableRows minus header (3 lines already in content above)
              const maxProviders = Math.max(1, availableRows - 4)
              const visibleProviders = providerStats.slice(0, maxProviders)
              const maxTokens = visibleProviders[0]?.tokens.total || 1
              const nameWidth = Math.max(8, Math.min(20, Math.floor((uiWidth - 34) * 0.55)))
              const maxBarLen = Math.max(1, Math.min(20, uiWidth - 34 - nameWidth))

              visibleProviders.forEach((p, i) => {
                const percentage = (p.percentage * 100).toFixed(1)
                const barLength = Math.min(
                  maxBarLen,
                  Math.floor((p.tokens.total / maxTokens) * maxBarLen)
                )
                const bar = '█'.repeat(barLength)
                const num = COLORS.highlight(`${i + 1}.`)
                const name =
                  p.providerId.length > nameWidth
                    ? p.providerId.slice(0, nameWidth - 1) + '…'
                    : p.providerId.padEnd(nameWidth)
                let costDisplay = COLORS.warning(`$${p.cost.toFixed(2)}`)
                if (gatewayMetrics && p.cost > 0 && p.cost >= overview.cost * 0.5) {
                  costDisplay += COLORS.muted(` gw:$${gatewayMetrics.totalSpend.toFixed(2)}`)
                }
                content += `${num} ${COLORS.value(name)} ${COLORS.info(bar)} ${COLORS.highlight(formatTokens(p.tokens.total))} ${COLORS.muted(`(${percentage}%)`)} ${costDisplay}\n`
              })
            }
          } else if (activeTab === 3) {
            // ── Sessions tab — cap rows to viewport ──────────────────────────
            modelsScrollOffset = 0
            // availableRows minus header lines (3 in content) and a small buffer
            const maxSessions = Math.max(1, Math.min(20, availableRows - 4))
            const shown = sessionStats.slice(0, maxSessions)

            if (shown.length === 0) {
              content = `\n${COLORS.label.bold('Recent Sessions')}\n\nNo session data available.\n`
            } else {
              content = `\n${COLORS.label.bold('Recent Sessions')}\n\n`

              const titleCol = Math.max(10, uiWidth - 65)

              shown.forEach((s, i) => {
                const title = (s.title ?? s.sessionId.substring(0, 8))
                  .padEnd(titleCol)
                  .substring(0, titleCol)
                const date = new Date(s.timeCreated).toLocaleDateString('en-CA')
                const tok = formatTokens(s.tokens.total).padStart(6)
                const cost = `$${s.cost.toFixed(2)}`.padStart(6)
                const dur = s.durationMs != null ? formatDur(s.durationMs).padStart(6) : '     -'
                const model = (s.models[0] ?? '').substring(0, 18)
                const num = COLORS.highlight(`${(i + 1).toString().padStart(2)}.`)
                content +=
                  `${num} ${COLORS.value(title)} ` +
                  `${COLORS.muted(date)} ` +
                  `${COLORS.info(tok)} ` +
                  `${COLORS.warning(cost)} ` +
                  `${COLORS.muted(dur)} ` +
                  `${COLORS.muted(model)}\n`
              })
            }
          }

          return content
        }

        function render() {
          clearScreen()

          const cols = process.stdout.columns || 80
          const rows = process.stdout.rows || 24
          // availableRows is the space left for tab content after fixed chrome.
          const availableRows = Math.max(4, rows - CHROME_LINES)

          // Dividers are kept at ≤70 chars so they look tidy.
          const dividerWidth = Math.min(70, cols - 2)
          // Content grows with the terminal up to 100 cols — beyond that charts
          // and panels just become wastefully wide and sparse.  clampLine()
          // still acts as a safety net for any line that might exceed cols.
          const contentWidth = Math.min(100, Math.max(dividerWidth, cols - 4))

          const output = [
            COLORS.header.bold('🌮 TACO') + COLORS.label(' — Interactive Dashboard'),
            '',
            renderTabs(),
            COLORS.border('─'.repeat(dividerWidth)),
            renderContent(contentWidth, availableRows),
            COLORS.border('─'.repeat(dividerWidth)),
            COLORS.muted(
              '←/→ or Tab to switch tabs | 1-4 jump | q to quit' +
                (activeTab === 1 ? ' | ↑/↓ to scroll' : '')
            ),
          ].join('\n')

          // Clamp every line to the terminal width so nothing can wrap and
          // corrupt the alternate-screen layout on very narrow terminals.
          const safeOutput = output
            .split('\n')
            .map(line => clampLine(line, cols - 1))
            .join('\n')

          process.stdout.write(safeOutput + '\n')
        }

        render()
        renderReady = true

        // Handle input
        process.stdin.on('data', (key: Buffer) => {
          const str = key.toString()
          const code = str.charCodeAt(0)

          // Mouse events: \x1B[M followed by 3 bytes (button, x, y)
          if (
            str.length >= 6 &&
            str.charCodeAt(0) === 27 &&
            str.charCodeAt(1) === 91 &&
            str.charCodeAt(2) === 77
          ) {
            const button = str.charCodeAt(3) - 32
            const x = str.charCodeAt(4) - 32
            const y = str.charCodeAt(5) - 32

            // Left click on tabs (y === 2 is where the tabs are rendered)
            if (button === 0 && y <= 5) {
              // Tab positions based on actual rendered positions:
              // "  [ Overview ]  [ Models ]  [ Providers ]  [ Sessions ]"
              // 0123456789012345678901234567890123456789012345678901234
              // Overview: ~2-14, Models: ~14-26, Providers: ~26-40, Sessions: ~40-54
              if (x >= 2 && x < 14) {
                activeTab = 0
                render()
              } else if (x >= 14 && x < 26) {
                activeTab = 1
                render()
              } else if (x >= 26 && x < 40) {
                activeTab = 2
                render()
              } else if (x >= 40 && x < 54) {
                activeTab = 3
                render()
              }
            }
            return
          }

          // Arrow keys: Left/Right switch tabs; Up/Down scroll models tab
          if (code === 27 && str.length >= 3 && str.charCodeAt(1) === 91) {
            const arrowCode = str.charCodeAt(2)
            if (arrowCode === 67) {
              // Right arrow → next tab
              activeTab = (activeTab + 1) % tabs.length
              modelsScrollOffset = 0
              render()
              return
            } else if (arrowCode === 68) {
              // Left arrow → previous tab
              activeTab = (activeTab - 1 + tabs.length) % tabs.length
              modelsScrollOffset = 0
              render()
              return
            } else if (activeTab === 1) {
              if (arrowCode === 65 && modelsScrollOffset > 0) {
                // Up
                modelsScrollOffset--
                render()
                return
              } else if (
                arrowCode === 66 &&
                modelsScrollOffset + currentModelsPerPage() < modelStats.length
              ) {
                // Down
                modelsScrollOffset++
                render()
                return
              }
            }
          }

          // Tab / Shift+Tab to cycle through tabs
          if (str === '\t') {
            activeTab = (activeTab + 1) % tabs.length
            modelsScrollOffset = 0
            render()
            return
          }
          if (str === '\x1B[Z') {
            activeTab = (activeTab - 1 + tabs.length) % tabs.length
            modelsScrollOffset = 0
            render()
            return
          }

          // Regular keys
          if (str === 'q' || str === '\u0003' || str === '\u001b') {
            // Disable mouse tracking, show cursor, then leave the alternate
            // screen buffer — this restores the terminal to exactly the state
            // it was in before taco tui was started.
            process.stdout.write('\x1B[?1000l\x1B[?1002l\x1B[?1005l')
            process.stdout.write('\x1B[?25h') // show cursor
            process.stdout.write('\x1B[?1049l') // leave alternate screen
            process.exit(0)
          } else if (str === '1') {
            activeTab = 0
            render()
          } else if (str === '2') {
            activeTab = 1
            render()
          } else if (str === '3') {
            activeTab = 2
            render()
          } else if (str === '4') {
            activeTab = 3
            render()
          }
        })

        // Debounce resize events: many SIGWINCH fire while the user is dragging
        // the terminal corner.  With the alternate screen buffer a full repaint
        // is always correct, so we just wait for the resize storm to settle.
        let resizeTimer: ReturnType<typeof setTimeout> | null = null
        process.stdout.on('resize', () => {
          if (resizeTimer !== null) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(() => {
            resizeTimer = null
            render()
          }, 50)
        })
      } catch (err) {
        console.error('TUI Error:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    })
}
