import { Command } from 'commander'
import { registerOverviewCommand } from './commands/overview.js'
import { registerModelsCommand } from './commands/models.js'
import { registerMonthCommand } from './commands/month.js'
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
import { registerUninstallCommand } from './commands/uninstall.js'
import { registerCompletionCommand } from './commands/completion.js'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// TACO_VERSION is replaced at bundle time by `bun build --define TACO_VERSION='"x.y.z"'.
// When running from source (bun run / node dist/) the constant is undefined and we fall
// back to reading package.json from disk.
declare const TACO_VERSION: string | undefined

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
 * Resolve the package version string.
 *
 * Priority:
 *  1. Compile-time constant (TACO_VERSION) — set by `bun build --define`.
 *     This is the only reliable source inside a Bun --compile binary because
 *     import.meta.url resolves to a virtual /$bunfs/root/... path that has no
 *     real package.json alongside it.
 *  2. Walk up the filesystem from the module file / argv[1] — works for
 *     `node dist/bin/taco.js` and `bun run bin/taco.ts` (source runs).
 */
function resolveVersion(): string {
  // 1. Compile-time constant injected by bun build --define
  if (typeof TACO_VERSION !== 'undefined' && TACO_VERSION) {
    return TACO_VERSION
  }

  // 2. Runtime fallback: find package.json on disk
  const candidates: string[] = []

  try {
    const modFile = fileURLToPath(import.meta.url)
    candidates.push(dirname(modFile))
  } catch {
    // import.meta.url may not be a file:// URL in all environments
  }

  if (process.argv[1]) {
    candidates.push(dirname(process.argv[1]))
  }

  for (const start of candidates) {
    const pkgPath = findPackageJsonFrom(start)
    if (pkgPath) {
      try {
        return (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }).version
      } catch {
        // malformed package.json — try next candidate
      }
    }
  }

  return 'unknown'
}

const version = resolveVersion()

export function getVersion(): string {
  return version
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
    `\n${TACO_ART}\n\n🌮 TACO v${version} — Token Accumulator Counter for OpenCode`,
    '-V, --version',
    'Display version number'
  )

  // Register all sub-commands
  registerOverviewCommand(program)
  registerModelsCommand(program)
  registerMonthCommand(program)
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
  registerUninstallCommand(program)
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
