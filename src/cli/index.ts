import { Command } from 'commander'
import { registerOverviewCommand } from './commands/overview.js'
import { registerModelsCommand } from './commands/models.js'
import { registerProvidersCommand } from './commands/providers.js'
import { registerDailyCommand } from './commands/daily.js'
import { registerProjectsCommand } from './commands/projects.js'
import { registerSessionsCommand } from './commands/sessions.js'
import { registerAgentsCommand } from './commands/agents.js'
import { registerTrendsCommand } from './commands/trends.js'
import { registerExportCommand } from './commands/export.js'
import { registerTuiCommand } from './commands/tui.js'
import { registerTodayCommand } from './commands/today.js'
import { registerConfigCommand } from './commands/config-cmd.js'
import { registerHealthCommand } from './commands/health.js'
import { registerUpdateCommand } from './commands/update.js'
import { registerCompletionCommand } from './commands/completion.js'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Build-time constants injected by bun build --define
declare const VERSION: string | undefined

/**
 * Walk up from a starting directory until package.json is found.
 * Returns the path to package.json or null if not found within maxDepth levels.
 */
function findPackageJsonFrom(start: string, maxDepth = 5): string | null {
  let dir = start
  for (let i = 0; i < maxDepth; i++) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
  }
  return null
}

/**
 * Robustly locate package.json regardless of the execution environment:
 * - Normal: node dist/bin/taco.js  (walks up from dist/bin/)
 * - Source: bun run bin/taco.ts    (walks up from bin/)
 * - Installed: ~/.taco/dist/bin/   (walks up to ~/.taco/)
 * - Bun --compile bundle: import.meta.url is /$bunfs/root/... so we fall
 *   back to process.argv[1] which is the real binary path on disk.
 */
function findPackageJson(): string {
  const candidates: string[] = []

  // Primary: the directory of the current module file
  try {
    const modFile = fileURLToPath(import.meta.url)
    candidates.push(dirname(modFile))
  } catch {
    // import.meta.url may not be a file:// URL in some bundlers
  }

  // Fallback: the directory of the executable (works for Bun --compile)
  if (process.argv[1]) {
    candidates.push(dirname(process.argv[1]))
  }

  for (const start of candidates) {
    const found = findPackageJsonFrom(start)
    if (found) return found
  }
  return ''
}

// Try to load package.json, fallback to embedded VERSION for compiled binaries
let packageJson: { version: string } | null = null
const pkgPath = findPackageJson()
if (pkgPath && existsSync(pkgPath)) {
  try {
    packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    // ignore
  }
}

export function getVersion(): string {
  // Priority: embedded VERSION > package.json > fallback
  if (typeof VERSION === 'string' && VERSION) return VERSION
  if (packageJson?.version) return packageJson.version
  return 'unknown'
}

