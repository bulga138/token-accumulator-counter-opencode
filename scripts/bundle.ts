/**
 * Cross-platform bundle script.
 * Reads the version from package.json and passes it as a --define constant
 * so the Bun-compiled binary never needs to locate package.json at runtime.
 *
 * Usage: bun scripts/bundle.ts [--target <bun-target>]
 *   e.g. bun scripts/bundle.ts --target bun-darwin-x64
 */

import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = join(import.meta.dir, '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
  version: string
}
const version = pkg.version

// Forward any extra args (e.g. --target bun-darwin-x64)
const extraArgs = process.argv.slice(2)

const args = [
  'build',
  './bin/taco.ts',
  '--outfile',
  './taco',
  '--compile',
  `--define`,
  `TACO_VERSION='${version}'`,
  ...extraArgs,
]

console.log(`Bundling TACO v${version}...`)
console.log(`bun ${args.join(' ')}`)

const result = spawnSync('bun', args, { stdio: 'inherit', cwd: repoRoot })
process.exit(result.status ?? 1)
