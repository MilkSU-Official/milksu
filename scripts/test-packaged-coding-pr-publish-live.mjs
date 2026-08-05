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
const resultPath = join(resultsDirectory, 'coding-pr-publish-live.json')
const appReportPath = join(resultsDirectory, 'coding-pr-publish-live-app-report.json')
const liveSmokeEnabled = process.env.MILKSU_CODING_PR_PUBLISH_LIVE_SMOKE === '1'
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

async function git(args) {
  return await execText('git', args, { cwd: repositoryRoot })
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

function spawnPackagedApp({ fixtureHome, fixtureTemp, appDataDirectory, workspace, reportPath }) {
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  const child = spawn(appExecutable, [], {
    cwd: fixtureHome,
    env: {
      HOME: fixtureHome,
      TMPDIR: fixtureTemp,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      MILKSU_APPDATA_DIR: appDataDirectory,
      MILKSU_ENABLE_MANAGED_LABS: '0',
      MILKSU_INSTANCE_ID: `coding-pr-publish-live-${process.pid}-${Date.now()}`,
      MILKSU_CODING_PR_PUBLISH_SMOKE_RESULT: reportPath,
      MILKSU_CODING_PR_PUBLISH_SMOKE_WORKSPACE: workspace,
      MILKSU_CODING_PR_PUBLISH_SMOKE_TITLE: 'test: verify MilkSU draft PR publish flow',
      MILKSU_CODING_PR_PUBLISH_SMOKE_BODY: 'Packaged MilkSU PR publish smoke reused the existing private draft PR.',
      MILKSU_CODING_PR_PUBLISH_SMOKE_QUIT: '1',
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
        `packaged App exited before Coding PR publish report `
          + `(code=${app.child.exitCode}, signal=${app.child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `Coding PR publish report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return readJSON(path)
}

function assertAppReport(report, expectedHead) {
  assert(report.schema === 'milksu-coding-pr-publish-packaged-smoke/v1', 'unexpected App report schema')
  assert(!report.error, `App Coding PR publish smoke failed: ${report.error}`)
  assert(report.gates?.preparedPreview === true, 'App did not prepare PR preview')
  assert(report.gates?.previewForPrivateMilkSU === true, 'PR preview was not scoped to private MilkSU repo')
  assert(report.gates?.previewExistingDraftPR === true, 'PR preview did not find existing draft PR')
  assert(report.gates?.confirmationTokenIssued === true, 'PR preview did not issue a confirmation token')
  assert(report.gates?.publishedByAppFacade === true, 'App facade did not publish/reuse PR')
  assert(report.gates?.publishReusedExistingPr === true, 'App did not reuse existing draft PR')
  assert(report.gates?.publishVerifiedReadback === true, 'App did not verify PR readback')
  assert(report.gates?.confirmationTokenUsed === true, 'confirmation token was not consumed once')
  assert(report.gates?.noCredentialLeak === true, 'App report leaked credential-shaped content')
  assert(report.preview?.repository === 'MilkSU-Official/milksu', 'unexpected preview repository')
  assert(report.preview?.private === true, 'preview repository was not private')
  assert(report.preview?.headCommit === expectedHead, 'preview head did not match current HEAD')
  assert(report.preview?.existingNumber === 1, 'preview did not point at existing PR #1')
  assert(report.publish?.number === 1, 'publish did not return PR #1')
  assert(report.publish?.url === 'https://github.com/MilkSU-Official/milksu/pull/1', 'unexpected PR URL')
  assert(report.publish?.created === false, 'publish created a new PR instead of reusing existing one')
  assert(report.publish?.verified === true, 'publish result was not verified')
  const serialized = JSON.stringify(report)
  assert(!/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]/.test(serialized), 'report leaked token-shaped content')
  assert(!serialized.includes('confirmationToken"'), 'report included the raw confirmation token field')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Coding PR publish live smoke; set MILKSU_CODING_PR_PUBLISH_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Coding PR publish live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged Coding PR publish live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged artifact: ${appExecutable}`)
  const status = await git(['status', '--porcelain=v1'])
  assert(status === '', 'Coding PR publish live smoke requires a clean committed worktree')
  const branch = await git(['branch', '--show-current'])
  assert(branch === 'codex/authorized-learning-foundation', `unexpected branch: ${branch}`)
  const head = await git(['rev-parse', 'HEAD'])
  const upstreamHead = await git(['rev-parse', '@{upstream}'])
  assert(head === upstreamHead, 'current branch must be pushed before PR publish live smoke')

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-coding-pr-publish-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'app-data')
  const rawReportPath = join(fixtureHome, 'coding-pr-publish-app-report.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })

  const app = spawnPackagedApp({
    fixtureHome,
    fixtureTemp,
    appDataDirectory,
    workspace: repositoryRoot,
    reportPath: rawReportPath,
  })
  try {
    const appReport = await waitForReport(rawReportPath, app)
    assertAppReport(appReport, head)
    const exit = await waitForExit(app.child, shutdownTimeoutMs)
    assert(!exit.timedOut, 'packaged App did not quit after Coding PR publish smoke')
    assert(exit.code === 0, `packaged App did not exit cleanly: ${JSON.stringify(exit)}`)
    const report = {
      schema: 'milksu-coding-pr-publish-live/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
      },
      branch,
      head,
      app: {
        ...app.app(),
        gracefulExit: true,
      },
      appReport: appReportPath ? relative(repositoryRoot, appReportPath) : null,
      gates: appReport.gates,
      pullRequest: {
        number: appReport.publish.number,
        url: appReport.publish.url,
        state: appReport.publish.state,
        draft: appReport.publish.draft,
        created: appReport.publish.created,
        verified: appReport.publish.verified,
      },
      limitations: [
        'This smoke uses the real packaged App facade and GitHub readback but requires an existing draft PR.',
        'It reuses PR #1 and does not create a new PR, merge it, or mark it ready for review.',
        'It does not exercise the human-clicked WebView button path.',
      ],
    }
    await fs.copyFile(rawReportPath, appReportPath)
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('Packaged Coding PR publish live smoke passed.')
    console.log(`  branch: ${branch}`)
    console.log(`  head: ${head.slice(0, 12)}`)
    console.log(`  PR: #${appReport.publish.number} ${appReport.publish.url}`)
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    if (app.child.exitCode === null && app.child.signalCode === null) {
      app.child.kill('SIGTERM')
      const exit = await waitForExit(app.child, 5_000)
      if (exit.timedOut) app.child.kill('SIGKILL')
    }
    await fs.rm(fixtureHome, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
