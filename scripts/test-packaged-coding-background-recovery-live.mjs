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
const resultPath = join(resultsDirectory, 'coding-background-recovery-live.json')
const startEvidencePath = join(resultsDirectory, 'coding-background-recovery-live-start.json')
const recoverEvidencePath = join(resultsDirectory, 'coding-background-recovery-live-recover.json')
const liveSmokeEnabled = process.env.MILKSU_CODING_BACKGROUND_RECOVERY_LIVE_SMOKE === '1'
const startupTimeoutMs = 45_000
const shutdownTimeoutMs = 20_000
const isolatedInstanceId = `coding-background-recovery-live-${process.pid}-${Date.now()}`
const conversationId = 'coding_background_recovery_live'
const providerKeySentinel = 'MILKSU_FAKE_PROVIDER_KEY_SENTINEL_FOR_BG_RECOVERY'

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

function spawnPackagedApp({
  fixtureHome,
  fixtureTemp,
  appDataDirectory,
  workspace,
  reportPath,
  heartbeatPath,
  phase,
  command,
  expectedPID,
}) {
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  const env = {
    HOME: fixtureHome,
    TMPDIR: fixtureTemp,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    DEEPSEEK_API_KEY: providerKeySentinel,
    MILKSU_APPDATA_DIR: appDataDirectory,
    MILKSU_ENABLE_MANAGED_LABS: '0',
    MILKSU_INSTANCE_ID: `${isolatedInstanceId}-${phase}`,
    MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_RESULT: reportPath,
    MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_PHASE: phase,
    MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_WORKSPACE: workspace,
    MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_CONVERSATION: conversationId,
    MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_HEARTBEAT: heartbeatPath,
    MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_QUIT: '1',
  }
  if (command) env.MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_COMMAND = command
  if (expectedPID) env.MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_EXPECTED_PID = String(expectedPID)

  const child = spawn(appExecutable, [], {
    cwd: fixtureHome,
    env,
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

async function waitForReport(path, app, label) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (app.spawnError()) throw app.spawnError()
    if (app.child.exitCode !== null || app.child.signalCode !== null) {
      throw new Error(
        `packaged App exited before ${label} report `
          + `(code=${app.child.exitCode}, signal=${app.child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `${label} report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return readJSON(path)
}

async function waitForHeartbeatGrowth(path, minimumLines) {
  const deadline = performance.now() + startupTimeoutMs
  while (true) {
    if (await exists(path)) {
      const text = await fs.readFile(path, 'utf8')
      const lines = text.trim().split(/\n+/).filter(Boolean)
      if (lines.length >= minimumLines) return { text, lines: lines.length }
    }
    assert(performance.now() < deadline, `heartbeat did not reach ${minimumLines} line(s)`)
    await delay(100)
  }
}

async function writeWorker(workspace) {
  const scriptPath = join(workspace, 'bg-worker.sh')
  const source = [
    '#!/bin/sh',
    'tick=0',
    'echo "MILKSU_BG_RECOVERY_READY pid=$$"',
    'echo "MILKSU_BG_RECOVERY_READY pid=$$" >> heartbeat.log',
    'while :; do',
    '  tick=$((tick + 1))',
    '  echo "MILKSU_BG_RECOVERY_TICK ${tick} pid=$$"',
    '  echo "MILKSU_BG_RECOVERY_TICK ${tick} pid=$$" >> heartbeat.log',
    '  sleep 1',
    'done',
    '',
  ].join('\n')
  await fs.writeFile(scriptPath, source, { mode: 0o700 })
}

function assertPhaseReport(report, phase) {
  assert(report.schema === 'milksu-coding-background-recovery-packaged-smoke/v1', `unexpected ${phase} schema`)
  assert(report.phase === phase, `unexpected ${phase} phase`)
  assert(!report.error, `${phase} report failed: ${report.error}`)
  assert(report.gates?.taskRunning === true, `${phase} did not report a running task`)
  assert(report.gates?.taskHasPid === true, `${phase} did not report a PID/PGID`)
  assert(report.gates?.logTailObserved === true, `${phase} did not observe log tail`)
  assert(report.gates?.heartbeatObserved === true, `${phase} did not observe heartbeat`)
  assert(report.gates?.noCredentialLeak === true, `${phase} reported credential leakage`)
  const serialized = JSON.stringify(report)
  assert(!serialized.includes(providerKeySentinel), `${phase} report leaked provider sentinel`)
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Coding background recovery live smoke; set MILKSU_CODING_BACKGROUND_RECOVERY_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Coding background recovery live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged Coding background recovery live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged artifact: ${appExecutable}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-coding-bg-recovery-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'app-data')
  const workspace = join(fixtureHome, 'workspace')
  const heartbeatPath = join(workspace, 'heartbeat.log')
  const startRawReport = join(fixtureHome, 'background-start.json')
  const recoverRawReport = join(fixtureHome, 'background-recover.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 })
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })
  await writeWorker(workspace)

  const startApp = spawnPackagedApp({
    fixtureHome,
    fixtureTemp,
    appDataDirectory,
    workspace,
    reportPath: startRawReport,
    heartbeatPath,
    phase: 'start',
    command: 'sh bg-worker.sh',
  })
  const startReport = await waitForReport(startRawReport, startApp, 'start')
  assertPhaseReport(startReport, 'start')
  const startExit = await waitForExit(startApp.child, shutdownTimeoutMs)
  assert(!startExit.timedOut, 'start App did not quit after writing report')
  assert(startExit.code === 0, `start App did not exit cleanly: ${JSON.stringify(startExit)}`)
  const startHeartbeat = await waitForHeartbeatGrowth(heartbeatPath, Math.max(2, startReport.heartbeatLines + 1))
  const startedPID = startReport.task?.pid
  assert(Number.isSafeInteger(startedPID) && startedPID > 0, 'start report missed background task PID')

  const recoverApp = spawnPackagedApp({
    fixtureHome,
    fixtureTemp,
    appDataDirectory,
    workspace,
    reportPath: recoverRawReport,
    heartbeatPath,
    phase: 'recover',
    expectedPID: startedPID,
  })
  const recoverReport = await waitForReport(recoverRawReport, recoverApp, 'recover')
  assertPhaseReport(recoverReport, 'recover')
  assert(recoverReport.gates?.recoveredAfterAppRestart === true, 'background task was not recovered after App restart')
  assert(recoverReport.gates?.recoveredPidMatchesStarted === true, 'recovered task PID did not match started task')
  assert(recoverReport.gates?.taskStopped === true, 'recovered task was not stopped')
  const recoverExit = await waitForExit(recoverApp.child, shutdownTimeoutMs)
  assert(!recoverExit.timedOut, 'recover App did not quit after writing report')
  assert(recoverExit.code === 0, `recover App did not exit cleanly: ${JSON.stringify(recoverExit)}`)

  await fs.copyFile(startRawReport, startEvidencePath)
  await fs.copyFile(recoverRawReport, recoverEvidencePath)
  await fs.chmod(startEvidencePath, 0o600)
  await fs.chmod(recoverEvidencePath, 0o600)
  const finalHeartbeat = await fs.readFile(heartbeatPath, 'utf8')
  const finalReport = {
    schema: 'milksu-coding-background-recovery-live/v1',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      architecture: arch(),
      packagedApp: appBundle,
      isolatedAppData: appDataDirectory,
      workspace,
    },
    start: {
      app: startApp.app(),
      exit: startExit,
      taskId: startReport.task?.id,
      taskPid: startedPID,
      heartbeatLines: startHeartbeat.lines,
      evidence: {
        path: startEvidencePath,
        relativePath: relative(repositoryRoot, startEvidencePath),
      },
    },
    recover: {
      app: recoverApp.app(),
      exit: recoverExit,
      recoveryState: recoverReport.status?.backgroundRecovery?.state,
      taskId: recoverReport.task?.id,
      taskPid: recoverReport.task?.pid,
      stopTasks: recoverReport.stopStatus?.backgroundTasks?.map(task => ({
        id: task.id,
        status: task.status,
        pid: task.pid,
      })) || [],
      evidence: {
        path: recoverEvidencePath,
        relativePath: relative(repositoryRoot, recoverEvidencePath),
      },
    },
    heartbeat: {
      path: heartbeatPath,
      lines: finalHeartbeat.trim().split(/\n+/).filter(Boolean).length,
      bytes: Buffer.byteLength(finalHeartbeat),
    },
    gates: {
      packagedAppStartedBackgroundTask: true,
      taskSurvivedAppQuit: true,
      packagedAppRecoveredBackgroundTaskAfterRestart: true,
      recoveredSamePid: recoverReport.task?.pid === startedPID,
      recoveredTaskStopped: recoverReport.gates?.taskStopped === true,
      logTailAndHeartbeatVisible: true,
      noProviderCredentialLeak: true,
    },
    limitations: [
      'This smoke uses a deterministic background process, not a model-authored Coding task.',
      'It verifies background task recovery, not interactive PTY recovery.',
    ],
  }
  const serialized = `${JSON.stringify(finalReport, null, 2)}\n`
  assert(!serialized.includes(providerKeySentinel), 'final report leaked provider sentinel')
  await fs.writeFile(resultPath, serialized, { mode: 0o600 })
  console.log('MilkSU packaged Coding background recovery live smoke passed.')
  console.log(`  start: task ${startReport.task.id} pid ${startedPID}`)
  console.log(`  recover: state=${recoverReport.status.backgroundRecovery.state}, pid ${recoverReport.task.pid}`)
  console.log(`  stop: ${finalReport.recover.stopTasks.map(task => `${task.id}:${task.status}`).join(', ')}`)
  console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
