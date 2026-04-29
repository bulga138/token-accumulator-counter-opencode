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
import type { HeatmapDay } from '../aggregator/index.js'
import type { GatewayMetrics } from '../data/gateway-types.js'

export function formatOverviewJson(
  stats: OverviewStats,
  _heatmap: HeatmapDay[],
  gateway?: GatewayMetrics | null
): string {
  const out: Record<string, unknown> = { ...stats }
  if (gateway !== undefined && gateway !== null) {
    out.gateway = gateway
  }
  return JSON.stringify(out, null, 2)
}

export function formatModelsJson(models: ModelStats[]): string {
  return JSON.stringify(models, null, 2)
}

export function formatProvidersJson(providers: ProviderStats[]): string {
  return JSON.stringify(providers, null, 2)
}

export function formatAgentsJson(agents: AgentStats[]): string {
  return JSON.stringify(agents, null, 2)
}

export function formatDailyJson(daily: DailyStats[]): string {
  return JSON.stringify(daily, null, 2)
}

export function formatProjectsJson(projects: ProjectStats[]): string {
  return JSON.stringify(projects, null, 2)
}

export function formatSessionsJson(
  sessions: SessionStats[],
  relevanceMap?: Map<string, number>
): string {
  if (!relevanceMap || relevanceMap.size === 0) {
    return JSON.stringify(sessions, null, 2)
  }
  const enriched = sessions.map(s => {
    const v = relevanceMap.get(s.sessionId)
    return v !== undefined ? { ...s, relevanceRatio: v } : s
  })
  return JSON.stringify(enriched, null, 2)
}

export function formatTrendsJson(trends: PeriodStats[]): string {
  return JSON.stringify(trends, null, 2)
}
