import { createInterface } from 'node:readline'
import type { Command } from 'commander'
import { getConfig, getConfigPath, saveConfig } from '../../config/index.js'
import type {
  TacoConfig,
  GatewayConfig,
  GatewayAuth,
  GatewayFieldMapping,
} from '../../config/index.js'
import { runInitWizard } from './init-wizard.js'
import { fetchGatewayMetrics } from '../../data/gateway.js'
import { clearGatewayCache, clearAllGatewayData } from '../../data/gateway-cache.js'
import { formatCost } from '../../utils/formatting.js'
import {
  discoverLiteLLMEndpoints,
  deriveBaseUrl,
  getCurrentBillingPeriod,
  fetchModelSpend,
} from '../../data/gateway-litellm.js'

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config [subcommand] [key] [value]')
    .description('View or edit TACO configuration')
    .allowUnknownOption(true)
    .addHelpText(
      'after',
      `
Subcommands:
  taco config              Show current config and path
  taco config path         Print config file path
  taco config init         Interactive setup wizard
  taco config set <k> <v>  Set a config value
  taco config gateway      Manage API gateway integration

Valid keys for "set":
  db                  Path to OpenCode database
  defaultFormat       Output format: visual | json | csv | markdown
  defaultRange        Default date range: 7d | 30d | 90d | all
  currency            Currency display (future use)
  budget.daily        Daily spend limit in USD
  budget.monthly      Monthly spend limit in USD

Examples:
  taco config
  taco config set defaultRange 30d
  taco config set budget.daily 5
  taco config set db /path/to/opencode.db
  taco config gateway --setup
  taco config gateway --test`
    )

  cmd.action(async (subcommand?: string, key?: string, value?: string) => {
    if (!subcommand || subcommand === 'show') {
      printConfig()
    } else if (subcommand === 'path') {
      console.log(getConfigPath())
    } else if (subcommand === 'init') {
      await runInitWizard()
    } else if (subcommand === 'set') {
      if (!key || value === undefined) {
        console.error('Usage: taco config set <key> <value>')
        process.exit(1)
      }
      setConfigValue(key, value)
    } else if (subcommand === 'gateway') {
      await handleGatewaySubcommand()
    } else {
      console.error(`Unknown subcommand: ${subcommand}`)
      console.error('Run taco config --help for usage.')
      process.exit(1)
    }
  })
}

// ─── gateway dispatch (reads raw argv flags) ──────────────────────────────────

async function handleGatewaySubcommand(): Promise<void> {
  // Extract flags that appear after "gateway" in the raw argv
  const gwIdx = process.argv.indexOf('gateway')
  const flags = new Set(gwIdx >= 0 ? process.argv.slice(gwIdx + 1) : [])

  if (flags.has('--help') || flags.has('-h')) {
    printGatewayHelp()
  } else if (flags.has('--setup')) {
    await runGatewaySetup()
  } else if (flags.has('--test')) {
    await runGatewayTest()
  } else if (flags.has('--clear-cache')) {
    clearGatewayCache()
    console.log('Gateway live cache cleared. Next taco run will fetch fresh data.')
  } else if (flags.has('--clear-all')) {
    clearAllGatewayData()
    console.log('All gateway data cleared (live cache + daily snapshots).')
  } else if (flags.has('--disable')) {
    const config = getConfig()
    if (!config.gateway) {
      console.log('No gateway configured.')
      return
    }
    const { gateway: _removed, ...rest } = config
    saveConfig(rest)
    clearAllGatewayData()
    console.log('Gateway integration disabled and all cached data removed.')
  } else {
    // Default (no flag / --status): show status
    await showGatewayStatus()
  }
}

function printGatewayHelp(): void {
  console.log(`
taco config gateway [--setup|--test|--status|--clear-cache|--clear-all|--disable]

Manage API gateway integration (LiteLLM, OpenRouter, custom…)

Options:
  --setup         Interactive setup wizard
  --test          Fetch and display metrics from the configured gateway
  --status        Show current gateway configuration (default)
  --clear-cache   Clear the live gateway cache (keeps daily snapshots)
  --clear-all     Clear all gateway data including daily snapshots
  --disable       Remove gateway configuration
  --help, -h      Show this help

Gateway integration lets TACO show your real spend from the API proxy
alongside OpenCode's local estimates.

Works with any HTTP JSON endpoint — no hard-coded gateway format.
You provide JSONPath expressions to map response fields to metrics.

Config file: ${getConfigPath()}

LiteLLM example (add manually or via --setup):
  {
    "gateway": {
      "endpoint": "https://ai-proxy.company.com/user/info",
      "auth": { "type": "bearer", "tokenOrEnv": "\${LITELLM_API_KEY}" },
      "mappings": {
        "totalSpend": "$.user_info.spend",
        "budgetLimit": "$.user_info.max_budget",
        "budgetResetAt": "$.user_info.budget_reset_at",
        "teamSpend": "$.teams[0].spend",
        "teamBudgetLimit": "$.teams[0].max_budget",
        "teamName": "$.teams[0].team_alias"
      }
    }
  }
`)
}

