import type { Command } from 'commander'
import chalk from 'chalk'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, renameSync, chmodSync, createWriteStream } from 'fs'
import { tmpdir, platform, arch } from 'os'
import { join, basename } from 'path'
import { pipeline } from 'stream/promises'
import { getColors } from '../../theme/index.js'
import { completionCachePath } from './completion.js'

const REPO = 'bulga138/taco'
const REPO_URL = `https://github.com/${REPO}`

// ─── Platform detection ───────────────────────────────────────────────────────

function detectOS(): string {
  switch (platform()) {
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    case 'win32':
      return 'windows'
    default:
      return 'unknown'
  }
}

function detectArch(): string {
  switch (arch()) {
    case 'x64':
      return 'x64'
    case 'arm64':
      return 'arm64'
    default:
      return 'unknown'
  }
}

/**
 * Returns true when the current process is a Bun-compiled standalone binary
 * (i.e. process.execPath points at the taco binary itself, not node/bun).
 */
function isStandaloneBinary(): boolean {
  const execName = basename(process.execPath).toLowerCase()
  // Standalone binary: execPath name starts with "taco"
  // Source installs: execPath is "node", "bun", etc.
  return execName.startsWith('taco')
}

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

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'taco-cli/update' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ─── Checksum verification ────────────────────────────────────────────────────

async function sha256ofFile(filePath: string): Promise<string> {
  const { createHash } = await import('crypto')
  const { createReadStream } = await import('fs')

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// ─── Atomic self-replacement ──────────────────────────────────────────────────

/**
 * Replace the current binary atomically:
 * - Unix: rename() is atomic on the same filesystem. The running process
 *   keeps its inode until it exits — safe to overwrite the path.
 * - Windows: rename the old binary out of the way first, then place the new one.
 */
function replaceBinary(tmpPath: string, binaryPath: string): void {
  if (platform() === 'win32') {
    const oldPath = binaryPath + '.old'
    // Remove stale .old if present
    try {
      if (existsSync(oldPath)) rmSync(oldPath, { force: true })
    } catch {
      // non-fatal
    }
    renameSync(binaryPath, oldPath)
    renameSync(tmpPath, binaryPath)
    // Schedule cleanup of .old on next tick (after process exits it won't matter)
    setImmediate(() => {
      try {
        rmSync(oldPath, { force: true })
      } catch {
        // best-effort
      }
    })
  } else {
    renameSync(tmpPath, binaryPath)
    try {
      chmodSync(binaryPath, 0o755)
    } catch {
      // non-fatal
    }
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
  const warn = (msg: string) => process.stderr.write(chalk.yellow(`  [WARN] ${msg}\n`))
  const err = (msg: string) => process.stderr.write(chalk.red(`  [ERROR] ${msg}\n`))

  // --- Detect install type ---
  if (!isStandaloneBinary()) {
    info(
      'Source-based install detected. To update, re-run the installer:\n' +
        '  curl -sSL https://raw.githubusercontent.com/bulga138/taco/master/install.sh | bash'
    )
    return
  }

  // --- Detect platform ---
  const os = detectOS()
  const architecture = detectArch()

  if (os === 'unknown' || architecture === 'unknown') {
    err(`Unsupported platform: ${platform()}/${arch()}`)
    process.exit(1)
  }
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

  // --- Build binary URL ---
  const ext = os === 'windows' ? '.exe' : ''
  const binaryName = `taco-${targetVersion}-${os}-${architecture}${ext}`
  const binaryUrl = `${REPO_URL}/releases/download/${targetTag}/${binaryName}`
  const checksumUrl = `${binaryUrl}.sha256`

  info(`Downloading ${binaryName}...`)

  const tmpDir = join(tmpdir(), `taco-update-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const tmpBinary = join(tmpDir, binaryName)

  try {
    // Download binary
    await downloadFile(binaryUrl, tmpBinary)
    ok('Download complete.')

    // Verify checksum (optional — non-fatal if not available)
    const checksumText = await fetchText(checksumUrl)
    if (checksumText) {
      info('Verifying checksum...')
      const expected = checksumText.trim().split(/\s+/)[0]
      const actual = await sha256ofFile(tmpBinary)
      if (expected && expected !== actual) {
        err(`Checksum mismatch!\n  Expected: ${expected}\n  Got:      ${actual}`)
        process.exit(1)
      }
      ok('Checksum verified.')
    } else {
      warn('No checksum file available, skipping verification.')
    }

    // Replace the binary
    const binaryPath = process.execPath
    info(`Installing to ${binaryPath}...`)
    replaceBinary(tmpBinary, binaryPath)
    ok(`Updated to ${targetTag}.`)

    // Regenerate cached completion file if it exists
    for (const shell of ['bash', 'zsh', 'fish'] as const) {
      const cachePath = completionCachePath(shell)
      if (existsSync(cachePath)) {
        try {
          const result = spawnSync(
            process.execPath,
            [process.argv[1], 'completion', `--${shell}`, '--install'],
            {
              timeout: 15_000,
              encoding: 'utf8',
            }
          )
          if (result.status === 0) {
            ok(`Regenerated ${shell} completion cache.`)
          }
        } catch {
          // Non-fatal
        }
      }
    }
  } catch (e) {
    err(`Update failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  } finally {
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
      // fall through to binary detection
    }

    if (currentVersion === '0.0.0') {
      try {
        const { spawnSync } = await import('child_process')
        const result = spawnSync(process.execPath, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
        })
        if (result.status === 0 && result.stdout) {
          const match = result.stdout.trim().match(/v?(\d+\.\d+\.\d+)/)
          if (match) {
            currentVersion = match[1]
          }
        }
      } catch {
        // Give up, use default
      }
    }

    console.log()
    console.log(chalk.bold('🌮 TACO — Update'))
    console.log()
    console.log(chalk.dim(`  Current version: v${currentVersion}`))
    console.log()

    await runUpdate(currentVersion, opts)
  })
}
