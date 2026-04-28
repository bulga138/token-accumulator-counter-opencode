import type {
  OverviewStats,
  ModelStats,
  ProviderStats,
  AgentStats,
  DailyStats,
  ProjectStats,
  SessionStats,
  PeriodStats,
} from '../data/types.js'
import {
  formatTokens,
  formatCost,
  formatEstimatedCost,
  formatPercent,
} from '../utils/formatting.js'
import { formatDuration } from '../utils/dates.js'
import type { GatewayMetrics } from '../data/gateway-types.js'

export function formatOverviewMarkdown(
  stats: OverviewStats,
  label: string,
  gateway?: GatewayMetrics | null
): string {
  const lines: string[] = [
    `# TACO Usage Overview${label ? ` · ${label}` : ''}`,
    '',
    '## Activity Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Sessions** | ${stats.sessionCount} |`,
    `| **Messages** | ${stats.messageCount} |`,
    `| **Active Days** | ${stats.activedays}/${stats.totalDays} (${Math.round((stats.activedays / stats.totalDays) * 100)}%) |`,
    `| **Current Streak** | ${stats.currentStreak} days |`,
    `| **Longest Streak** | ${stats.longestStreak} days |`,
    '',
    '## Cost & Tokens',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Total Cost (local)** | ${formatCost(stats.cost)} |`,
    `| **Avg Cost/Day** | $${(stats.cost / Math.max(stats.activedays, 1)).toFixed(2)} |`,
    `| **Total Tokens** | ${formatTokens(stats.tokens.total)} |`,
    `| **Input Tokens** | ${formatTokens(stats.tokens.input)} |`,
    `| **Output Tokens** | ${formatTokens(stats.tokens.output)} |`,
    `| **Cache Read** | ${formatTokens(stats.tokens.cacheRead)} |`,
    `| **Cache Write** | ${formatTokens(stats.tokens.cacheWrite)} |`,
    `| **Cache Efficiency** | ${Math.round((stats.tokens.cacheRead / Math.max(stats.tokens.total, 1)) * 100)}% |`,
    '',
    '## Model & Session Info',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Favorite Model** | ${stats.favoriteModel ?? '—'} |`,
    `| **Longest Session** | ${formatDuration(stats.longestSessionMs)} |`,
    `| **Avg Messages/Session** | ${Math.round(stats.messageCount / Math.max(stats.sessionCount, 1))} |`,
    '',
  ]

  // Gateway comparison section
  if (gateway) {
    const resetStr = gateway.budgetResetAt
      ? new Date(gateway.budgetResetAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
      : '—'
    const budgetPct =
      gateway.budgetLimit !== null
        ? ` (${((gateway.totalSpend / gateway.budgetLimit) * 100).toFixed(1)}%)`
        : ''
    const localDiff = stats.cost - gateway.totalSpend
    const diffStr =
      localDiff >= 0
        ? `+${formatCost(localDiff)} vs gateway`
        : `${formatCost(localDiff)} vs gateway`

    lines.push(
      '## Gateway Comparison',
      '',
      '> Cost data from the configured API gateway (actual billing figures).',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| **Gateway Spend** | ${formatCost(gateway.totalSpend)} |`
    )
    if (gateway.budgetLimit !== null) {
      lines.push(`| **Budget** | ${formatCost(gateway.budgetLimit)}${budgetPct} |`)
    }
    if (gateway.teamSpend !== null) {
      const teamLabel = gateway.teamName ? `Team Spend (${gateway.teamName})` : 'Team Spend'
      lines.push(`| **${teamLabel}** | ${formatCost(gateway.teamSpend)} |`)
    }
    if (gateway.teamBudgetLimit !== null && gateway.teamSpend !== null) {
      const teamPct = `${((gateway.teamSpend / gateway.teamBudgetLimit) * 100).toFixed(1)}%`
      lines.push(`| **Team Budget** | ${formatCost(gateway.teamBudgetLimit)} (${teamPct} used) |`)
    }
    lines.push(
      `| **Budget Resets** | ${resetStr} |`,
      `| **Local vs Gateway** | ${diffStr} |`,
      `| **Data Source** | ${gateway.endpoint} |`,
      `| **Freshness** | ${gateway.cached ? 'cached' : 'live'} |`,
      ''
    )
  }

  return lines.join('\n')
}

export function formatModelsMarkdown(models: ModelStats[], label: string): string {
  const lines: string[] = [
    `# 🌮 TACO — Models${label ? ` · ${label}` : ''}`,
    '',
    '| Model | Tokens | Input | Output | Cost | Share |',
    '|-------|--------|-------|--------|------|-------|',
  ]
  for (const m of models) {
    const costStr = m.costEstimated ? formatEstimatedCost(m.cost) : formatCost(m.cost)
    lines.push(
      `| ${m.modelId} | ${formatTokens(m.tokens.total)} | ${formatTokens(m.tokens.input)} | ${formatTokens(m.tokens.output)} | ${costStr} | ${formatPercent(m.percentage)} |`
    )
  }
  lines.push('')
  if (models.some(m => m.costEstimated)) {
    lines.push('> `~$` values are estimated from `opencode.json` pricing (OpenCode recorded $0).')
    lines.push('')
  }
  return lines.join('\n')
}

export function formatProviderMarkdown(providers: ProviderStats[], label: string): string {
  const lines: string[] = [
    `# 🌮 TACO — Providers${label ? ` · ${label}` : ''}`,
    '',
    '| Provider | Tokens | Cost | Share |',
    '|----------|--------|------|-------|',
  ]
  for (const p of providers) {
    lines.push(
      `| ${p.providerId} | ${formatTokens(p.tokens.total)} | ${formatCost(p.cost)} | ${formatPercent(p.percentage)} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function formatDailyMarkdown(daily: DailyStats[], label: string): string {
  const lines: string[] = [
    `# 🌮 TACO — Daily${label ? ` · ${label}` : ''}`,
    '',
    '| Date | Sessions | Messages | Tokens | Cost |',
    '|------|----------|----------|--------|------|',
  ]
  for (const d of daily) {
    lines.push(
      `| ${d.date} | ${d.sessionCount} | ${d.messageCount} | ${formatTokens(d.tokens.total)} | ${formatCost(d.cost)} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function formatProjectsMarkdown(
  projects: ProjectStats[],
  label: string,
  hasGateway = false
): string {
  const costHeader = hasGateway ? 'Local $' : 'Cost'
  const lines: string[] = [
    `# 🌮 TACO — Projects${label ? ` · ${label}` : ''}`,
    '',
    `| Project | Sessions | Messages | Tokens | ${costHeader} |`,
    `|---------|----------|----------|--------|${'-'.repeat(costHeader.length + 2)}|`,
  ]
  for (const p of projects) {
    lines.push(
      `| ${p.directory} | ${p.sessionCount} | ${p.messageCount} | ${formatTokens(p.tokens.total)} | ${formatCost(p.cost)} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function formatSessionsMarkdown(
  sessions: SessionStats[],
  label: string,
  hasGateway = false,
  relevanceMap?: Map<string, number>
): string {
  const costHeader = hasGateway ? 'Local $' : 'Cost'
  const hasRelevance = relevanceMap !== undefined && relevanceMap.size > 0
  const relHeader = hasRelevance ? ' Relevance |' : ''
  const relSep = hasRelevance ? '----------:|' : ''
  const lines: string[] = [
    `# 🌮 TACO — Sessions${label ? ` · ${label}` : ''}`,
    '',
    `| Title | Created | Messages | Tokens | ${costHeader} | Duration |${relHeader}`,
    `|-------|---------|----------|--------|${'-'.repeat(costHeader.length + 2)}|----------|${relSep}`,
  ]
  for (const s of sessions) {
    const relCell = hasRelevance
      ? ` ${relevanceMap!.get(s.sessionId) !== undefined ? `${(relevanceMap!.get(s.sessionId)! * 100).toFixed(1)}%` : '—'} |`
      : ''
    lines.push(
      `| ${s.title ?? s.sessionId} | ${new Date(s.timeCreated).toLocaleDateString()} | ${s.messageCount} | ${formatTokens(s.tokens.total)} | ${formatCost(s.cost)} | ${s.durationMs ? formatDuration(s.durationMs) : '—'} |${relCell}`
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function formatAgentsMarkdown(
  agents: AgentStats[],
  label: string,
  hasGateway = false
): string {
  const costHeader = hasGateway ? 'Local $' : 'Cost'
  const lines: string[] = [
    `# 🌮 TACO — Agents${label ? ` · ${label}` : ''}`,
    '',
    `| Agent | Messages | Tokens | ${costHeader} | Share |`,
    `|-------|----------|--------|${'-'.repeat(costHeader.length + 2)}|-------|`,
  ]
  for (const a of agents) {
    lines.push(
      `| ${a.agent} | ${a.messageCount} | ${formatTokens(a.tokens.total)} | ${formatCost(a.cost)} | ${formatPercent(a.percentage)} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function formatTrendsMarkdown(
  trends: PeriodStats[],
  period: string,
  label: string,
  hasGateway = false
): string {
  const costHeader = hasGateway ? 'Local $' : 'Cost'
  const deltaCostHeader = hasGateway ? 'Δ Local $' : 'Δ Cost'
  const lines: string[] = [
    `# 🌮 TACO — Trends · ${period}${label ? ` · ${label}` : ''}`,
    '',
    `| Period | Sessions | Messages | Tokens | ${costHeader} | ${deltaCostHeader} |`,
    `|--------|----------|----------|--------|${'-'.repeat(costHeader.length + 2)}|${'-'.repeat(deltaCostHeader.length + 2)}|`,
  ]
  for (const t of trends) {
    const delta =
      t.deltaPercent !== null
        ? `${t.deltaPercent >= 0 ? '+' : ''}${(t.deltaPercent * 100).toFixed(1)}%`
        : '—'
    lines.push(
      `| ${t.label} | ${t.sessionCount} | ${t.messageCount} | ${formatTokens(t.tokens.total)} | ${formatCost(t.cost)} | ${delta} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}