// ─── Gateway status ────────────────────────────────────────────────────────────

async function showGatewayStatus(): Promise<void> {
  const config = getConfig()

  if (!config.gateway) {
    console.log('\nGateway integration: not configured\n')
    console.log('  Run: taco config gateway --setup')
    console.log()
    return
  }

  const gw = config.gateway
  console.log('\nGateway integration: configured\n')
  console.log(`  Endpoint:    ${gw.endpoint}`)
  console.log(`  Method:      ${gw.method ?? 'GET'}`)
  console.log(`  Auth type:   ${gw.auth.type}`)
  console.log(`  Cache TTL:   ${gw.cacheTtlMinutes ?? 15} min`)
  console.log(`\n  Mappings:`)
  for (const [k, v] of Object.entries(gw.mappings)) {
    if (v) console.log(`    ${k.padEnd(18)} ${v}`)
  }
  console.log()
  console.log('  Run: taco config gateway --test  to fetch live metrics')
  console.log()
}

// ─── Gateway test ──────────────────────────────────────────────────────────────

async function runGatewayTest(): Promise<void> {
  const config = getConfig()

  if (!config.gateway) {
    console.error('No gateway configured. Run: taco config gateway --setup')
    process.exit(1)
  }

  console.log(`\nTesting gateway: ${config.gateway.endpoint}\n`)

  // Force a fresh fetch by clearing live cache first
  clearGatewayCache()

  const metrics = await fetchGatewayMetrics(config.gateway)

  if (!metrics) {
    console.error('Gateway fetch failed. Check your endpoint URL and API key.')
    process.exit(1)
  }

  console.log('  Gateway metrics:\n')
  console.log(`    Total spend:   ${formatCost(metrics.totalSpend)}`)
  if (metrics.budgetLimit !== null) {
    const pct = ((metrics.totalSpend / metrics.budgetLimit) * 100).toFixed(1)
    console.log(`    Budget limit:  ${formatCost(metrics.budgetLimit)}  (${pct}% used)`)
  }
  if (metrics.budgetResetAt) {
    const d = new Date(metrics.budgetResetAt)
    console.log(`    Budget resets: ${d.toLocaleDateString(undefined, { dateStyle: 'medium' })}`)
  }
  if (metrics.budgetDuration) {
    console.log(`    Period:        ${metrics.budgetDuration}`)
  }
  if (metrics.teamSpend !== null) {
    console.log(
      `    Team spend:    ${formatCost(metrics.teamSpend)}${metrics.teamName ? `  (${metrics.teamName})` : ''}`
    )
  }
  if (metrics.teamBudgetLimit !== null) {
    const pct =
      metrics.teamSpend !== null
        ? `  (${((metrics.teamSpend / metrics.teamBudgetLimit) * 100).toFixed(1)}% used)`
        : ''
    console.log(`    Team budget:   ${formatCost(metrics.teamBudgetLimit)}${pct}`)
  }
  console.log(`\n    Fetched from:  ${metrics.endpoint}`)

  // ── Probe LiteLLM standard endpoints ──
  console.log('\n  Probing LiteLLM endpoints...\n')
  const availability = await discoverLiteLLMEndpoints(config.gateway)
  const baseUrl = deriveBaseUrl(config.gateway.endpoint)

  const tick = (ok: boolean) => (ok ? '  ✓' : '  ✗')
  console.log(
    `${tick(availability.spendLogs)}  /spend/logs          ${availability.spendLogs ? '(per-model spend — enhances `taco models`)' : 'not available'}`
  )
  console.log(
    `${tick(availability.dailyActivity)}  /user/daily/activity ${availability.dailyActivity ? '(daily breakdown — enhances `taco daily`)' : 'not available'}`
  )
  console.log(
    `${tick(availability.modelInfo)}  /model/info          ${availability.modelInfo ? '(model pricing rates)' : 'not available'}`
  )

  if (availability.spendLogs) {
    const { startDate, endDate } = getCurrentBillingPeriod()
    console.log(`\n  Fetching model spend (${startDate} → ${endDate})...`)
    const spendResult = await fetchModelSpend(config.gateway, startDate, endDate)
    if (spendResult && spendResult.modelSpend.length > 0) {
      console.log(`\n  Top models by gateway spend:\n`)
      const top = [...spendResult.modelSpend].sort((a, b) => b.spend - a.spend).slice(0, 5)
      for (const { model, spend } of top) {
        console.log(`    ${model.padEnd(50)} ${formatCost(spend)}`)
      }
      if (spendResult.modelSpend.length > 5) {
        console.log(`    ... and ${spendResult.modelSpend.length - 5} more models`)
      }
      console.log(`\n    Total gateway spend: ${formatCost(spendResult.totalSpend)}`)
    }
  }

  console.log(`\n  Base URL: ${baseUrl}`)
  console.log()
}

