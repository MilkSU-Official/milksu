#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const packagedNode = join(appBundle, 'Contents', 'Resources', 'milksu-sidecar', 'node')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'coding-self-bootstrap-live.json')
const historyEvidencePath = join(resultsDirectory, 'coding-self-bootstrap-history-import.json')
const deliveryEvidencePath = join(resultsDirectory, 'coding-self-bootstrap-delivery.json')
const gitEvidencePath = join(resultsDirectory, 'coding-self-bootstrap-git.json')
const liveSmokeEnabled = process.env.MILKSU_CODING_SELF_BOOTSTRAP_LIVE_SMOKE === '1'
const startupTimeoutMs = 30_000
const shutdownTimeoutMs = 10_000
const historyQuery = 'SelfBootstrapRelatedHistory'
const historySecret = 'MILKSU_FAKE_HISTORY_CREDENTIAL_SENTINEL_12345'
const commitMessage = 'test: deliver MilkSU coding self-bootstrap smoke'
const isolatedInstanceId = `coding-self-bootstrap-live-${process.pid}-${Date.now()}`

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

async function waitForAppReport(path, child, spawnErrorRef, label) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (spawnErrorRef()) throw spawnErrorRef()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before ${label} report `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `${label} report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function runPackagedAppSmoke({ fixtureHome, fixtureTemp, appReportPath, env, label }) {
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
  const report = await waitForAppReport(appReportPath, child, () => spawnError, label)
  child.kill('SIGTERM')
  let exit = await waitForExit(child, shutdownTimeoutMs)
  let gracefulShutdown = true
  if (exit.timedOut) {
    gracefulShutdown = false
    child.kill('SIGKILL')
    exit = await waitForExit(child, 5_000)
  }
  assert(!exit.timedOut, `packaged App did not terminate after ${label} smoke`)
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

async function writeExternalHistoryFixture(path) {
  const lines = [
    JSON.stringify({
      session_id: 'self-bootstrap-history',
      title: 'Self-bootstrap related history seed',
      timestamp: '2026-08-05T04:00:00Z',
      role: 'user',
      content: `${historyQuery} previous delivery fixed a singular/plural report regression. OPENAI_API_KEY=${historySecret}`,
      cwd: repositoryRoot,
      model: 'gpt-5',
    }),
    JSON.stringify({
      session_id: 'self-bootstrap-history',
      timestamp: '2026-08-05T04:01:00Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'text',
          text: `${historyQuery} suggests reading attachment/request.json, adding a regression test, and running npm test before Git delivery.`,
        }, {
          type: 'tool_use',
          name: 'bash',
          input: { command: 'npm test', token: historySecret },
        }],
      },
      cwd: repositoryRoot,
    }),
  ]
  await fs.writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 })
}

function assertHistoryImport(report, appDataDirectory) {
  assert(report.schema === 'milksu-session-history-import-packaged-smoke/v1', 'unexpected history import schema')
  assert(!report.error, `history import smoke failed: ${report.error}`)
  assert(report.query === historyQuery, 'history query changed')
  assert(report.import?.source === 'codex', 'history import source changed')
  assert(report.import?.sessionCount === 1, 'history import session count changed')
  assert(report.import?.messageCount === 2, 'history import message count changed')
  assert(report.import?.toolCallCount === 1, 'history import tool count changed')
  assert(String(report.import?.indexPath || '').startsWith(join(appDataDirectory, 'session-index') + '/'), 'history index escaped App data')
  assert(report.resultCount >= 1, 'history search returned no result')
  assert(report.firstResult?.source === 'codex', 'history search did not return codex source')
  assert(String(report.firstResult?.snippet || '').includes(historyQuery), 'history search snippet missed token')
  const serialized = JSON.stringify(report)
  assert(serialized.includes('[credential redacted]'), 'history import did not redact credential')
  assert(!serialized.includes(historySecret), 'history import leaked fixture credential')
  assert(!serialized.includes('redacted] redacted]'), 'history import repeated redaction marker')
}

function relatedHistoryContext(report) {
  return [
    `来源：${report.firstResult?.source || 'codex'}`,
    `查询：${historyQuery}`,
    `摘要：${report.firstResult?.snippet || ''}`,
    `建议：读取 attachment/request.json，补回归测试，运行 npm test，再做 Git 交付。`,
  ].join('\n')
}

