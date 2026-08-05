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
const resultPath = join(resultsDirectory, 'ctf-recovery-live.json')
const createEvidencePath = join(resultsDirectory, 'ctf-recovery-live-create.json')
const verifyEvidencePath = join(resultsDirectory, 'ctf-recovery-live-verify.json')
const liveSmokeEnabled = process.env.MILKSU_CTF_RECOVERY_LIVE_SMOKE === '1'
const startupTimeoutMs = 45_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `ctf-recovery-live-${process.pid}-${Date.now()}`

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

async function waitForAppReport(path, child, spawnErrorRef, phase) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (spawnErrorRef()) throw spawnErrorRef()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before CTF recovery ${phase} smoke report `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `CTF recovery ${phase} smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function runAppPhase({ fixtureHome, fixtureTemp, appReportPath, mode, jobId }) {
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  const env = {
    HOME: fixtureHome,
    TMPDIR: fixtureTemp,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    MILKSU_ENABLE_MANAGED_LABS: '0',
    MILKSU_INSTANCE_ID: isolatedInstanceId,
    MILKSU_CTF_RECOVERY_SMOKE_RESULT: appReportPath,
    MILKSU_CTF_RECOVERY_SMOKE_MODE: mode,
  }
  if (jobId) env.MILKSU_CTF_RECOVERY_SMOKE_JOB_ID = jobId

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

  const report = await waitForAppReport(appReportPath, child, () => spawnError, mode)
  child.kill('SIGTERM')
  let exit = await waitForExit(child, shutdownTimeoutMs)
  let gracefulShutdown = true
  if (exit.timedOut) {
    gracefulShutdown = false
    child.kill('SIGKILL')
    exit = await waitForExit(child, 5_000)
  }
  assert(!exit.timedOut, `packaged App did not terminate after CTF recovery ${mode} smoke`)
  return {
    report,
    app: {
      stdoutBytes,
      stderrBytes,
      gracefulShutdown,
      exitCode: exit.code,
      exitSignal: exit.signal,
    },
  }
}

function assertCreateReport(report, appDataDirectory) {
  assert(report.schema === 'milksu-ctf-recovery-packaged-smoke/v1', 'unexpected CTF recovery create schema')
  assert(report.mode === 'create', `unexpected create mode: ${report.mode}`)
  assert(!report.error, `CTF recovery create smoke failed: ${report.error}`)
  assert(report.jobId, 'CTF recovery create smoke did not return a job id')
  assert(report.projection?.title === 'Packaged CTF recovery smoke', 'CTF recovery create title changed')
  assert(report.projection?.category === 'misc', 'CTF recovery create category changed')
  assert(report.projection?.collaborationMode === 'delegate', 'CTF recovery create mode changed')
  assert(report.projection?.listed === true, 'CTF recovery created job was not listed')
  assert(report.handoff?.role === 'solver', 'CTF recovery handoff role changed')
  assert(report.handoff?.conversationId, 'CTF recovery handoff missing conversation id')
  assert(report.checkpoint?.status === 'running', `CTF recovery checkpoint status changed: ${report.checkpoint?.status}`)
  assert(report.checkpoint?.metrics?.completedTurns === 1, 'CTF recovery checkpoint missing completed turn')
  assert(report.checkpoint?.metrics?.toolCalls === 1, 'CTF recovery checkpoint missing tool call')
  assert(report.checkpoint?.metrics?.lastEventType === 'assistant.completed', 'CTF recovery checkpoint last event changed')
  assert(report.replay?.eventCount === 3, 'CTF recovery replay did not include all fixture events')
  assert(report.files?.challengeJsonExists === true, 'CTF recovery challenge.json missing')
  assert(report.files?.runJsonExists === true, 'CTF recovery run.json missing')
  assert(report.files?.trajectoryExists === true, 'CTF recovery trajectory missing')
  assert(report.files?.notesExists === true, 'CTF recovery notes missing')
  assert(report.files?.materialExists === true, 'CTF recovery material missing')
  assert(report.files?.trajectorySha256, 'CTF recovery trajectory digest missing')
  assert(String(report.workspacePath || '').startsWith(join(appDataDirectory, 'ctf-workspaces') + '/'), 'CTF recovery workspace escaped App data')
  assert(report.gates?.packagedAppCreatedCtfJob === true, 'CTF recovery create gate missing')
  assert(report.gates?.agentWorkspacePrepared === true, 'CTF recovery workspace gate missing')
  assert(report.gates?.checkpointPersisted === true, 'CTF recovery checkpoint gate missing')
  assert(report.gates?.workspaceStayedInAppData === true, 'CTF recovery workspace App data gate missing')
  assert(report.gates?.noRawCandidateInCheckpoint === true, 'CTF recovery checkpoint stored raw candidate text')
}

