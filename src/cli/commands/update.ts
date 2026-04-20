import type { Command } from 'commander'
import chalk from 'chalk'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, createWriteStream } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { getColors } from '../../theme/index.js'

const REPO = 'bulga138/taco'
const REPO_URL = `https://github.com/${REPO}`

// ─── Version discovery ────────────────────────────────────────────────────────

/**
 * Resolve the latest published version tag using git ls-remote.
 * No GitHub API rate limits.
 */
function fetchLatestTag(): string | null {
  try {
    const result = spawnSync('git', ['ls-remote', '--tags', `${REPO_URL}.git`], {
      encoding: 'utf8',
      timeout: 15_000,
    })
    if (result.status !== 0 || !result.stdout) return null

    const tags = result.stdout
      .split('\n')
      .map(line => {
        const m = line.match(/v(\d+\.\d+\.\d+)$/)
        return m ? m[0] : null
      })
      .filter((t): t is string => t !== null)

    if (tags.length === 0) return null

    // Sort semver ascending, take the last
    tags.sort((a, b) => {
      const toNum = (v: string) =>
        v
          .replace(/^v/, '')
          .split('.')
          .map(n => parseInt(n, 10))
      const [aMaj, aMin, aPatch] = toNum(a)
      const [bMaj, bMin, bPatch] = toNum(b)
      if (aMaj !== bMaj) return aMaj - bMaj
      if (aMin !== bMin) return aMin - bMin
      return aPatch - bPatch
    })
    return tags[tags.length - 1]
  } catch {
    return null
  }
}

// ─── Version comparison ───────────────────────────────────────────────────────

function parseVersion(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '')
  const parts = clean.split('.').map(n => parseInt(n, 10))
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

type VersionOrder = 'older' | 'equal' | 'newer'

function compareVersions(a: string, b: string): VersionOrder {
  const [aMaj, aMin, aPatch] = parseVersion(a)
  const [bMaj, bMin, bPatch] = parseVersion(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? 'older' : 'newer'
  if (aMin !== bMin) return aMin < bMin ? 'older' : 'newer'
  if (aPatch !== bPatch) return aPatch < bPatch ? 'older' : 'newer'
  return 'equal'
}

// ─── Download helpers ─────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'taco-cli/update' },
    redirect: 'follow',
  })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} downloading ${url}`)
  }
  const out = createWriteStream(dest)
  // res.body is a Web ReadableStream; cast to satisfy Node pipeline types
  await pipeline(res.body as unknown as Parameters<typeof pipeline>[0], out)
}

// ─── Install helpers ──────────────────────────────────────────────────────────

function runInstaller(installerPath: string, tag: string): void {
  const env = { ...process.env, LATEST_TAG: tag, REPO }
  const result = spawnSync('bash', [installerPath], {
    env,
    stdio: 'inherit',
    timeout: 300_000,
  })
  if (result.status !== 0) {
    throw new Error(`Installer exited with code ${result.status ?? 'unknown'}`)
  }
}

// ─── Main update logic ────────────────────────────────────────────────────────

interface UpdateOptions {
  check?: boolean
  version?: string
  force?: boolean
}

async function runUpdate(currentVersion: string, opts: UpdateOptions): Promise<void> {
  const colors = getColors()
  const info = (msg: string) => process.stdout.write(colors.info(`  -> ${msg}\n`))
  const ok = (msg: string) => process.stdout.write(chalk.green(`  [OK] ${msg}\n`))
  const err = (msg: string) => process.stderr.write(chalk.red(`  [ERROR] ${msg}\n`))

  // --- Resolve target version ---
  let targetTag: string

  if (opts.version) {
    targetTag = opts.version.startsWith('v') ? opts.version : `v${opts.version}`
    info(`Target version: ${targetTag} (pinned)`)
  } else {
    info('Checking for latest release...')
    const latest = fetchLatestTag()
    if (!latest) {
      err(
        'Could not determine latest release. Check your internet connection or pin a version:\n' +
          '  taco update --version v0.1.5'
      )
      process.exit(1)
    }
    targetTag = latest
    info(`Latest release: ${targetTag}`)
  }

  const targetVersion = targetTag.replace(/^v/, '')

  // --- Compare versions ---
  const order = compareVersions(currentVersion, targetVersion)

  if (order === 'equal' && !opts.force) {
    ok(`Already on v${currentVersion} — nothing to do.`)
    return
  }
  if (order === 'newer' && !opts.force) {
    ok(`Your version (v${currentVersion}) is ahead of ${targetTag} — nothing to do.`)
    return
  }

  if (opts.check) {
    if (order === 'older') {
      console.log()
      console.log(chalk.yellow(`  Update available: v${currentVersion} → ${targetTag}`))
      console.log(chalk.dim('  Run `taco update` to install.'))
    } else {
      ok(`v${currentVersion} is up to date.`)
    }
    return
  }

  // --- Download archive ---
  const archiveName = `taco-release-${targetTag}.tar.gz`
  const archiveUrl = `${REPO_URL}/releases/download/${targetTag}/${archiveName}`

  const tmpDir = join(tmpdir(), `taco-update-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    info(`Downloading ${archiveName}...`)
    const archivePath = join(tmpDir, archiveName)
    await downloadFile(archiveUrl, archivePath)
    ok('Download complete.')

    // --- Extract ---
    info('Extracting...')
    const result = spawnSync('tar', ['xz', '-C', tmpDir, '-f', archivePath], {
      stdio: 'inherit',
      timeout: 60_000,
    })
    if (result.status !== 0) {
      throw new Error('Failed to extract archive')
    }

    // --- Run installer ---
    const installerPath = join(tmpDir, 'install.sh')
    if (!existsSync(installerPath)) {
      throw new Error('install.sh not found in downloaded archive')
    }

    console.log()
    console.log(chalk.bold(`Updating to ${targetTag}...`))
    console.log()
    runInstaller(installerPath, targetTag)
  } finally {
    // Clean up temp dir
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Non-fatal
    }
  }
}

// ─── Command registration ──────────────────────────────────────────────────────

export function registerUpdateCommand(program: Command): void {
  const cmd = program
    .command('update')
    .description('Update TACO to the latest (or a specific) version')
    .option('--check', 'Check for updates without installing')
    .option('--version <tag>', 'Update to a specific version (e.g. v0.1.4)')
    .option('--force', 'Force update even if already on the target version')

  cmd.action(async (opts: UpdateOptions) => {
    // Read current version from package.json (already loaded in index.ts, but
    // we import directly here to keep this module self-contained)
    let currentVersion = '0.0.0'
    try {
      const { readFileSync } = await import('fs')
      const { fileURLToPath } = await import('url')
      const { dirname, join: pathJoin } = await import('path')

      const modFile = fileURLToPath(import.meta.url)
      let dir = dirname(modFile)
      for (let i = 0; i < 5; i++) {
        const candidate = pathJoin(dir, 'package.json')
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: string }
          currentVersion = pkg.version ?? currentVersion
          break
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    } catch {
      // fall through with default
    }

    console.log()
    console.log(chalk.bold('🌮 TACO — Update'))
    console.log()
    console.log(chalk.dim(`  Current version: v${currentVersion}`))
    console.log()

    await runUpdate(currentVersion, opts)
  })
}
