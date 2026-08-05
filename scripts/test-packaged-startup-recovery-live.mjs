#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'startup-recovery-live.json')
const appReportPath = join(resultsDirectory, 'startup-recovery-live-app-report.json')
const liveSmokeEnabled = process.env.MILKSU_STARTUP_RECOVERY_LIVE_SMOKE === '1'
const startupTimeoutMs = 30_000
const shutdownTimeoutMs = 20_000
const isolatedInstanceId = `startup-recovery-live-${process.pid}-${Date.now()}`

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

function spawnPackagedApp({ fixtureHome, fixtureTemp, appDataDirectory, label, env = {} }) {
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
      MILKSU_INSTANCE_ID: `${isolatedInstanceId}-${label}`,
      ...env,
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
    app: () => ({
      pid: child.pid,
      stdoutBytes,
      stderrBytes,
      exitCode: child.exitCode,
      exitSignal: child.signalCode,
    }),
    spawnError: () => spawnError,
  }
}

async function waitForJSONFile(path, spawnRef, child, label, predicate = () => true) {
  const deadline = performance.now() + startupTimeoutMs
  while (true) {
    if (spawnRef()) throw spawnRef()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before ${label} became available `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    if (await exists(path)) {
      const value = await readJSON(path)
      if (predicate(value)) return value
    }
    assert(performance.now() < deadline, `${label} exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
}

async function waitForLifespanState(path, spawnRef, child, label, predicate) {
  return waitForJSONFile(path, spawnRef, child, label, predicate)
}

async function waitForCleanMarker(path) {
  const deadline = performance.now() + shutdownTimeoutMs
  while (true) {
    if (await exists(path)) {
      const value = await readJSON(path)
      if (value.lastExit === 'clean') return value
    }
    assert(performance.now() < deadline, `clean lifespan marker exceeded ${shutdownTimeoutMs} ms`)
    await delay(100)
  }
}

function assertStartupRecoveryReport(report, initialPid, recoveryPid) {
  assert(report.schema === 'milksu-startup-recovery-packaged-smoke/v1', 'unexpected startup recovery schema')
  assert(!report.error, `startup recovery smoke failed: ${report.error}`)
  assert(report.startup?.previousExit === 'abnormal', 'previous exit was not classified as abnormal')
  assert(report.startup?.previousPid === initialPid, 'previous pid was not preserved')
  assert(report.startup?.consecutiveAbnormalExits >= 1, 'abnormal exit count did not increment')
  assert(report.persisted?.lastExit === 'running', 'current run was not marked running')
  assert(report.persisted?.pid === recoveryPid, 'current pid was not persisted')
  for (const [gate, value] of Object.entries(report.gates || {})) {
    assert(value === true, `startup recovery gate failed: ${gate}`)
  }
  const serialized = JSON.stringify(report)
  for (const forbidden of ['api_key', 'authorization', 'bearer ', 'sk-', 'tool output', 'message content']) {
    assert(!serialized.toLowerCase().includes(forbidden), `startup recovery report leaked ${forbidden}`)
  }
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged startup recovery live smoke; set MILKSU_STARTUP_RECOVERY_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged startup recovery live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged startup recovery live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged artifact: ${appExecutable}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-startup-recovery-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'app-data')
  const lifespanPath = join(appDataDirectory, 'lifespan.json')
  const rawAppReportPath = join(fixtureHome, 'startup-recovery-report.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })

  const crashSeed = spawnPackagedApp({
    fixtureHome,
    fixtureTemp,
    appDataDirectory,
    label: 'crash-seed',
  })
  const firstRunning = await waitForLifespanState(
    lifespanPath,
    crashSeed.spawnError,
    crashSeed.child,
    'initial running lifespan marker',
    state => state.lastExit === 'running' && state.pid === crashSeed.child.pid,
  )
  crashSeed.child.kill('SIGKILL')
  const crashExit = await waitForExit(crashSeed.child, shutdownTimeoutMs)
  assert(!crashExit.timedOut, 'crash seed App did not exit after SIGKILL')
  assert(crashExit.signal === 'SIGKILL', `crash seed exited unexpectedly: ${JSON.stringify(crashExit)}`)

  const recovery = spawnPackagedApp({
    fixtureHome,
    fixtureTemp,
    appDataDirectory,
    label: 'recovery',
    env: {
      MILKSU_STARTUP_RECOVERY_SMOKE_RESULT: rawAppReportPath,
      MILKSU_STARTUP_RECOVERY_SMOKE_QUIT: '1',
    },
  })
  const appReport = await waitForJSONFile(
    rawAppReportPath,
    recovery.spawnError,
    recovery.child,
    'startup recovery smoke report',
  )
  assertStartupRecoveryReport(appReport, crashSeed.child.pid, recovery.child.pid)
  const recoveryExit = await waitForExit(recovery.child, shutdownTimeoutMs)
  assert(!recoveryExit.timedOut, 'recovery App did not quit after writing smoke report')
  const finalMarker = await waitForCleanMarker(lifespanPath)
  assert(finalMarker.pid === recovery.child.pid, 'clean marker did not belong to recovery process')
  assert(finalMarker.consecutiveAbnormalExits === 0, 'clean exit did not reset abnormal count')
  assert(finalMarker.lastCleanExitAt, 'clean marker missed lastCleanExitAt')

  await fs.copyFile(rawAppReportPath, appReportPath)
  await fs.chmod(appReportPath, 0o600)
  const finalReport = {
    schema: 'milksu-startup-recovery-live/v1',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      architecture: arch(),
      packagedApp: appBundle,
      isolatedAppData: appDataDirectory,
    },
    crashSeed: {
      pid: crashSeed.child.pid,
      lifespan: firstRunning,
      exit: crashExit,
      app: crashSeed.app(),
    },
    recovery: {
      pid: recovery.child.pid,
      previousExit: appReport.startup.previousExit,
      previousPid: appReport.startup.previousPid,
      consecutiveAbnormalExits: appReport.startup.consecutiveAbnormalExits,
      persistedDuringStartup: appReport.persisted,
      exit: recoveryExit,
      app: recovery.app(),
      evidence: {
        path: appReportPath,
        relativePath: relative(repositoryRoot, appReportPath),
      },
    },
    finalMarker,
    gates: {
      packagedAppLeftRunningMarkerBeforeCrash: true,
      killedProcessWasDetectedAsAbnormal: true,
      settingsStatusCarriesPreviousPidAndCount: true,
      recoveryRunMarkedCleanOnGracefulQuit: true,
      noSessionContentOrCredentialInReport: true,
    },
    limitations: [
      'This smoke verifies MilkSU lifespan startup recovery markers only.',
      'It does not replay unfinished Coding, CTF or CVE jobs; those use their own recovery smokes.',
    ],
  }
  const serialized = `${JSON.stringify(finalReport, null, 2)}\n`
  for (const forbidden of ['api_key', 'authorization', 'bearer ', 'sk-', 'tool output', 'message content']) {
    assert(!serialized.toLowerCase().includes(forbidden), `final report leaked ${forbidden}`)
  }
  await fs.writeFile(resultPath, serialized, { mode: 0o600 })
  console.log('MilkSU packaged startup recovery live smoke passed.')
  console.log(`  crash: pid ${crashSeed.child.pid} left ${firstRunning.lastExit} marker`)
  console.log(`  recovery: previousExit=${appReport.startup.previousExit}, previousPid=${appReport.startup.previousPid}`)
  console.log(`  final: marker=${finalMarker.lastExit}, abnormalCount=${finalMarker.consecutiveAbnormalExits}`)
  console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
