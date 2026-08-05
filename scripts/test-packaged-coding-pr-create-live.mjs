#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'coding-pr-create-live.json')
const appReportPath = join(resultsDirectory, 'coding-pr-create-live-app-report.json')
const liveSmokeEnabled = process.env.MILKSU_CODING_PR_CREATE_LIVE_SMOKE === '1'
const expectedRepo = 'MilkSU-Official/milksu'
const startupTimeoutMs = 90_000
const shutdownTimeoutMs = 20_000

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

async function exists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function readJSON(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function execText(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout.trim()
}

async function git(args, options = {}) {
  return await execText('git', args, {
    cwd: options.cwd || repositoryRoot,
    env: options.env || process.env,
  })
}

async function ghJSON(args, options = {}) {
  return JSON.parse(await execText('gh', args, {
    cwd: options.cwd || repositoryRoot,
    env: options.env || process.env,
  }))
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode, timedOut: false }
  }
  return new Promise(resolveExit => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit({ code: null, signal: null, timedOut: true })
    }, timeoutMs)
    function onExit(code, signal) {
      clearTimeout(timer)
      resolveExit({ code, signal, timedOut: false })
    }
    child.once('exit', onExit)
  })
}

function spawnPackagedApp({ fixtureHome, fixtureTemp, appDataDirectory, workspace, reportPath, title, body }) {
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  const child = spawn(appExecutable, [], {
    cwd: fixtureHome,
    env: {
      HOME: process.env.HOME || fixtureHome,
      TMPDIR: fixtureTemp,
      PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      MILKSU_APPDATA_DIR: appDataDirectory,
      MILKSU_ENABLE_MANAGED_LABS: '0',
      MILKSU_INSTANCE_ID: `coding-pr-create-live-${process.pid}-${Date.now()}`,
      MILKSU_CODING_PR_CREATE_SMOKE_RESULT: reportPath,
      MILKSU_CODING_PR_CREATE_SMOKE_WORKSPACE: workspace,
      MILKSU_CODING_PR_CREATE_SMOKE_TITLE: title,
      MILKSU_CODING_PR_CREATE_SMOKE_BODY: body,
      MILKSU_CODING_PR_CREATE_SMOKE_QUIT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.once('error', error => {
    spawnError = error
  })
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length
  })
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length
  })
  return {
    child,
    spawnError: () => spawnError,
    app: () => ({
      pid: child.pid,
      stdoutBytes,
      stderrBytes,
      exitCode: child.exitCode,
      exitSignal: child.signalCode,
    }),
  }
}

async function waitForReport(path, app) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (app.spawnError()) throw app.spawnError()
    if (app.child.exitCode !== null || app.child.signalCode !== null) {
      throw new Error(
        `packaged App exited before Coding PR create report `
          + `(code=${app.child.exitCode}, signal=${app.child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `Coding PR create report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return readJSON(path)
}

function assertAppReport(report, expected) {
  assert(report.schema === 'milksu-coding-pr-create-packaged-smoke/v1', 'unexpected App report schema')
  assert(!report.error, `App Coding PR create smoke failed: ${report.error}`)
  assert(report.dataDirectory === expected.appDataDirectory, `unexpected App data directory: ${report.dataDirectory}`)
  assert(report.workspace === expected.workspace, `unexpected workspace: ${report.workspace}`)
  assert(report.preview?.repository === expectedRepo, 'preview repository changed')
  assert(report.preview?.private === true, 'preview repo was not private')
  assert(report.preview?.sourceBranch === expected.branch, 'preview branch changed')
  assert(report.preview?.headCommit === expected.head, 'preview head changed')
  assert(!report.preview?.existingNumber, 'preview unexpectedly found an existing PR')
  assert(report.publish?.repository === expectedRepo, 'publish repository changed')
  assert(report.publish?.sourceBranch === expected.branch, 'publish branch changed')
  assert(report.publish?.headCommit === expected.head, 'publish head changed')
  assert(report.publish?.created === true, 'publish did not create a new PR')
  assert(report.publish?.verified === true, 'publish did not verify PR readback')
  assert(report.publish?.draft === true, 'created PR was not a draft')
  assert(report.publish?.state === 'OPEN', 'created PR was not open at readback')
  assert(Number(report.publish?.number) > 0, 'created PR number missing')
  assert(String(report.publish?.url || '').startsWith('https://github.com/MilkSU-Official/milksu/pull/'), 'created PR URL outside MilkSU repo')
  for (const [gate, value] of Object.entries(report.gates || {})) {
    assert(value === true, `Coding PR create gate ${gate} was not true`)
  }
  const serialized = JSON.stringify(report)
  assert(!/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]/.test(serialized), 'report leaked token-shaped content')
  assert(!serialized.includes('confirmationToken"'), 'report included the raw confirmation token field')
}