async function runDeliveryGate(historyContext) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    join(repositoryRoot, 'scripts', 'test-coding-agent-delivery.mjs'),
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MILKSU_KEEP_CODING_FIXTURE: '1',
      MILKSU_CODING_DELIVERY_GIT_REPO: '1',
      MILKSU_CODING_DELIVERY_RESULT: deliveryEvidencePath,
      MILKSU_CODING_DELIVERY_HISTORY_CONTEXT: historyContext,
      MILKSU_CODING_DELIVERY_HISTORY_TOKEN: historyQuery,
      MILKSU_CODING_SIDECAR_NODE: packagedNode,
    },
    maxBuffer: 40 * 1024 * 1024,
  })
  const report = JSON.parse(await fs.readFile(deliveryEvidencePath, 'utf8'))
  assert(report.schemaVersion === 'milksu-coding-delivery/v1alpha1', 'unexpected delivery report schema')
  assert(report.passed === true && report.score === 100, 'coding delivery gate did not pass')
  assert(report.checks?.relatedHistory === true, 'delivery gate did not consume confirmed related history')
  assert(report.metrics?.providerRequestsWithHistoryToken >= 1, 'provider request did not include related history token')
  assert(String(report.workspace || '').startsWith('/private/tmp/'), `unexpected kept fixture workspace: ${report.workspace}`)
  assert(report.gitFixture?.remote, 'delivery gate did not create local bare remote')
  return {
    report,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
  }
}

function assertGitSmoke(report) {
  assert(report.schema === 'milksu-coding-git-delivery-packaged-smoke/v1', 'unexpected Git smoke schema')
  assert(!report.error, `Git smoke failed: ${report.error}`)
  assert(report.gates?.workspaceIsRepository === true, 'Git smoke did not see repository')
  assert(report.gates?.hadPendingChanges === true, 'Git smoke did not see pending changes')
  assert(report.gates?.stageAllStagedChanges === true, 'Git smoke did not stage changes')
  assert(report.gates?.commitCreatedHead === true, 'Git smoke did not commit')
  assert(report.gates?.pushUpdatedUpstream === true, 'Git smoke did not push upstream')
  assert(report.gates?.cleanAfterPush === true, 'Git smoke did not leave clean workspace')
}

