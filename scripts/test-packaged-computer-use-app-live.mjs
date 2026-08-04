#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'computer-use-app-live.json')
const liveSmokeEnabled = process.env.MILKSU_COMPUTER_USE_APP_LIVE_SMOKE === '1'
const targetBundleId = 'com.apple.calculator'
const targetName = 'Calculator'
const startupTimeoutMs = 45_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `computer-use-app-live-${process.pid}-${Date.now()}`

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

async function waitForAppReport(path, child, spawnErrorRef) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (spawnErrorRef()) throw spawnErrorRef()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before Computer Use App smoke report (code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `Computer Use App smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function calculatorPID() {
  await execFileAsync('/usr/bin/open', ['-b', targetBundleId], { timeout: 5_000 })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync('/usr/bin/pgrep', ['-x', targetName], {
        encoding: 'utf8',
        timeout: 2_000,
      })
      const pid = Number(stdout.trim().split(/\s+/).at(-1))
      if (Number.isSafeInteger(pid) && pid > 1) return pid
    } catch {
      // Calculator can take a moment to appear after open(1).
    }
    await delay(100)
  }
  throw new Error('Calculator did not start')
}

function assertTarget(report, field, target) {
  assert(target?.bundleId === targetBundleId, `${field} bundle changed: ${target?.bundleId}`)
  assert(Number(target?.pid) === report.requestedPid, `${field} PID changed: ${target?.pid}`)
  assert(Number(target?.windowId) === Number(report.selectedTarget?.windowId), `${field} window changed: ${target?.windowId}`)
}

async function assertAppSmokeReport(report, appDataDirectory, conversationId) {
  assert(report.schema === 'milksu-computer-use-app-smoke/v1', 'unexpected Computer Use App smoke schema')
  assert(!report.error, `Computer Use App smoke failed: ${report.error}`)
  assert(report.conversationId === conversationId, `Computer Use conversation changed: ${report.conversationId}`)
  assert(report.requestedBundleId === targetBundleId, `requested bundle changed: ${report.requestedBundleId}`)
  assert(Number.isSafeInteger(report.requestedPid) && report.requestedPid > 1, 'missing requested Calculator PID')
  assert(report.targetCount >= 1, 'Computer Use App smoke did not list visible targets')
  assertTarget(report, 'selected target', report.selectedTarget)

  assert(report.initialStatus?.available === true, 'Computer Use App smoke did not see an available manager')
  assert(
    report.startedStatus?.enabled === true && report.startedStatus?.phase === 'ready',
    `Computer Use App smoke did not start a ready session: ${JSON.stringify(report.startedStatus)}`,
  )
  assert(report.startedStatus?.conversationId === conversationId, 'started session conversation changed')
  assertTarget(report, 'started status target', report.startedStatus?.target)
  assert(
    report.confirmedStatus?.enabled === true && report.confirmedStatus?.phase === 'ready',
    `Computer Use App smoke did not confirm ready status: ${JSON.stringify(report.confirmedStatus)}`,
  )
  assertTarget(report, 'confirmed status target', report.confirmedStatus?.target)
  assert(report.descriptorEnabled === true, 'Computer Use App smoke descriptor was not enabled')
  assert(report.descriptor?.sessionId, 'Computer Use App smoke descriptor missing session id')
  assert(report.descriptor?.targetBundleId === targetBundleId, 'Computer Use descriptor bundle changed')
  assert(Number(report.descriptor?.targetPid) === report.requestedPid, 'Computer Use descriptor PID changed')
  assert(Number(report.descriptor?.targetWindowId) === Number(report.selectedTarget?.windowId), 'Computer Use descriptor window changed')
  assert(report.socketPathExists === true, 'Computer Use App smoke did not prove the driver socket existed')
  assert(
    report.stoppedStatus?.enabled === false &&
      !report.stoppedStatus?.conversationId &&
      !report.stoppedStatus?.sessionId,
    `Computer Use App smoke did not stop cleanly: ${JSON.stringify(report.stoppedStatus)}`,
  )

  const dataDirectory = String(report.dataDirectory || '')
  assert(
    dataDirectory === appDataDirectory || dataDirectory.startsWith(`${appDataDirectory}/`),
    `Computer Use App smoke escaped isolated App data directory: ${dataDirectory}`,
  )
  const serialized = JSON.stringify(report)
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'Computer Use App smoke report leaked key-shaped content')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Computer Use App live smoke; set MILKSU_COMPUTER_USE_APP_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Computer Use App live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const pid = await calculatorPID()
  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-computer-use-app-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(
    fixtureHome,
    'Library',
    'Application Support',
    'com.milksu.app',
  )
  const appReportPath = join(fixtureHome, 'computer-use-app-smoke.json')
  const conversationId = `computer-use-app-live-${Date.now().toString(36)}`
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })

  let child
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  try {
    child = spawn(appExecutable, [], {
      cwd: fixtureHome,
      env: {
        HOME: fixtureHome,
        TMPDIR: fixtureTemp,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        MILKSU_ENABLE_MANAGED_LABS: '0',
        MILKSU_INSTANCE_ID: isolatedInstanceId,
        MILKSU_COMPUTER_USE_APP_SMOKE_RESULT: appReportPath,
        MILKSU_COMPUTER_USE_APP_SMOKE_CONVERSATION_ID: conversationId,
        MILKSU_COMPUTER_USE_APP_SMOKE_TARGET_BUNDLE_ID: targetBundleId,
        MILKSU_COMPUTER_USE_APP_SMOKE_TARGET_PID: String(pid),
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

    const appReport = await waitForAppReport(appReportPath, child, () => spawnError)
    await assertAppSmokeReport(appReport, appDataDirectory, conversationId)
    await fs.mkdir(resultsDirectory, { recursive: true })
    const report = {
      ...appReport,
      schema: 'milksu-computer-use-app-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        isolatedHome: true,
      },
      app: {
        stdoutBytes,
        stderrBytes,
      },
      gates: {
        packagedAppListedExternalTargets: true,
        exactExternalPidAndWindowSelected: true,
        appFacadeStartedSession: true,
        descriptorVisibleToRuntime: true,
        driverSocketObservedBeforeStop: true,
        appFacadeStoppedSession: true,
      },
    }
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after Computer Use App smoke')
    report.app.gracefulShutdown = gracefulShutdown
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })

    console.log('MilkSU packaged Computer Use App smoke passed.')
    console.log(`  target: ${targetBundleId} PID ${pid} Window ${appReport.selectedTarget.windowId}`)
    console.log('  app facade: list -> start -> status -> descriptor -> stop')
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const exit = await waitForExit(child, 2_000)
      if (exit.timedOut) {
        child.kill('SIGKILL')
        await waitForExit(child, 5_000)
      }
    }
    await fs.rm(fixtureHome, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