// ─── Interactive setup wizard ──────────────────────────────────────────────────

async function runGatewaySetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

  console.log('\nGateway Setup Wizard\n')
  console.log('Configure any HTTP JSON endpoint that returns spend/budget metrics.')
  console.log('Press Ctrl+C to cancel at any time.\n')

  try {
    // ── Endpoint ──
    const endpoint = (
      await ask('  Gateway URL (e.g. https://ai-proxy.company.com/user/info):\n  > ')
    ).trim()
    if (!endpoint) throw new Error('Endpoint is required.')

    // ── Auth ──
    console.log('\n  Auth type:')
    console.log('    1) Bearer token  (Authorization: Bearer <token>)')
    console.log('    2) Basic auth    (Authorization: Basic <b64>)')
    console.log('    3) Custom header (e.g. X-Api-Key)')
    const authChoice = (await ask('  > ')).trim()

    let auth: GatewayAuth
    if (authChoice === '2') {
      const usernameOrEnv = (await ask('\n  Username or env-var (e.g. ${MY_USER}):\n  > ')).trim()
      const passwordOrEnv = (await ask('  Password or env-var (e.g. ${MY_PASS}):\n  > ')).trim()
      auth = { type: 'basic', usernameOrEnv, passwordOrEnv }
    } else if (authChoice === '3') {
      const headerName = (await ask('\n  Header name (e.g. X-Api-Key):\n  > ')).trim()
      const headerValueOrEnv = (
        await ask('  Header value or env-var (e.g. ${MY_KEY}):\n  > ')
      ).trim()
      auth = { type: 'header', headerName, headerValueOrEnv }
    } else {
      const tokenOrEnv = (
        await ask('\n  Bearer token or env-var name (e.g. ${LITELLM_API_KEY}):\n  > ')
      ).trim()
      auth = { type: 'bearer', tokenOrEnv }
    }

    // ── Sample JSON for auto-mapping ──
    console.log('\n  Paste a sample JSON response from the endpoint to auto-detect field paths.')
    console.log('  (Press Enter on an empty line to skip and enter paths manually)\n')
    const lines: string[] = []
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const line = await ask('')
      if (line === '') break
      lines.push(line)
    }

    let mappings: GatewayFieldMapping
    if (lines.length > 0) {
      const rawJson = lines.join('\n')
      mappings = await autoDetectMappings(rawJson, ask)
    } else {
      mappings = await manualMappings(ask)
    }

    // ── TTL ──
    const ttlStr = (
      await ask('\n  Cache TTL in minutes (default: 15, 0 = always fetch):\n  > ')
    ).trim()
    const cacheTtlMinutes = ttlStr === '' ? 15 : parseInt(ttlStr, 10)

    rl.close()

    const gatewayConfig: GatewayConfig = {
      endpoint,
      auth,
      mappings,
      cacheTtlMinutes: isNaN(cacheTtlMinutes) ? 15 : cacheTtlMinutes,
    }

    // ── Test before saving ──
    console.log('\nTesting configuration…')
    clearGatewayCache()
    const metrics = await fetchGatewayMetrics(gatewayConfig)
    if (!metrics) {
      console.error('\nCould not fetch metrics with the provided configuration.')
      console.error('Check the endpoint URL, auth credentials, and JSONPath mappings.')
      process.exit(1)
    }

    console.log(`\n  totalSpend resolved to: ${formatCost(metrics.totalSpend)}`)
    if (metrics.budgetLimit !== null)
      console.log(`  budgetLimit resolved to: ${formatCost(metrics.budgetLimit)}`)
    if (metrics.teamSpend !== null)
      console.log(`  teamSpend resolved to:   ${formatCost(metrics.teamSpend)}`)

    // ── Save ──
    const config = getConfig()
    saveConfig({ ...config, gateway: gatewayConfig })
    console.log(`\nGateway configuration saved to ${getConfigPath()}`)
    console.log('Run: taco overview  to see gateway metrics alongside local data\n')
  } catch (err) {
    rl.close()
    if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      // Ctrl+C
      console.log('\nSetup cancelled.')
      process.exit(0)
    }
    throw err
  }
}

