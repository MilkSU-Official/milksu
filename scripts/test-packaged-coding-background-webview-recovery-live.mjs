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
const resultPath = join(resultsDirectory, 'coding-background-webview-recovery-live.json')
const startAppReportPath = join(resultsDirectory, 'coding-background-webview-recovery-live-start-app-report.json')
const recoverAppReportPath = join(resultsDirectory, 'coding-background-webview-recovery-live-recover-app-report.json')
const liveSmokeEnabled = process.env.MILKSU_CODING_BACKGROUND_WEBVIEW_RECOVERY_LIVE_SMOKE === '1'
const startupTimeoutMs = 90_000
const shutdownTimeoutMs = 20_000
const providerKeySentinel = 'MILKSU_FAKE_PROVIDER_KEY_SENTINEL_FOR_BG_WEBVIEW_RECOVERY'

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
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    DEEPSEEK_API_KEY: providerKeySentinel,
    MILKSU_APPDATA_DIR: appDataDirectory,
    MILKSU_ENABLE_MANAGED_LABS: '0',
    MILKSU_INSTANCE_ID: `coding-background-webview-recovery-live-${phase}-${process.pid}-${Date.now()}`,
    MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_RESULT: reportPath,
    MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_PHASE: phase,
    MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_WORKSPACE: workspace,
  }
  if (command) env.MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_COMMAND = command
  if (expectedPID) env.MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_EXPECTED_PID = String(expectedPID)
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
        `packaged App exited before ${label} WebView report `
          + `(code=${app.child.exitCode}, signal=${app.child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `${label} WebView report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return readJSON(path)
}

async function terminateApp(app) {
  if (app.child.exitCode !== null || app.child.signalCode !== null) {
    return { code: app.child.exitCode, signal: app.child.signalCode, timedOut: false, gracefulShutdown: true }
  }
  app.child.kill('SIGTERM')
  let exit = await waitForExit(app.child, shutdownTimeoutMs)
  let gracefulShutdown = true
  if (exit.timedOut) {
    gracefulShutdown = false
    app.child.kill('SIGKILL')
    exit = await waitForExit(app.child, 5_000)
  }
  assert(!exit.timedOut, 'packaged App did not terminate')
  return { ...exit, gracefulShutdown }
}

async function writeWorker(workspace) {
  const scriptPath = join(workspace, 'bg-ui-worker.sh')
  const source = [
    '#!/bin/sh',
    'tick=0',
    'echo "MILKSU_BG_UI_RECOVERY_READY pid=$$"',
    'echo "MILKSU_BG_UI_RECOVERY_READY pid=$$" >> heartbeat-ui.log',
    'while :; do',
    '  tick=$((tick + 1))',
    '  echo "MILKSU_BG_UI_RECOVERY_TICK ${tick} pid=$$"',
    '  echo "MILKSU_BG_UI_RECOVERY_TICK ${tick} pid=$$" >> heartbeat-ui.log',
    '  sleep 1',
    'done',
    '',
  ].join('\n')
  await fs.writeFile(scriptPath, source, { mode: 0o700 })
}

async function waitForHeartbeatGrowth(path, minimumLines) {
  const deadline = performance.now() + 30_000
  while (true) {
    if (await exists(path)) {
      const text = await fs.readFile(path, 'utf8')
      const lines = text.trim().split(/\n+/).filter(Boolean)
      if (lines.length >= minimumLines) return { lines: lines.length, bytes: Buffer.byteLength(text) }
    }
    assert(performance.now() < deadline, `heartbeat did not reach ${minimumLines} line(s)`)
    await delay(100)
  }
}

