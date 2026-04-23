import type { Command } from 'commander'
import chalk from 'chalk'
import {
  existsSync,
  rmSync,
  renameSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'fs'
import { homedir, platform } from 'os'
import { join, dirname, basename } from 'path'
import { createInterface } from 'readline'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const info = (msg: string) => process.stdout.write(chalk.cyan(`  -> ${msg}\n`))
const ok = (msg: string) => process.stdout.write(chalk.green(`  [OK] ${msg}\n`))
const warn = (msg: string) => process.stderr.write(chalk.yellow(`  [WARN] ${msg}\n`))

async function confirm(question: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${question} [y/N] `, answer => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

/** Remove lines containing `pattern` from a file. Non-fatal if file missing. */
function removeLinesContaining(filePath: string, ...patterns: string[]): boolean {
  if (!existsSync(filePath)) return false
  try {
    const content = readFileSync(filePath, 'utf-8')
    const filtered = content
      .split('\n')
      .filter(line => !patterns.some(p => line.includes(p)))
      .join('\n')
    if (filtered !== content) {
      writeFileSync(filePath, filtered, 'utf-8')
      return true
    }
  } catch {
    // best-effort
  }
  return false
}

/**
 * Returns true when the current process is a Bun-compiled standalone binary.
 */
function isStandaloneBinary(): boolean {
  return basename(process.execPath).toLowerCase().startsWith('taco')
}

// ─── Main uninstall logic ─────────────────────────────────────────────────────

interface UninstallOptions {
  yes?: boolean
  keepConfig?: boolean
  keepCache?: boolean
  system?: boolean
}

async function runUninstall(opts: UninstallOptions): Promise<void> {
  const home = homedir()

  // --- Determine install directory ---
  let installDir: string
  let binaryPath: string | null = null

  if (isStandaloneBinary()) {
    // Standalone binary — the install dir is the binary's parent directory
    binaryPath = process.execPath
    installDir = dirname(binaryPath)
  } else if (opts.system) {
    installDir = platform() === 'win32' ? 'C:\\Program Files\\taco' : '/usr/local/bin'
  } else {
    installDir = join(home, '.taco')
  }

  console.log()
  console.log(chalk.bold('  Install directory:'), installDir)
  console.log()

  // --- Confirm ---
  if (!opts.yes) {
    const confirmed = await confirm(chalk.yellow('  Remove TACO? This cannot be undone.'))
    if (!confirmed) {
      info('Aborted.')
      return
    }
    console.log()
  }

  // --- Remove install directory / binary ---
  if (existsSync(installDir)) {
    // For standalone binaries, self-deletion requires care:
    // On Unix the file can be unlinked while running (inode stays until exit).
    // On Windows, rename to .old first; it will be cleaned up on next boot or next uninstall.
    if (binaryPath && !installDir.includes('.taco') && !installDir.endsWith('taco')) {
      // System install or non-standard location — only remove the binary file itself
      try {
        if (platform() === 'win32') {
          const oldPath = binaryPath + '.old'
          if (existsSync(oldPath)) rmSync(oldPath, { force: true })
          renameSync(binaryPath, oldPath)
          setImmediate(() => {
            try {
              rmSync(oldPath, { force: true })
            } catch {
              /* best-effort */
            }
          })
        } else {
          unlinkSync(binaryPath)
        }
        ok(`Removed binary: ${binaryPath}`)
      } catch (e) {
        warn(`Could not remove binary: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      // ~/.taco directory — remove the whole thing
      try {
        rmSync(installDir, { recursive: true, force: true })
        ok(`Removed installation directory: ${installDir}`)
      } catch (e) {
        warn(`Could not remove ${installDir}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } else {
    info(`Installation directory not found: ${installDir}`)
  }

  // --- Clean PATH and completions from shell rc files ---
  const rcFiles = [join(home, '.bashrc'), join(home, '.zshrc')]

  for (const rc of rcFiles) {
    if (!existsSync(rc)) continue
    const changed = removeLinesContaining(
      rc,
      '.taco',
      'taco completion',
      '# taco shell completions'
    )
    if (changed) {
      ok(`Cleaned PATH/completion entries from ${rc}`)
    }
  }

  // --- Remove fish completions ---
  const fishCompFile = join(home, '.config', 'fish', 'completions', 'taco.fish')
  if (existsSync(fishCompFile)) {
    try {
      unlinkSync(fishCompFile)
      ok(`Removed fish completions: ${fishCompFile}`)
    } catch {
      warn(`Could not remove fish completions: ${fishCompFile}`)
    }
  }

  // --- Remove Windows user PATH entry ---
  if (platform() === 'win32') {
    // Best-effort: advise the user since modifying registry from TS is fragile
    info(
      `Remember to remove ${installDir} from your user PATH (System Settings → Environment Variables).`
    )
  }

  // --- Remove cache directory ---
  const cacheDir = join(home, '.cache', 'taco')
  if (!opts.keepCache && existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true })
      ok(`Removed cache: ${cacheDir}`)
    } catch (e) {
      warn(`Could not remove cache: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else if (opts.keepCache && existsSync(cacheDir)) {
    info(`Keeping cache: ${cacheDir}`)
  }

  // --- Handle config directory ---
  const configDir = join(home, '.config', 'taco')
  if (existsSync(configDir)) {
    let removeConfig = false
    if (opts.keepConfig) {
      info(`Keeping config: ${configDir}`)
    } else if (opts.yes) {
      removeConfig = true
    } else {
      removeConfig = await confirm(`  Remove TACO configuration at ${configDir}?`)
    }

    if (removeConfig) {
      try {
        rmSync(configDir, { recursive: true, force: true })
        ok(`Removed config: ${configDir}`)
      } catch (e) {
        warn(`Could not remove config: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // --- Clean up stale completion cache files ---
  const completionCacheDir = join(home, '.cache', 'taco', 'completions')
  if (existsSync(completionCacheDir)) {
    try {
      const files = readdirSync(completionCacheDir)
      for (const f of files) {
        unlinkSync(join(completionCacheDir, f))
      }
    } catch {
      // best-effort
    }
  }

  console.log()
  console.log(chalk.green(chalk.bold('  Uninstall complete.')))
  console.log()
  console.log(chalk.dim('  Note: Your OpenCode session data in opencode.db is preserved.'))
  console.log()
}

// ─── Command registration ──────────────────────────────────────────────────────

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Remove TACO from your system')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--keep-config', 'Preserve the config directory (~/.config/taco)')
    .option('--keep-cache', 'Preserve the cache directory (~/.cache/taco)')
    .option('--system', 'Uninstall a system-wide installation')
    .action(async (opts: UninstallOptions) => {
      console.log()
      console.log(chalk.bold('🌮 TACO — Uninstall'))
      await runUninstall(opts)
    })
}