// ─── Auto-detect mappings from sample JSON ─────────────────────────────────────

async function autoDetectMappings(
  rawJson: string,
  ask: (q: string) => Promise<string>
): Promise<GatewayFieldMapping> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    console.warn('\n  Could not parse JSON. Falling back to manual mapping entry.\n')
    return manualMappings(ask)
  }

  // Collect all leaf paths and their values
  const candidates: Array<{ path: string; value: unknown }> = []
  collectLeafPaths(parsed, '$', candidates)

  // Score each candidate for likely metric fields
  const SPEND_KEYWORDS = ['spend', 'cost', 'usage', 'used']
  const BUDGET_KEYWORDS = ['budget', 'limit', 'max', 'cap', 'quota']
  const RESET_KEYWORDS = ['reset', 'refresh', 'renew', 'expire']
  const DURATION_KEYWORDS = ['duration', 'period', 'interval', 'cycle']
  const TEAM_KEYWORDS = ['team', 'org', 'group', 'workspace']
  const NAME_KEYWORDS = ['name', 'alias', 'label', 'title']

  const suggest = (keywords: string[], notKeywords: string[] = []): string | undefined => {
    const match = candidates.find(({ path, value }) => {
      const lp = path.toLowerCase()
      const isNumeric = typeof value === 'number'
      const hasKeyword = keywords.some(k => lp.includes(k))
      const hasExcluded = notKeywords.some(k => lp.includes(k))
      return hasKeyword && !hasExcluded && (isNumeric || typeof value === 'string')
    })
    return match?.path
  }

  const suggestStr = (keywords: string[]): string | undefined => {
    const match = candidates.find(({ path, value }) => {
      const lp = path.toLowerCase()
      const hasKeyword = keywords.some(k => lp.includes(k))
      return hasKeyword && typeof value === 'string'
    })
    return match?.path
  }

  const spendSuggestion = suggest(SPEND_KEYWORDS, [...BUDGET_KEYWORDS, ...TEAM_KEYWORDS])
  const budgetSuggestion = suggest(BUDGET_KEYWORDS, TEAM_KEYWORDS)
  const resetSuggestion = suggestStr(RESET_KEYWORDS)
  const durationSuggestion = suggestStr(DURATION_KEYWORDS)
  const teamSpendSuggestion = suggest([...SPEND_KEYWORDS, ...TEAM_KEYWORDS], [])
  const teamBudgetSuggestion = suggest([...BUDGET_KEYWORDS, ...TEAM_KEYWORDS])
  const teamNameSuggestion = suggestStr([...TEAM_KEYWORDS, ...NAME_KEYWORDS])

  console.log('\n  Auto-detected field paths (press Enter to accept, or type a new path):\n')

  const confirmOrEdit = async (
    label: string,
    suggestion: string | undefined
  ): Promise<string | undefined> => {
    if (!suggestion) {
      const ans = (await ask(`  ${label.padEnd(20)} (not detected — enter path or skip): `)).trim()
      return ans || undefined
    }
    const ans = (await ask(`  ${label.padEnd(20)} ${suggestion}\n    Accept? [Y/n/path]: `)).trim()
    if (ans === '' || ans.toLowerCase() === 'y') return suggestion
    if (ans.toLowerCase() === 'n') return undefined
    return ans // user typed a custom path
  }

  const totalSpend = (await confirmOrEdit('totalSpend *', spendSuggestion)) ?? ''
  if (!totalSpend) {
    console.error('\n  totalSpend is required. Aborting setup.')
    process.exit(1)
  }
  const budgetLimit = await confirmOrEdit('budgetLimit', budgetSuggestion)
  const budgetResetAt = await confirmOrEdit('budgetResetAt', resetSuggestion)
  const budgetDuration = await confirmOrEdit('budgetDuration', durationSuggestion)
  const teamSpend = await confirmOrEdit('teamSpend', teamSpendSuggestion)
  const teamBudgetLimit = await confirmOrEdit('teamBudgetLimit', teamBudgetSuggestion)
  const teamName = await confirmOrEdit('teamName', teamNameSuggestion)

  const mappings: GatewayFieldMapping = { totalSpend }
  if (budgetLimit) mappings.budgetLimit = budgetLimit
  if (budgetResetAt) mappings.budgetResetAt = budgetResetAt
  if (budgetDuration) mappings.budgetDuration = budgetDuration
  if (teamSpend) mappings.teamSpend = teamSpend
  if (teamBudgetLimit) mappings.teamBudgetLimit = teamBudgetLimit
  if (teamName) mappings.teamName = teamName

  return mappings
}

