#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  buildReleaseWorkflowDispatches,
  validateReleaseVerificationReceipt,
} from './lib/release-source-verification.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const receiptPath = join(repositoryRoot, 'build', 'test-results', 'release-source-verification.json')
const repository = 'MilkSU-Official/milksu'

function option(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find(argument => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

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

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' })
    child.once('error', rejectPromise)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${command} exited with status ${code}`)))
  })
}

await execFileAsync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: repositoryRoot })
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
const state = await sourceState()
const issues = validateReleaseVerificationReceipt(receipt, state)
if (issues.length > 0) throw new Error(issues.join('; '))

const dispatches = buildReleaseWorkflowDispatches({
  commit: state.commit,
  version: state.rootVersion,
  uploadRelease: process.argv.includes('--upload-release'),
  useSelfHosted: process.argv.includes('--use-self-hosted'),
  releaseTitle: option('release-title', `MilkSU ${state.rootVersion} 内测版`),
  releaseNotes: option('release-notes', `MilkSU ${state.rootVersion} 内测版`),
  minimumVersion: option('minimum-version', '0.1.0'),
})

if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({ repository, source: state.commit, dispatches }, null, 2)}\n`)
  process.exit(0)
}

await run('gh', ['auth', 'status', '--hostname', 'github.com'])
for (const dispatch of dispatches) {
  await run('gh', [...dispatch.args, '--repo', repository])
}
process.stdout.write(`three platform release workflows dispatched for ${state.commit}\n`)