// ── Braille art embedded as a constant
/* prettier-ignore */
const TACO_ART = [
  '⠀⠀⠀⠀⠀⠀⣤⠀⠀⣤⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⢠⡄⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠰⣦⠀⠙⣇⠀⠈⠀⠈⠁⠀⠀⠀⠀⠀⠀⠀⣀⠀⠀⠀⢀⣤⠀⠀⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠟⠁⠀⡴⠋⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠈⢧⠀⠈⠀⠀⠀⠀⠀⠀⢰⠶⢄⡀⠀⡜⠀⠓⢄⡠⠋⠀⢣⣀⡤⠒⠉⢡⠀⠀⠀⣀⡀⠀⠀⠀⠀⠀⠀⠈⠀⢀⡴⠋⠀⠀',
  '⠀⠀⠛⢦⠀⠀⠀⠀⠀⠀⣀⡀⠀⠀⠸⠀⠀⠈⠚⠁⠀⠀⠀⠀⢀⣀⡠⠥⢤⡄⠀⠘⠤⠔⠊⠉⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠖⠀',
  '⠀⠠⡄⠀⠀⠀⠀⠀⠀⠀⡇⢈⡩⠶⠒⠂⠙⡄⠀⠀⠀⠀⣠⠚⠉⠀⠀⠀⢠⠀⠀⢀⣠⠴⠒⠊⠉⠒⢤⣠⡄⠀⠀⠀⠀⠀⠀⠀⢀⠀',
  '⠀⠀⠀⣀⡤⠔⠒⠉⢱⣦⡇⡇⠀⠀⢠⡀⠘⡾⡄⠀⠀⡰⠁⠀⠀⣠⣴⣶⣾⠀⣰⡟⠁⠀⢀⣀⡀⠀⠠⡹⡄⠀⢀⣴⠉⠐⠢⣄⢀⡀',
  '⢴⣶⠽⠒⠀⠀⠀⠀⠀⣧⣱⣇⠀⠀⢸⣷⠀⠙⣷⡀⢠⡇⠀⠀⡄⣿⠿⠿⠇⣼⣿⠀⠀⢮⣏⡀⠈⡆⠀⠀⢹⡤⢺⠃⠀⠀⠄⡔⠀⠀',
  '⠈⣇⠀⠀⣰⠀⠀⣾⡍⠉⢻⣿⠀⠀⠈⠉⠀⠀⠈⢣⢸⢷⡀⠀⠘⠙⠒⠒⣾⠡⣿⠀⠀⢸⠀⢹⣄⠇⠀⠀⣸⢠⠏⠀⢀⣜⠞⠀⠀⠀',
  '⠀⠘⠶⣉⣹⡀⠀⠘⡏⢊⠁⢸⠀⠀⠰⣿⠻⡄⠀⠀⢻⡐⡷⣄⠀⠀⠀⠀⢹⡴⢿⡄⠀⠚⠓⠚⠁⠀⠀⣰⣷⡏⠀⠀⣠⠋⠀⠀⠀⠀',
  '⠀⠀⠀⢀⡉⢧⠀⠀⢹⡘⡄⢸⠀⠀⠀⣿⣇⣿⡤⠴⠖⣿⣇⣠⣏⡓⣲⣶⣿⣅⠀⠙⠤⣀⣀⣀⣀⣤⢾⣿⡯⢍⣲⠞⢉⡿⠀⠀⠀⠀',
  '⠀⠸⢏⡁⠀⠈⡄⠀⠀⢱⣷⠈⣶⣖⣿⣿⣾⣈⣷⣾⣿⣿⠿⣿⢿⣟⣿⣿⣿⣟⠳⣴⣄⣅⣠⡤⠗⠁⣼⠿⣀⠀⣸⡖⠋⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠉⢢⡄⠱⢶⣋⣉⣩⣇⣈⣿⣯⣿⣿⣿⣿⣿⣿⣭⣿⡤⢻⠟⣻⡿⣿⣿⣿⣿⣯⠛⢦⡀⠀⠀⠫⠤⠬⠋⠀⠉⠑⠦⣄⡀⠀⠀',
  '⠀⠀⢀⠴⠋⠀⠀⠀⠀⣡⣾⣵⠿⠟⠛⠋⠉⠉⠉⠉⠉⠛⠛⠿⣷⣮⣉⣉⡋⢽⣮⣿⣿⠿⡿⠹⣶⣄⠀⠀⠀⠀⠀⠀⣠⠔⠋⠀⠀⠀',
  '⠀⠘⠓⠤⢄⡀⠀⠀⣰⠟⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠙⡿⣿⣤⡴⢛⣤⣿⣄⣳⡌⢹⣾⣷⣄⠀⠀⠀⠯⡀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⢠⠎⢀⡾⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠋⢻⣿⣿⡙⣻⣍⢻⠿⢯⡋⣿⣿⣷⡀⠀⠀⠈⢳⡄⠀⠀⠀',
  '⠀⠀⢀⡔⠁⢀⡞⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣻⣿⣧⣤⣿⣴⣾⣷⣾⣯⣿⣿⣤⠤⠒⠉⠀⠀⠀⠀',
  '⠀⠀⠀⠁⠁⡾⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠛⢟⣿⣿⣤⣴⣿⣿⣯⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⣸⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢣⣿⣾⡟⢿⣿⡿⠛⢿⣧⣿⠛⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠻⡻⣧⡉⠐⠃⠀⢸⣿⢸⠀⠀⠀⠀⠀⠀',
  '⠀⠐⠀⠀⠙⠷⣤⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠱⣽⣿⣤⣤⣴⡿⣣⡟⠀⠀⠀⠀⠀⠀',
  '⠀⠐⠀⠀⠀⠀⠀⠉⠉⠉⠉⢹⠛⠓⠚⠒⠒⠲⠶⠶⠴⠤⠤⠤⠤⠤⠤⠄⣀⣄⣀⣀⣀⣀⣀⣀⣀⣉⣛⣿⡷⠾⠛⠁⠀⠀⠀⠀⠓⠀',
  '⠀⢀⡤⠀⠀⠀⠀⠀⠀⠀⠀⢸⣀⡠⠔⠛⡇⠀⠀⠀⡀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣄⠀⢠⠏⠀⠉⠉⠛⠁⠀⠀⠀⠀⠀⠀⠀⠘⢦⡄⠀',
  '⠀⠀⠀⣠⠖⠀⠀⡀⠀⠀⠀⠈⠁⠀⠀⠀⢳⠀⡠⠚⠉⢆⠀⢀⠜⠑⢄⠀⠀⡞⠈⠱⠾⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡀⠈⢦⡀⠀⠀⠀',
  '⠀⠀⠈⠁⠀⣠⠎⠀⢀⡼⠁⢀⠀⠀⠀⠀⠘⠋⠀⠀⠀⠈⠷⠃⠀⠀⠀⠳⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠀⢢⡀⠈⢷⡀⠈⠗⠀⠀⠀',
  '⠀⠀⠀⠀⠈⠁⠀⠀⡻⠁⠀⠛⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠈⠃⠀⠈⠁⠀⠀⠀⠀⠀',
].join('\n')

