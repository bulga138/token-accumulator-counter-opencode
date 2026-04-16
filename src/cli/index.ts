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
import packageJson from '../../package.json' with { type: 'json' }

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
    `\n${TACO_ART}\n\n🌮 TACO v${packageJson.version} — Token Accumulator Counter for OpenCode`,
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