async function prepareTemporaryBranch({ fixtureRoot, branch, originURL }) {
  const workspace = join(fixtureRoot, 'workspace')
  await git(['clone', '--no-local', repositoryRoot, workspace])
  await git(['remote', 'set-url', 'origin', originURL], { cwd: workspace })
  await git(['checkout', '-b', branch], { cwd: workspace })
  await git(['config', 'user.email', 'milksu-pr-create-smoke@example.invalid'], { cwd: workspace })
  await git(['config', 'user.name', 'MilkSU PR Create Smoke'], { cwd: workspace })
  const markerDirectory = join(workspace, 'tests', 'fixtures', 'pr-create-smoke')
  await fs.mkdir(markerDirectory, { recursive: true })
  await fs.writeFile(
    join(markerDirectory, `${branch.split('/').at(-1)}.md`),
    [
      '# MilkSU PR creation live smoke',
      '',
      `Branch: ${branch}`,
      `Created: ${new Date().toISOString()}`,
      '',
      'This file is created only on a temporary private smoke branch.',
      '',
    ].join('\n'),
  )
  await git(['add', 'tests/fixtures/pr-create-smoke'], { cwd: workspace })
  await git(['commit', '-m', 'test: create packaged pr smoke branch'], { cwd: workspace })
  await git(['push', '-u', 'origin', branch], { cwd: workspace })
  const head = await git(['rev-parse', 'HEAD'], { cwd: workspace })
  return { workspace, head }
}

async function closePullRequestAndDeleteBranch({ number, branch }) {
  const result = {
    attempted: false,
    closed: false,
    branchDeleted: false,
    closeError: '',
    deleteError: '',
  }
  if (!number) return result
  result.attempted = true
  try {
    await execText('gh', [
      'pr',
      'close',
      String(number),
      '--repo',
      expectedRepo,
      '--delete-branch',
      '--comment',
      'Closing automated MilkSU packaged PR creation smoke.',
    ])
    result.closed = true
  } catch (cause) {
    result.closeError = cause instanceof Error ? cause.message : String(cause)
  }
  try {
    const remoteBranch = await git(['ls-remote', 'origin', `refs/heads/${branch}`])
    if (remoteBranch.trim()) {
      await git(['push', 'origin', '--delete', branch])
    }
    const remaining = await git(['ls-remote', 'origin', `refs/heads/${branch}`])
    result.branchDeleted = remaining.trim() === ''
  } catch (cause) {
    result.deleteError = cause instanceof Error ? cause.message : String(cause)
  }
  return result
}

