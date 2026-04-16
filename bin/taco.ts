#!/usr/bin/env node
import { createProgram } from '../src/cli/index.js'

const program = createProgram()

program.parseAsync(process.argv).catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\n🌮 TACO error: ${msg}\n`)
  process.exit(1)
})
