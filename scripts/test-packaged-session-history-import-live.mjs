#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'session-history-import-live.json')
const liveSmokeEnabled = process.env.MILKSU_SESSION_HISTORY_IMPORT_LIVE_SMOKE === '1'
const query = 'ExternalHistoryPackagedSmoke'
const fakeSecret = 'sk-external-history-live-secret12345'
const startupTimeoutMs = 30_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `session-history-import-live-${process.pid}-${Date.now()}`

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
        `packaged App exited before session history import report (code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `session history import report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function writeExternalHistoryFixture(path) {
  const lines = [
    JSON.stringify({
      session_id: 'codex-live-smoke',
      title: 'Codex external history live smoke',
      timestamp: '2026-08-05T03:00:00Z',
      role: 'user',
      content: `${query} user task with OPENAI_API_KEY=${fakeSecret}`,
      cwd: repositoryRoot,
      model: 'gpt-5',
    }),
    JSON.stringify({
      session_id: 'codex-live-smoke',
      timestamp: '2026-08-05T03:01:00Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'text',
          text: `${query} assistant recalled Browser and Computer Use handoff.`,
        }, {
          type: 'tool_use',
          name: 'computer_use.observe',
          input: { target: 'Calculator', api_key: fakeSecret },
        }],
      },
      cwd: repositoryRoot,
    }),
    '{not json}',
  ]
  await fs.writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 })
}

function assertAppReport(report, appDataDirectory, externalHistoryPath) {
  assert(report.schema === 'milksu-session-history-import-packaged-smoke/v1', 'unexpected smoke schema')
  assert(!report.error, `session history import smoke failed: ${report.error}`)
  assert(report.query === query, 'session history import query changed')
  assert(report.import?.source === 'codex', 'external import source changed')
  assert(report.import?.path === externalHistoryPath, 'external import path changed')
  assert(report.import?.sessionCount === 1, `unexpected session count: ${report.import?.sessionCount}`)
  assert(report.import?.messageCount === 2, `unexpected message count: ${report.import?.messageCount}`)
  assert(report.import?.toolCallCount === 1, `unexpected tool count: ${report.import?.toolCallCount}`)
  assert(report.import?.skippedLineCount === 1, `unexpected skipped count: ${report.import?.skippedLineCount}`)
  assert(
    String(report.import?.indexPath || '').startsWith(join(appDataDirectory, 'session-index') + '/'),
    `external import index escaped App data directory: ${report.import?.indexPath}`,
  )
  assert(report.status?.available === true, 'Session Index unavailable after external import')
  assert(report.resultCount >= 1, 'external import search returned no results')
  assert(report.firstResult?.source === 'codex', `unexpected first result source: ${report.firstResult?.source}`)
  assert(
    typeof report.firstResult?.snippet === 'string' && report.firstResult.snippet.includes(query),
    'external import search snippet did not include the query',
  )
  const serialized = JSON.stringify(report)
  assert(serialized.includes('[credential redacted]'), 'external import report did not show redacted credential marker')
  assert(!serialized.includes(fakeSecret), 'external import report leaked fixture credential')
  assert(!serialized.includes('redacted] redacted]'), 'external import report repeated redaction marker')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged session history import live smoke; set MILKSU_SESSION_HISTORY_IMPORT_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged session history import live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged session history import live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-session-history-import-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'Library', 'Application Support', 'com.milksu.app')
  const externalHistoryPath = join(fixtureHome, 'codex-history-live.jsonl')
  const appReportPath = join(fixtureHome, 'session-history-import-app-smoke.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await writeExternalHistoryFixture(externalHistoryPath)

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
        MILKSU_SESSION_HISTORY_IMPORT_SMOKE_RESULT: appReportPath,
        MILKSU_SESSION_HISTORY_IMPORT_SMOKE_PATH: externalHistoryPath,
        MILKSU_SESSION_HISTORY_IMPORT_SMOKE_SOURCE: 'codex',
        MILKSU_SESSION_HISTORY_IMPORT_SMOKE_QUERY: query,
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
    assertAppReport(appReport, appDataDirectory, externalHistoryPath)

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after session history import smoke')

    const report = {
      ...appReport,
      appExecutable,
      fixtureHome,
      appDataDirectory,
      gracefulShutdown,
      exit,
      stdoutBytes,
      stderrBytes,
    }
    await fs.mkdir(resultsDirectory, { recursive: true })
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log(`Packaged session history import live smoke passed: ${resultPath}`)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await waitForExit(child, 2_000)
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