async function verifyClosedPullRequest({ number, branch, head }) {
  const view = await ghJSON([
    'pr',
    'view',
    String(number),
    '--repo',
    expectedRepo,
    '--json',
    'number,url,state,isDraft,headRefName,headRefOid,baseRefName',
  ])
  assert(view.number === number, 'closed PR number changed')
  assert(view.state === 'CLOSED', `temporary PR was not closed: ${view.state}`)
  assert(view.isDraft === true, 'temporary PR did not remain draft')
  assert(view.headRefName === branch, 'closed PR branch changed')
  assert(view.headRefOid === head, 'closed PR head changed')
  const remoteBranch = await git(['ls-remote', 'origin', `refs/heads/${branch}`])
  assert(remoteBranch.trim() === '', 'temporary remote branch still exists after cleanup')
  return view
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Coding PR create live smoke; set MILKSU_CODING_PR_CREATE_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Coding PR create live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged Coding PR create live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged artifact: ${appExecutable}`)
  await execText('gh', ['--version'])
  const activeStatus = await git(['status', '--porcelain=v1'])
  assert(activeStatus === '', 'Coding PR create live smoke requires a clean active worktree')
  const activeBranch = await git(['branch', '--show-current'])
  assert(activeBranch === 'codex/authorized-learning-foundation', `unexpected active branch: ${activeBranch}`)
  const activeHead = await git(['rev-parse', 'HEAD'])
  const activeUpstreamHead = await git(['rev-parse', '@{upstream}'])
  assert(activeHead === activeUpstreamHead, 'active branch must be pushed before PR create live smoke')
  const originURL = await git(['remote', 'get-url', 'origin'])

  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'milksu-coding-pr-create-live-'))
  const fixtureTemp = join(fixtureRoot, 'tmp')
  const appDataDirectory = join(fixtureRoot, 'app-data')
  const rawReportPath = join(fixtureRoot, 'coding-pr-create-app-report.json')
  const branch = `codex/pr-create-smoke-${Date.now()}-${process.pid}`
  const title = 'test: verify MilkSU draft PR creation smoke'
  const body = [
    'Automated packaged MilkSU PR creation smoke.',
    '',
    '- Private MilkSU repository only.',
    '- Temporary branch is closed and deleted after verification.',
    '- No merge or ready-for-review transition.',
  ].join('\n')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(appDataDirectory, { recursive: true, mode: 0o700 })
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })

  let app
  let appReport
  let cleanup = { attempted: false, closed: false, branchDeleted: false }
  try {
    const prepared = await prepareTemporaryBranch({ fixtureRoot, branch, originURL })
    app = spawnPackagedApp({
      fixtureHome: fixtureRoot,
      fixtureTemp,
      appDataDirectory,
      workspace: prepared.workspace,
      reportPath: rawReportPath,
      title,
      body,
    })
    appReport = await waitForReport(rawReportPath, app)
    await fs.copyFile(rawReportPath, appReportPath)
    assertAppReport(appReport, {
      appDataDirectory,
      workspace: prepared.workspace,
      branch,
      head: prepared.head,
    })
    const exit = await waitForExit(app.child, shutdownTimeoutMs)
    assert(!exit.timedOut, 'packaged App did not quit after Coding PR create smoke')
    assert(exit.code === 0, `packaged App did not exit cleanly: ${JSON.stringify(exit)}`)
    cleanup = await closePullRequestAndDeleteBranch({
      number: appReport.publish.number,
      branch,
    })
    assert(cleanup.closed, `temporary PR cleanup failed: ${cleanup.closeError}`)
    assert(cleanup.branchDeleted, `temporary branch cleanup failed: ${cleanup.deleteError}`)
    const closedPR = await verifyClosedPullRequest({
      number: appReport.publish.number,
      branch,
      head: prepared.head,
    })
    const report = {
      schema: 'milksu-coding-pr-create-live/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
      },
      activeBranch,
      activeHead,
      temporaryBranch: branch,
      temporaryHead: prepared.head,
      app: {
        ...app.app(),
        gracefulExit: true,
      },
      appReport: relative(repositoryRoot, appReportPath),
      pullRequest: {
        number: appReport.publish.number,
        url: appReport.publish.url,
        created: appReport.publish.created,
        verified: appReport.publish.verified,
        finalState: closedPR.state,
        draft: closedPR.isDraft,
      },
      cleanup,
      gates: {
        temporaryBranchPushed: true,
        packagedAppCreatedPrivateDraftPR: appReport.gates.createdDraftPr === true,
        packagedAppVerifiedPRReadback: appReport.gates.publishVerifiedReadback === true,
        confirmationTokenConsumedOnce: appReport.gates.confirmationTokenUsed === true,
        temporaryPRClosed: cleanup.closed === true && closedPR.state === 'CLOSED',
        temporaryBranchDeleted: cleanup.branchDeleted === true,
        rawTokenOmittedFromReport: appReport.gates.noCredentialLeak === true,
      },
      limitations: [
        'This smoke creates a real private Draft PR on a temporary MilkSU branch, then closes it and deletes the branch.',
        'It does not merge, mark ready for review, or write to any referenced open-source repository.',
        'It uses the packaged App facade path rather than the visible WebView PR buttons; WebView reuse is covered by coding-pr-publish-webview-live.',
      ],
    }
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('Packaged Coding PR create live smoke passed.')
    console.log(`  temporary branch: ${branch}`)
    console.log(`  PR: #${appReport.publish.number} ${appReport.publish.url}`)
    console.log(`  cleanup: closed=${cleanup.closed} branchDeleted=${cleanup.branchDeleted}`)
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    if (app?.child && app.child.exitCode === null && app.child.signalCode === null) {
      app.child.kill('SIGTERM')
      const exit = await waitForExit(app.child, 5_000)
      if (exit.timedOut) app.child.kill('SIGKILL')
    }
    if (appReport?.publish?.number && (!cleanup.closed || !cleanup.branchDeleted)) {
      await closePullRequestAndDeleteBranch({
        number: appReport.publish.number,
        branch,
      }).catch(() => undefined)
    } else {
      const remoteBranch = await git(['ls-remote', 'origin', `refs/heads/${branch}`]).catch(() => '')
      if (remoteBranch.trim()) {
        await git(['push', 'origin', '--delete', branch]).catch(() => undefined)
      }
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
