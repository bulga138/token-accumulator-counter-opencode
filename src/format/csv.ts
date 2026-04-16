import { stringify } from 'csv-stringify/sync'
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

function csvStringify(data: object[]): string {
  return stringify(data, { header: true })
}

export function formatOverviewCsv(stats: OverviewStats): string {
  return csvStringify([
    {
      tokens_total: stats.tokens.total,
      tokens_input: stats.tokens.input,
      tokens_output: stats.tokens.output,
      tokens_cache_read: stats.tokens.cacheRead,
      tokens_cache_write: stats.tokens.cacheWrite,
      tokens_reasoning: stats.tokens.reasoning,
      cost_usd: stats.cost,
      session_count: stats.sessionCount,
      message_count: stats.messageCount,
      active_days: stats.activedays,
      total_days: stats.totalDays,
      favorite_model: stats.favoriteModel ?? '',
      current_streak: stats.currentStreak,
      longest_streak: stats.longestStreak,
      most_active_day: stats.mostActiveDay ?? '',
      longest_session_ms: stats.longestSessionMs,
      avg_cost_per_day: stats.avgCostPerDay,
    },
  ])
}

export function formatModelsCsv(models: ModelStats[]): string {
  return csvStringify(
    models.map(m => ({
      model_id: m.modelId,
      provider_id: m.providerId,
      tokens_total: m.tokens.total,
      tokens_input: m.tokens.input,
      tokens_output: m.tokens.output,
      tokens_cache_read: m.tokens.cacheRead,
      tokens_cache_write: m.tokens.cacheWrite,
      tokens_reasoning: m.tokens.reasoning,
      cost_usd: m.cost,
      message_count: m.messageCount,
      session_count: m.sessionCount,
      active_days: m.activeDays,
      percentage: m.percentage,
      median_output_tps: m.medianOutputTps,
    }))
  )
}

export function formatProvidersCsv(providers: ProviderStats[]): string {
  return csvStringify(
    providers.map(p => ({
      provider_id: p.providerId,
      tokens_total: p.tokens.total,
      tokens_input: p.tokens.input,
      tokens_output: p.tokens.output,
      cost_usd: p.cost,
      message_count: p.messageCount,
      session_count: p.sessionCount,
      active_days: p.activeDays,
      percentage: p.percentage,
    }))
  )
}

export function formatAgentsCsv(agents: AgentStats[]): string {
  return csvStringify(
    agents.map(a => ({
      agent: a.agent,
      tokens_total: a.tokens.total,
      tokens_input: a.tokens.input,
      tokens_output: a.tokens.output,
      cost_usd: a.cost,
      message_count: a.messageCount,
      session_count: a.sessionCount,
      percentage: a.percentage,
    }))
  )
}

export function formatDailyCsv(daily: DailyStats[]): string {
  return csvStringify(
    daily.map(d => ({
      date: d.date,
      tokens_total: d.tokens.total,
      tokens_input: d.tokens.input,
      tokens_output: d.tokens.output,
      cost_usd: d.cost,
      session_count: d.sessionCount,
      message_count: d.messageCount,
    }))
  )
}

export function formatProjectsCsv(projects: ProjectStats[]): string {
  return csvStringify(
    projects.map(p => ({
      directory: p.directory,
      tokens_total: p.tokens.total,
      tokens_input: p.tokens.input,
      tokens_output: p.tokens.output,
      cost_usd: p.cost,
      session_count: p.sessionCount,
      message_count: p.messageCount,
    }))
  )
}

export function formatSessionsCsv(sessions: SessionStats[]): string {
  return csvStringify(
    sessions.map(s => ({
      session_id: s.sessionId,
      title: s.title,
      directory: s.directory,
      time_created: new Date(s.timeCreated).toISOString(),
      tokens_total: s.tokens.total,
      tokens_input: s.tokens.input,
      tokens_output: s.tokens.output,
      cost_usd: s.cost,
      message_count: s.messageCount,
      duration_ms: s.durationMs,
      models: s.models.join('|'),
    }))
  )
}

export function formatTrendsCsv(trends: PeriodStats[]): string {
  return csvStringify(
    trends.map(t => ({
      label: t.label,
      start_date: t.startDate,
      end_date: t.endDate,
      tokens_total: t.tokens.total,
      cost_usd: t.cost,
      session_count: t.sessionCount,
      message_count: t.messageCount,
      delta_percent: t.deltaPercent,
    }))
  )
}