function assertVerifyReport(report, createReport, appDataDirectory) {
  assert(report.schema === 'milksu-ctf-recovery-packaged-smoke/v1', 'unexpected CTF recovery verify schema')
  assert(report.mode === 'verify', `unexpected verify mode: ${report.mode}`)
  assert(!report.error, `CTF recovery verify smoke failed: ${report.error}`)
  assert(report.jobId === createReport.jobId, 'CTF recovery verify loaded a different job')
  assert(report.handoff?.conversationId === createReport.handoff?.conversationId, 'CTF recovery conversation id changed after restart')
  assert(report.files?.trajectorySha256 === createReport.files?.trajectorySha256, 'CTF recovery trajectory digest changed after restart')
  assert(report.checkpoint?.status === 'running', 'CTF recovery checkpoint status was not restored')
  assert(report.checkpoint?.metrics?.completedTurns === 1, 'CTF recovery completed turn count was not restored')
  assert(report.checkpoint?.metrics?.toolCalls === 1, 'CTF recovery tool call count was not restored')
  assert(report.checkpoint?.notesExcerptPresent === true, 'CTF recovery notes excerpt was not restored')
  assert(String(report.checkpoint?.progress?.lastVerifiedFact || '').includes('recovery smoke material'), 'CTF recovery progress fact was not restored')
  assert(String(report.checkpoint?.progress?.nextAction || '').includes('restored checkpoint'), 'CTF recovery next action was not restored')
  assert(report.replay?.eventCount === 3, 'CTF recovery replay event count was not restored')
  assert(report.gates?.checkpointRestoredAfterRestart === true, 'CTF recovery checkpoint restore gate failed')
  assert(report.gates?.replayRestoredAfterRestart === true, 'CTF recovery replay restore gate failed')
  assert(report.gates?.progressRestoredAfterRestart === true, 'CTF recovery progress restore gate failed')
  assert(report.gates?.workspaceStayedInAppData === true, 'CTF recovery verify workspace App data gate missing')
  assert(String(report.workspacePath || '').startsWith(join(appDataDirectory, 'ctf-workspaces') + '/'), 'CTF recovery verify workspace escaped App data')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged CTF recovery live smoke; set MILKSU_CTF_RECOVERY_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged CTF recovery live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-ctf-recovery-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(
    fixtureHome,
    'Library',
    'Application Support',
    'com.milksu.app',
  )
  const createReportPath = join(fixtureHome, 'ctf-recovery-create.json')
  const verifyReportPath = join(fixtureHome, 'ctf-recovery-verify.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })

  const createPhase = await runAppPhase({
    fixtureHome,
    fixtureTemp,
    appReportPath: createReportPath,
    mode: 'create',
  })
  assertCreateReport(createPhase.report, appDataDirectory)

  const verifyPhase = await runAppPhase({
    fixtureHome,
    fixtureTemp,
    appReportPath: verifyReportPath,
    mode: 'verify',
    jobId: createPhase.report.jobId,
  })
  assertVerifyReport(verifyPhase.report, createPhase.report, appDataDirectory)

  await fs.mkdir(resultsDirectory, { recursive: true })
  await fs.copyFile(createReportPath, createEvidencePath)
  await fs.copyFile(verifyReportPath, verifyEvidencePath)
  await fs.chmod(createEvidencePath, 0o600)
  await fs.chmod(verifyEvidencePath, 0o600)

  const finalReport = {
    schema: 'milksu-ctf-recovery-live-smoke/v1',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      architecture: arch(),
      isolatedHome: true,
      packagedApp: appBundle,
    },
    app: {
      create: createPhase.app,
      verify: verifyPhase.app,
    },
    jobId: createPhase.report.jobId,
    workspacePath: createPhase.report.workspacePath,
    createEvidence: {
      path: createEvidencePath,
      relativePath: relative(repositoryRoot, createEvidencePath),
    },
    verifyEvidence: {
      path: verifyEvidencePath,
      relativePath: relative(repositoryRoot, verifyEvidencePath),
    },
    gates: {
      packagedAppCreatedCTFJob: true,
      packagedAppRestartedWithSameAppData: true,
      recoveredSameJob: true,
      recoveredSameConversation: true,
      recoveredCheckpoint: true,
      recoveredReplay: true,
      recoveredProgress: true,
      workspaceStayedInAppData: true,
      noRawCandidateInCheckpoint: true,
    },
    limitations: [
      'This smoke verifies packaged App CTF job/workspace/checkpoint/replay persistence across a restart.',
      'It does not run a real Solver model, platform Judge, exploit input, or six-track CTF outcome.',
      'Browser cross-module navigation is covered separately; this smoke covers packaged App persistence state.',
    ],
  }
  const serialized = `${JSON.stringify(finalReport, null, 2)}\n`
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]|flag\{/i.test(serialized), 'CTF recovery live report leaked key-shaped or raw candidate content')
  await fs.writeFile(resultPath, serialized, { mode: 0o600 })
  console.log('MilkSU packaged CTF recovery live smoke passed.')
  console.log(`  job: ${createPhase.report.jobId}`)
  console.log(`  flow: create CTF job -> checkpoint/replay -> restart packaged App -> restore same job`)
  console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
