#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  RELEASE_VERIFICATION_SCHEMA,
  RELEASE_VERIFICATION_STEPS,
  validateReleaseSourceState,
} from './lib/release-source-verification.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const receiptPath = join(repositoryRoot, 'build', 'test-results', 'release-source-verification.json')

async function git(...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: repositoryRoot })
  return stdout.trim()
}

async function sourceState() {
  const [branch, commit, originCommit, trackedStatus, rootPackage, desktopPackage] = await Promise.all([
    git('branch', '--show-current'),
    git('rev-parse', 'HEAD'),
    git('rev-parse', 'origin/main'),
    git('status', '--porcelain', '--untracked-files=no'),
    readFile(join(repositoryRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(repositoryRoot, 'desktop', 'package.json'), 'utf8').then(JSON.parse),
  ])
  return {
    branch,
    commit,
    originCommit,
    trackedStatus,
    rootVersion: String(rootPackage.version ?? ''),
    desktopVersion: String(desktopPackage.version ?? ''),
  }
}

function runStep(step) {
  let command = step.command
  let args = step.args
  if (process.platform === 'win32' && command === 'npm') {
    const npmCLI = String(process.env.npm_execpath ?? '').trim()
    if (!npmCLI) throw new Error('npm_execpath is required on Windows')
    command = process.execPath
    args = [npmCLI, ...args]
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' })
    child.once('error', rejectPromise)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${step.id} failed with status ${code}`)))
  })
}

if (process.argv.includes('--print-plan')) {
  process.stdout.write(`${JSON.stringify({
    receiptPath,
    steps: RELEASE_VERIFICATION_STEPS,
  }, null, 2)}\n`)
  process.exit(0)
}

await execFileAsync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: repositoryRoot })
await rm(receiptPath, { force: true })
const before = await sourceState()
const initialIssues = validateReleaseSourceState(before)
if (initialIssues.length > 0) throw new Error(initialIssues.join('; '))

const results = []
for (const step of RELEASE_VERIFICATION_STEPS) {
  const startedAt = Date.now()
  await runStep(step)
  results.push({ id: step.id, durationMs: Date.now() - startedAt })
}

const after = await sourceState()
const finalIssues = validateReleaseSourceState(after)
if (after.commit !== before.commit) finalIssues.push('HEAD changed while release verification was running')
if (finalIssues.length > 0) throw new Error(finalIssues.join('; '))

const receipt = {
  schema: RELEASE_VERIFICATION_SCHEMA,
  passed: true,
  branch: after.branch,
  commit: after.commit,
  version: after.rootVersion,
  verifiedAt: new Date().toISOString(),
  steps: results,
}
await mkdir(dirname(receiptPath), { recursive: true })
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`release source verified once: ${after.commit}\nreceipt: ${receiptPath}\n`)
