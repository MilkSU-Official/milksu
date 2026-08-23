#!/usr/bin/env node

/**
 * Download the three GitHub-hosted packaging artifacts for the verified source
 * commit. From any machine with `gh` auth:
 *
 *   npm run release:collect -- --wait
 */

import { execFile } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { validateReleaseVerificationReceipt } from './lib/release-source-verification.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const receiptPath = join(repositoryRoot, 'build', 'test-results', 'release-source-verification.json')
const repository = 'MilkSU-Official/milksu'
const stagingDir = join(repositoryRoot, 'build', 'release', 'github')
const releaseDir = join(repositoryRoot, 'build', 'release')

const PACKAGES = [
  {
    workflow: 'macos-release.yml',
    artifact: 'MilkSU-macOS-arm64-installer',
    dest: join(stagingDir, 'macos'),
    filename: version => `MilkSU-macOS-arm64-${version}.dmg`,
  },
  {
    workflow: 'windows-release.yml',
    artifact: 'MilkSU-Windows-x64-installer',
    dest: join(stagingDir, 'windows'),
    filename: version => `MilkSU-Windows-x64-${version}-Setup.exe`,
  },
  {
    workflow: 'linux-release.yml',
    artifact: 'MilkSU-Linux-x64-deb-trial',
    dest: join(stagingDir, 'linux'),
    filename: version => `MilkSU-Linux-x64-${version}.deb`,
  },
]

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

async function ghJson(args) {
  const { stdout } = await execFileAsync('gh', args, { cwd: repositoryRoot })
  return JSON.parse(stdout)
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

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function latestRun(commit, workflow) {
  const runs = await ghJson([
    'run', 'list',
    '--repo', repository,
    '--commit', commit,
    '--workflow', workflow,
    '--limit', '10',
    '--json', 'databaseId,status,conclusion,headSha,url,event,createdAt',
  ])
  return runs.find(run => run.headSha === commit && run.event === 'workflow_dispatch') || null
}

async function waitForRun(commit, workflow, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const run = await latestRun(commit, workflow)
    if (!run) {
      process.stdout.write(`waiting for ${workflow} to appear for ${commit.slice(0, 7)}…\n`)
    } else if (run.status !== 'completed') {
      process.stdout.write(`waiting for ${workflow} (${run.status}) ${run.url}\n`)
    } else if (run.conclusion === 'success') {
      return run
    } else {
      throw new Error(`${workflow} ${run.conclusion}: ${run.url}`)
    }
    await sleep(20_000)
  }
  throw new Error(`timed out waiting for ${workflow} on ${commit}`)
}

async function downloadPackage(run, pack, version) {
  await rm(pack.dest, { recursive: true, force: true })
  await mkdir(pack.dest, { recursive: true })
  await execFileAsync('gh', [
    'run', 'download', String(run.databaseId),
    '--repo', repository,
    '-D', pack.dest,
    '-n', pack.artifact,
  ], { cwd: repositoryRoot })
  const expected = pack.filename(version)
  const names = await readdir(pack.dest)
  if (!names.includes(expected)) {
    throw new Error(`${pack.workflow} did not produce ${expected} (got ${names.join(', ') || '<empty>'})`)
  }
  return join(pack.dest, expected)
}

await execFileAsync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: repositoryRoot })
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
const state = await sourceState()
const issues = validateReleaseVerificationReceipt(receipt, state)
if (issues.length > 0) throw new Error(issues.join('; '))

const wait = !process.argv.includes('--no-wait')
const timeoutMs = Number(option('timeout-minutes', '180')) * 60_000
const results = []
for (const pack of PACKAGES) {
  const run = wait
    ? await waitForRun(state.commit, pack.workflow, timeoutMs)
    : await latestRun(state.commit, pack.workflow)
  if (!run) throw new Error(`no workflow_dispatch run for ${pack.workflow} on ${state.commit}`)
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`${pack.workflow} is ${run.status}/${run.conclusion || 'pending'}: ${run.url}`)
  }
  const file = await downloadPackage(run, pack, state.rootVersion)
  results.push({ workflow: pack.workflow, run: run.databaseId, url: run.url, file })
}

const mac = results.find(result => result.workflow === 'macos-release.yml')
if (mac) {
  await mkdir(releaseDir, { recursive: true })
  await copyFile(mac.file, join(releaseDir, `MilkSU-macOS-arm64-${state.rootVersion}.dmg`))
}

process.stdout.write(`${JSON.stringify({
  source: state.commit,
  version: state.rootVersion,
  results,
}, null, 2)}\n`)