async function gitOutput(args, options = {}) {
  const { stdout } = await execFileAsync('git', args, {
    ...options,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function verifyBareRemote(deliveryReport, gitReport) {
  const remote = deliveryReport.gitFixture.remote
  const workspace = deliveryReport.workspace
  const remoteHead = await gitOutput(['--git-dir', remote, 'rev-parse', '--short=12', 'refs/heads/main'])
  const localHead = await gitOutput(['-C', workspace, 'rev-parse', '--short=12', 'HEAD'])
  const status = await gitOutput(['-C', workspace, 'status', '--porcelain=v1'])
  const subject = await gitOutput(['-C', workspace, 'log', '-1', '--format=%s'])
  assert(remoteHead === gitReport.push?.snapshot?.git?.head, 'remote head did not match Git smoke push head')
  assert(localHead === remoteHead, 'local and remote heads diverged after packaged App push')
  assert(status === '', `workspace was not clean after packaged App Git delivery: ${status}`)
  assert(subject === commitMessage, `unexpected final commit subject: ${subject}`)
  return {
    remote,
    remoteHead,
    localHead,
    subject,
    clean: status === '',
  }
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Coding self-bootstrap live smoke; set MILKSU_CODING_SELF_BOOTSTRAP_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Coding self-bootstrap live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged Coding self-bootstrap live smoke expects darwin/arm64 App build')
  for (const required of [appExecutable, packagedNode]) {
    assert(await exists(required), `missing packaged artifact: ${required}`)
  }

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-coding-self-bootstrap-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'Library', 'Application Support', 'com.milksu.app')
  const externalHistoryPath = join(fixtureHome, 'self-bootstrap-history.jsonl')
  const historyAppReportPath = join(fixtureHome, 'history-import.json')
  const gitAppReportPath = join(fixtureHome, 'git-delivery.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await writeExternalHistoryFixture(externalHistoryPath)

  const historyPhase = await runPackagedAppSmoke({
    fixtureHome,
    fixtureTemp,
    appReportPath: historyAppReportPath,
    label: 'history-import',
    env: {
      MILKSU_SESSION_HISTORY_IMPORT_SMOKE_RESULT: historyAppReportPath,
      MILKSU_SESSION_HISTORY_IMPORT_SMOKE_PATH: externalHistoryPath,
      MILKSU_SESSION_HISTORY_IMPORT_SMOKE_SOURCE: 'codex',
      MILKSU_SESSION_HISTORY_IMPORT_SMOKE_QUERY: historyQuery,
    },
  })
  assertHistoryImport(historyPhase.report, appDataDirectory)
  await fs.mkdir(resultsDirectory, { recursive: true })
  await fs.copyFile(historyAppReportPath, historyEvidencePath)
  await fs.chmod(historyEvidencePath, 0o600)

  const deliveryPhase = await runDeliveryGate(relatedHistoryContext(historyPhase.report))

  const gitPhase = await runPackagedAppSmoke({
    fixtureHome,
    fixtureTemp,
    appReportPath: gitAppReportPath,
    label: 'git-delivery',
    env: {
      MILKSU_CODING_GIT_DELIVERY_SMOKE_RESULT: gitAppReportPath,
      MILKSU_CODING_GIT_DELIVERY_SMOKE_WORKSPACE: deliveryPhase.report.workspace,
      MILKSU_CODING_GIT_DELIVERY_SMOKE_MESSAGE: commitMessage,
    },
  })
  assertGitSmoke(gitPhase.report)
  await fs.copyFile(gitAppReportPath, gitEvidencePath)
  await fs.chmod(gitEvidencePath, 0o600)
  const remoteVerification = await verifyBareRemote(deliveryPhase.report, gitPhase.report)

  const finalReport = {
    schema: 'milksu-coding-self-bootstrap-live/v1',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      architecture: arch(),
      packagedApp: appBundle,
      packagedNode,
      isolatedHome: true,
    },
    history: {
      query: historyQuery,
      source: historyPhase.report.firstResult?.source,
      resultCount: historyPhase.report.resultCount,
      evidence: {
        path: historyEvidencePath,
        relativePath: relative(repositoryRoot, historyEvidencePath),
      },
      app: historyPhase.app,
    },
    delivery: {
      score: deliveryPhase.report.score,
      passed: deliveryPhase.report.passed,
      changedPaths: deliveryPhase.report.metrics?.changedPaths,
      providerRequestsWithHistoryToken: deliveryPhase.report.metrics?.providerRequestsWithHistoryToken,
      workspace: deliveryPhase.report.workspace,
      evidence: {
        path: deliveryEvidencePath,
        relativePath: relative(repositoryRoot, deliveryEvidencePath),
      },
      stdoutBytes: deliveryPhase.stdoutBytes,
      stderrBytes: deliveryPhase.stderrBytes,
    },
    git: {
      commitMessage,
      beforeHead: gitPhase.report.before?.git?.head,
      pushedHead: gitPhase.report.push?.snapshot?.git?.head,
      remote: remoteVerification.remote,
      remoteHead: remoteVerification.remoteHead,
      localHead: remoteVerification.localHead,
      subject: remoteVerification.subject,
      evidence: {
        path: gitEvidencePath,
        relativePath: relative(repositoryRoot, gitEvidencePath),
      },
      app: gitPhase.app,
    },
    gates: {
      packagedAppImportedExternalHistory: true,
      agentReceivedConfirmedRelatedHistory: true,
      agentCompletedCodingDelivery: true,
      packagedAppGitStageCommitPush: true,
      localBareRemoteUpdated: true,
      workspaceCleanAfterPush: remoteVerification.clean,
      noProviderCredentialLeak: true,
    },
    limitations: [
      'This smoke uses a deterministic local OpenAI-compatible provider, not a paid external provider.',
      'The coding task runs in an isolated fixture repository, not the MilkSU source tree.',
      'The Git push targets an isolated local bare remote; hosted PR creation remains a separate confirmation-gated milestone.',
    ],
  }

  const serialized = `${JSON.stringify(finalReport, null, 2)}\n`
  for (const leaked of [historySecret, 'fixture-only-not-a-secret']) {
    assert(!serialized.includes(leaked), `self-bootstrap report leaked fixture secret: ${leaked}`)
  }
  await fs.writeFile(resultPath, serialized, { mode: 0o600 })
  console.log('MilkSU packaged Coding self-bootstrap live smoke passed.')
  console.log(`  history: packaged App import/search -> ${historyPhase.report.resultCount} result(s)`)
  console.log(`  delivery: score ${deliveryPhase.report.score}, history token requests ${deliveryPhase.report.metrics.providerRequestsWithHistoryToken}`)
  console.log(`  git: ${remoteVerification.localHead} pushed to isolated bare remote`)
  console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
