import type { Command } from 'commander'
import { getDbAsync } from '../../data/db.js'
import { loadUsageEvents, loadSessions } from '../../data/queries.js'
import { buildFilters } from '../../utils/dates.js'
import { computeOverview, computeModelStats, computeProviderStats, computeSessionStats } from '../../aggregator/index.js'
import { getConfig } from '../../config/index.js'
import { renderModelPanels } from '../../viz/chart.js'
import { getColors } from '../../theme/index.js'

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

        let activeTab = 0
        const tabs = ['Overview', 'Models', 'Providers', 'Sessions']
        let modelsScrollOffset = 0
        const MODELS_PER_PAGE = 3

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

        function renderCompactModel(model: any, index: number) {
          const percentage = (model.percentage * 100).toFixed(1)
          const color = [COLORS.info, COLORS.highlight, COLORS.warning, COLORS.label][index % 4]

          let content = `${index + 1}. ${color.bold(model.modelId)} ${COLORS.muted(`(${model.providerId})`)} ${COLORS.highlight(percentage + '%')}\n`
          content += `   ${COLORS.label('Tokens:')} ${formatTokens(model.tokens.total)} | `
          content += `${COLORS.label('Cost:')} $${model.cost.toFixed(2)} | `
          content += `${COLORS.label('Msgs:')} ${model.messageCount}\n`
          return content
        }

        function renderContent(uiWidth: number) {
          let content = ''

          if (activeTab === 0) {
            modelsScrollOffset = 0
            content = `\n${COLORS.label.bold('Overview')}\n\n`

            content += `${COLORS.label('Total Tokens:')}     ${COLORS.highlight(formatTokens(overview.tokens.total))}\n`
            content += `${COLORS.label('Total Sessions:')}   ${COLORS.info(overview.sessionCount.toString())}\n`
            content += `${COLORS.label('Total Cost:')}       ${COLORS.warning('$' + overview.cost.toFixed(4))}\n`
            content += `${COLORS.label('Active Days:')}      ${overview.activedays}/${overview.totalDays}\n`
            content += `${COLORS.label('Current Streak:')}   ${overview.currentStreak} days\n\n`

            if (modelStats.length > 0) {
              const topModels = modelStats.slice(0, 3).map(m => ({
                name: m.modelId.split('/').pop() || m.modelId,
                value: `${(m.percentage * 100).toFixed(1)}%`,
                detail: `(${formatTokens(m.tokens.total)})`,
              }))
              content += renderTop3Section('Top Models', topModels) + '\n'
            }

            if (providerStats.length > 0) {
              const topProviders = providerStats.slice(0, 3).map(p => ({
                name: p.providerId,
                value: `${(p.percentage * 100).toFixed(1)}%`,
                detail: `($${p.cost.toFixed(2)})`,
              }))
              content += renderTop3Section('Top Providers', topProviders) + '\n'
            }

            if (sessions.length > 0) {
              const topSessions = sessions.slice(0, 3).map(s => ({
                name: (s.title || s.id.substring(0, 8)).substring(0, 25),
                value: new Date(s.timeCreated).toLocaleDateString(),
              }))
              content += renderTop3Section('Recent Sessions', topSessions) + '\n'
            }

            content += `${COLORS.label.bold('Token Breakdown:')}\n`
            content += `  ${COLORS.muted('Input:')}      ${formatTokens(overview.tokens.input)}\n`
            content += `  ${COLORS.muted('Output:')}     ${formatTokens(overview.tokens.output)}\n`
            content += `  ${COLORS.muted('Cache Read:')} ${formatTokens(overview.tokens.cacheRead)}\n`
            content += `  ${COLORS.muted('Cache Write:')}${formatTokens(overview.tokens.cacheWrite)}\n`
            content += `  ${COLORS.muted('Reasoning:')}  ${formatTokens(overview.tokens.reasoning)}\n`
          } else if (activeTab === 1) {
            if (modelStats.length === 0) {
              content = `\n${COLORS.label.bold('Models')}\n\nNo model data available.\n`
              modelsScrollOffset = 0
            } else {
              content = `\n${COLORS.label.bold('Models')} ${COLORS.muted(`(showing ${Math.min(modelsScrollOffset + 1, modelStats.length)}-${Math.min(modelsScrollOffset + MODELS_PER_PAGE, modelStats.length)} of ${modelStats.length})`)}\n`
              content += COLORS.muted('Use ↑/↓ arrows to scroll through models\n\n')

              const visibleModels = modelStats.slice(
                modelsScrollOffset,
                modelsScrollOffset + MODELS_PER_PAGE
              )
              // Use compact text view when the terminal is too narrow for charts.
              // Charts need at least 100 columns to be readable.
              const useCompactView = (process.stdout.columns || 80) < 100

              if (useCompactView) {
                visibleModels.forEach((m, i) => {
                  content += renderCompactModel(m, modelsScrollOffset + i) + '\n'
                })
              } else {
                const panelLines = renderModelPanels(visibleModels, uiWidth, 4, true)
                content += panelLines.join('\n')
              }

              if (modelStats.length > MODELS_PER_PAGE) {
                content +=
                  '\n' +
                  COLORS.muted(
                    `${modelsScrollOffset > 0 ? '◀ ' : ''}${modelsScrollOffset + 1}-${Math.min(modelsScrollOffset + MODELS_PER_PAGE, modelStats.length)}${modelsScrollOffset + MODELS_PER_PAGE < modelStats.length ? ' ▶' : ''}`
                  ) +
                  '\n'
              }
            }
          } else if (activeTab === 2) {
            modelsScrollOffset = 0
            content = `\n${COLORS.label.bold('Providers')}\n\n`

            if (providerStats.length === 0) {
              content += 'No provider data available.\n'
            } else {
              const maxTokens = providerStats[0]?.tokens.total || 1
              // Fixed cols: "N. "(3) + tokens(8) + " (XX.X%)"(9) + " $COST"(8) + gaps(6) = ~34
              // Remaining space split between name col and bar col.
              // Name col: up to 20 chars, the rest goes to bar (capped at 20).
              const nameWidth = Math.max(8, Math.min(20, Math.floor((uiWidth - 34) * 0.55)))
              const maxBarLen = Math.max(1, Math.min(20, uiWidth - 34 - nameWidth))

              providerStats.forEach((p, i) => {
                const percentage = (p.percentage * 100).toFixed(1)
                const barLength = Math.min(
                  maxBarLen,
                  Math.floor((p.tokens.total / maxTokens) * maxBarLen)
                )
                const bar = '█'.repeat(barLength)
                const num = COLORS.highlight(`${i + 1}.`)
                // Truncate name to nameWidth so it never pushes subsequent columns right
                const name =
                  p.providerId.length > nameWidth
                    ? p.providerId.slice(0, nameWidth - 1) + '…'
                    : p.providerId.padEnd(nameWidth)
                content += `${num} ${COLORS.value(name)} ${COLORS.info(bar)} ${COLORS.highlight(formatTokens(p.tokens.total))} ${COLORS.muted(`(${percentage}%)`)} ${COLORS.warning(`$${p.cost.toFixed(2)}`)}\n`
              })
            }
          } else if (activeTab === 3) {
            modelsScrollOffset = 0
            const shown = sessionStats.slice(0, 20)

            if (shown.length === 0) {
              content = `\n${COLORS.label.bold('Recent Sessions')}\n\nNo session data available.\n`
            } else {
              content = `\n${COLORS.label.bold('Recent Sessions')}\n\n`

              // Compute column widths based on terminal
              // Row format: "NN. TITLE... DATE   TOK    COST    DUR    MODEL"
              // Fixed: num(4) date(10) tok(7) cost(7) dur(7) model(18) gaps(10) = 63
              const titleCol = Math.max(10, uiWidth - 65)

              shown.forEach((s, i) => {
                const title = (s.title ?? s.sessionId.substring(0, 8))
                  .padEnd(titleCol)
                  .substring(0, titleCol)
                const date = new Date(s.timeCreated).toLocaleDateString('en-CA') // YYYY-MM-DD
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
            renderContent(contentWidth),
            COLORS.border('─'.repeat(dividerWidth)),
            COLORS.muted(
              'Click tabs or press 1-4 to switch | q to quit' +
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

          // Arrow keys for scrolling in models tab
          if (activeTab === 1 && code === 27 && str.length >= 3 && str.charCodeAt(1) === 91) {
            const arrowCode = str.charCodeAt(2)
            if (arrowCode === 65 && modelsScrollOffset > 0) {
              // Up
              modelsScrollOffset--
              render()
              return
            } else if (
              arrowCode === 66 &&
              modelsScrollOffset + MODELS_PER_PAGE < modelStats.length
            ) {
              // Down
              modelsScrollOffset++
              render()
              return
            }
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