function assertAppReport(report, phase, expectedDataDirectory) {
  assert(report.schema === 'milksu-coding-background-recovery-webview-smoke/v1', `unexpected ${phase} schema`)
  assert(report.phase === phase, `unexpected ${phase} phase`)
  assert(!report.error, `${phase} WebView smoke failed: ${report.error}`)
  assert(report.dataDirectory === expectedDataDirectory, `unexpected ${phase} data directory: ${report.dataDirectory}`)
  const required = phase === 'start'
    ? [
        'codingPageOpened',
        'terminalPanelOpened',
        'tasksTabOpened',
        'commandEntered',
        'runClicked',
        'taskVisible',
        'taskRunning',
        'pidVisible',
        'logTailVisible',
        'noCredentialLeak',
      ]
    : [
        'codingPageOpened',
        'terminalPanelOpened',
        'tasksTabOpened',
        'taskVisible',
        'taskRunning',
        'pidVisible',
        'logTailVisible',
        'recoveryBannerVisible',
        'stopClicked',
        'taskStopped',
        'recoveredPidMatched',
        'noCredentialLeak',
      ]
  for (const gate of required) {
    assert(report.gates?.[gate] === true, `${phase} WebView gate ${gate} was not true`)
  }
  const serialized = JSON.stringify(report)
  assert(!serialized.includes(providerKeySentinel), `${phase} report leaked provider sentinel`)
  assert(!/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]/.test(serialized), `${phase} report leaked token-shaped content`)
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Coding background WebView recovery live smoke; set MILKSU_CODING_BACKGROUND_WEBVIEW_RECOVERY_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Coding background WebView recovery live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged Coding background WebView recovery live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged artifact: ${appExecutable}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-coding-bg-webview-recovery-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'app-data')
  const workspace = join(fixtureHome, 'workspace')
  const heartbeatPath = join(workspace, 'heartbeat-ui.log')
  const command = 'sh bg-ui-worker.sh'
  const rawStartReportPath = join(fixtureHome, 'coding-background-webview-start.json')
  const rawRecoverReportPath = join(fixtureHome, 'coding-background-webview-recover.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 })
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })
  await writeWorker(workspace)

  const startApp = spawnPackagedApp({
    fixtureHome,
    fixtureTemp,
    appDataDirectory,
    workspace,
    reportPath: rawStartReportPath,
    phase: 'start',
    command,
  })
  let recoverApp
  let workerPID = 0
  let stoppedByRecoverUI = false
  try {
    const startReport = await waitForReport(rawStartReportPath, startApp, 'start')
    await fs.copyFile(rawStartReportPath, startAppReportPath)
    await fs.chmod(startAppReportPath, 0o600)
    assertAppReport(startReport, 'start', appDataDirectory)
    const startPID = startReport.observedPid
    assert(Number.isSafeInteger(startPID) && startPID > 0, 'start WebView report missed task PID')
    workerPID = startPID
    const startExit = await terminateApp(startApp)
    const heartbeatAfterQuit = await waitForHeartbeatGrowth(heartbeatPath, 3)

    recoverApp = spawnPackagedApp({
      fixtureHome,
      fixtureTemp,
      appDataDirectory,
      workspace,
      reportPath: rawRecoverReportPath,
      phase: 'recover',
      command,
      expectedPID: startPID,
    })
    const recoverReport = await waitForReport(rawRecoverReportPath, recoverApp, 'recover')
    await fs.copyFile(rawRecoverReportPath, recoverAppReportPath)
    await fs.chmod(recoverAppReportPath, 0o600)
    assertAppReport(recoverReport, 'recover', appDataDirectory)
    assert(recoverReport.observedPid === startPID, 'recover WebView report did not preserve task PID')
    stoppedByRecoverUI = true
    const recoverExit = await terminateApp(recoverApp)
    const finalHeartbeat = await fs.readFile(heartbeatPath, 'utf8')

    const report = {
      schema: 'milksu-coding-background-webview-recovery-live/v1',
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
        appReport: relative(repositoryRoot, startAppReportPath),
        taskPid: startPID,
        gates: startReport.gates,
      },
      recover: {
        app: recoverApp.app(),
        exit: recoverExit,
        appReport: relative(repositoryRoot, recoverAppReportPath),
        taskPid: recoverReport.observedPid,
        gates: recoverReport.gates,
      },
      heartbeat: {
        path: heartbeatPath,
        linesAfterAppQuit: heartbeatAfterQuit.lines,
        finalLines: finalHeartbeat.trim().split(/\n+/).filter(Boolean).length,
        finalBytes: Buffer.byteLength(finalHeartbeat),
      },
      gates: {
        packagedWebViewOpenedCodingWorkspace: true,
        visibleTasksPanelStartedLongTask: true,
        taskSurvivedAppQuit: true,
        visibleTasksPanelRecoveredAfterRestart: true,
        visibleRecoveryBannerObserved: true,
        recoveredSamePID: recoverReport.observedPid === startPID,
        visibleStopButtonStoppedTask: true,
        noProviderCredentialLeak: true,
      },
      limitations: [
        'This smoke verifies a user-visible packaged App UI path for deterministic background task recovery.',
        'It does not recover interactive PTY sessions.',
        'It does not prove a model-authored Coding task; model self-bootstrap remains tracked separately.',
      ],
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    assert(!serialized.includes(providerKeySentinel), 'final report leaked provider sentinel')
    await fs.writeFile(resultPath, serialized, { mode: 0o600 })
    console.log('Packaged Coding background WebView recovery live smoke passed.')
    console.log(`  start: pid ${startPID}`)
    console.log(`  recover: pid ${recoverReport.observedPid}`)
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    if (startApp.child.exitCode === null && startApp.child.signalCode === null) {
      startApp.child.kill('SIGTERM')
      const exit = await waitForExit(startApp.child, 5_000)
      if (exit.timedOut) startApp.child.kill('SIGKILL')
    }
    if (recoverApp && recoverApp.child.exitCode === null && recoverApp.child.signalCode === null) {
      recoverApp.child.kill('SIGTERM')
      const exit = await waitForExit(recoverApp.child, 5_000)
      if (exit.timedOut) recoverApp.child.kill('SIGKILL')
    }
    if (workerPID && !stoppedByRecoverUI) {
      try {
        process.kill(workerPID, 'SIGTERM')
      } catch {
        // The worker may already be gone.
      }
    }
    await fs.rm(fixtureHome, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
