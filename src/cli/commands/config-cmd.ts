import type { Command } from 'commander'
import { getConfig, getConfigPath, saveConfig } from '../../config/index.js'
import type { TacoConfig } from '../../config/index.js'

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config [subcommand] [key] [value]')
    .description('View or edit TACO configuration')
    .addHelpText(
      'after',
      `
Subcommands:
  taco config              Show current config and path
  taco config path         Print config file path
  taco config set <k> <v>  Set a config value

Valid keys:
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
  taco config set db /path/to/opencode.db`
    )

  cmd.action((subcommand?: string, key?: string, value?: string) => {
    if (!subcommand || subcommand === 'show') {
      printConfig()
    } else if (subcommand === 'path') {
      console.log(getConfigPath())
    } else if (subcommand === 'set') {
      if (!key || value === undefined) {
        console.error('Usage: taco config set <key> <value>')
        process.exit(1)
      }
      setConfigValue(key, value)
    } else {
      console.error(`Unknown subcommand: ${subcommand}`)
      console.error('Run taco config --help for usage.')
      process.exit(1)
    }
  })
}

function printConfig(): void {
  const config = getConfig()
  const path = getConfigPath()

  console.log(`\n🌮 TACO Configuration\n`)
  console.log(`  Config file: ${path}\n`)

  if (Object.keys(config).length === 0) {
    console.log('  (no settings configured — all defaults in use)\n')
  } else {
    for (const [key, val] of Object.entries(config)) {
      if (typeof val === 'object' && val !== null) {
        for (const [k2, v2] of Object.entries(val as Record<string, unknown>)) {
          console.log(`  ${key}.${k2} = ${v2}`)
        }
      } else {
        console.log(`  ${key} = ${val}`)
      }
    }
    console.log()
  }
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
  console.log(`✅ Set ${key} = ${typedVal}  (${getConfigPath()})`)
}