export function createProgram(): Command {
  const program = new Command()

  program
    .name('taco')
    .usage('[command] [options]')
    .description(
      '🌮 TACO — Token Accumulator Counter for OpenCode\n\n' +
        'Analyze your AI coding session usage across dates, models, and projects.\n\n' +
        'Common Options:\n' +
        '  --from <date>       Start date (ISO 8601 or relative: 7d, 30d, 1w, 3m)\n' +
        '  --to <date>         End date (ISO 8601 or relative)\n' +
        '  --model <name>      Filter to a specific model\n' +
        '  --provider <name>   Filter to a specific provider\n' +
        '  --format <format>   Output format: visual, json, csv, markdown\n' +
        '  --db <path>         Override OpenCode database path\n\n' +
        "Use 'taco <command> --help' for command-specific options."
    )
    .allowExcessArguments(true)

  // Display ASCII art before --help output
  program.addHelpText('before', TACO_ART + '\n')

  // Custom --version that shows art then version string
  program.version(
    `\n${TACO_ART}\n\n🌮 TACO v${getVersion()} — Token Accumulator Counter for OpenCode`,
    '-V, --version',
    'Display version number'
  )

  // Register all sub-commands
  registerOverviewCommand(program)
  registerModelsCommand(program)
  registerProvidersCommand(program)
  registerDailyCommand(program)
  registerProjectsCommand(program)
  registerSessionsCommand(program)
  registerAgentsCommand(program)
  registerTrendsCommand(program)
  registerExportCommand(program)
  registerTuiCommand(program)
  registerTodayCommand(program)
  registerConfigCommand(program)
  registerHealthCommand(program)
  registerUpdateCommand(program)
  registerCompletionCommand(program)

  // Default action (no sub-command) → run TUI if TTY available, otherwise overview
  program.action(async () => {
    if (process.stdin.isTTY) {
      await program.parseAsync(['tui'], { from: 'user' })
    } else {
      await program.parseAsync(['overview'], { from: 'user' })
    }
  })

  return program
}
