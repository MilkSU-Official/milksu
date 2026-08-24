#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const { stdout } = await execFileAsync('go', ['list', './...'], { cwd: repositoryRoot })
const packages = stdout.split('\n').map(line => line.trim()).filter(line => (
  line
  && !line.includes('/build')
  && !line.includes('/spikes/')
))
if (packages.length === 0) {
  throw new Error('no product Go packages to test')
}

const child = spawn('go', ['test', ...packages], { cwd: repositoryRoot, stdio: 'inherit' })
child.once('exit', code => process.exit(code ?? 1))
child.once('error', error => {
  console.error(error)
  process.exit(1)
})