/** Collect all leaf paths with their values from an arbitrary JSON object. */
function collectLeafPaths(
  obj: unknown,
  prefix: string,
  out: Array<{ path: string; value: unknown }>
): void {
  if (obj === null || typeof obj !== 'object') {
    out.push({ path: prefix, value: obj })
    return
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectLeafPaths(item, `${prefix}[${i}]`, out))
  } else {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      collectLeafPaths(v, `${prefix}.${k}`, out)
    }
  }
}

// ─── Manual mapping entry ──────────────────────────────────────────────────────

async function manualMappings(ask: (q: string) => Promise<string>): Promise<GatewayFieldMapping> {
  console.log('\n  Enter JSONPath expressions for each metric field.')
  console.log('  Press Enter to skip optional fields.\n')
  console.log('  Examples: $.user_info.spend  |  $.keys[0].max_budget\n')

  const totalSpend = (await ask('  totalSpend * (required): ')).trim()
  if (!totalSpend) {
    console.error('totalSpend is required.')
    process.exit(1)
  }

  const mappings: GatewayFieldMapping = { totalSpend }

  const fields: Array<[keyof GatewayFieldMapping, string]> = [
    ['budgetLimit', 'budgetLimit (budget cap in USD)'],
    ['budgetResetAt', 'budgetResetAt (ISO date of next reset)'],
    ['budgetDuration', 'budgetDuration (e.g. "1mo", "30d")'],
    ['teamSpend', 'teamSpend (team total spend)'],
    ['teamBudgetLimit', 'teamBudgetLimit (team budget cap)'],
    ['teamName', 'teamName (team alias/name)'],
  ]

  for (const [field, label] of fields) {
    const val = (await ask(`  ${label}: `)).trim()
    if (val) mappings[field] = val
  }

  return mappings
}

// ─── Existing config helpers ───────────────────────────────────────────────────

function printConfig(): void {
  const config = getConfig()
  const path = getConfigPath()

  console.log(`\nTACO Configuration\n`)
  console.log(`  Config file: ${path}\n`)

  if (Object.keys(config).length === 0) {
    console.log('  (no settings configured — all defaults in use)\n')
    return
  }

  for (const [key, val] of Object.entries(config)) {
    if (key === 'gateway') {
      const gw = val as GatewayConfig
      console.log(`  gateway.endpoint        = ${gw.endpoint}`)
      console.log(`  gateway.auth.type       = ${gw.auth.type}`)
      console.log(`  gateway.cacheTtlMinutes = ${gw.cacheTtlMinutes ?? 15}`)
      console.log(
        `  gateway.mappings.*      = (${Object.keys(gw.mappings).length} fields configured)`
      )
    } else if (typeof val === 'object' && val !== null) {
      for (const [k2, v2] of Object.entries(val as Record<string, unknown>)) {
        console.log(`  ${key}.${k2} = ${v2}`)
      }
    } else {
      console.log(`  ${key} = ${val}`)
    }
  }
  console.log()
}

function setConfigValue(key: string, value: string): void {
  const config: TacoConfig = { ...getConfig() }

  // Parse value to appropriate type
  const numVal = parseFloat(value)
  const typedVal: string | number = isNaN(numVal) ? value : numVal

  switch (key) {
    case 'db':
      config.db = value
      break
    case 'defaultFormat':
      if (!['visual', 'json', 'csv', 'markdown'].includes(value)) {
        console.error(`Invalid format '${value}'. Use: visual | json | csv | markdown`)
        process.exit(1)
      }
      config.defaultFormat = value as TacoConfig['defaultFormat']
      break
    case 'defaultRange':
      config.defaultRange = value
      break
    case 'currency':
      config.currency = value
      break
    case 'budget.daily':
      if (isNaN(numVal)) {
        console.error(`budget.daily must be a number, got: '${value}'`)
        process.exit(1)
      }
      config.budget = { ...config.budget, daily: numVal }
      break
    case 'budget.monthly':
      if (isNaN(numVal)) {
        console.error(`budget.monthly must be a number, got: '${value}'`)
        process.exit(1)
      }
      config.budget = { ...config.budget, monthly: numVal }
      break
    default:
      console.error(`Unknown config key: '${key}'`)
      console.error('Run taco config --help to see valid keys.')
      process.exit(1)
  }

  saveConfig(config)
  console.log(`Set ${key} = ${typedVal}  (${getConfigPath()})`)
}
