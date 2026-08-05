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
const resultPath = join(resultsDirectory, 'vuln-learning-writeback-live.json')
const liveSmokeEnabled = process.env.MILKSU_VULN_LEARNING_WRITEBACK_LIVE_SMOKE === '1'
const cveID = String(process.env.MILKSU_VULN_LEARNING_WRITEBACK_SMOKE_CVE_ID || 'CVE-2023-46604')
  .trim()
  .toUpperCase()
const startupTimeoutMs = 90_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `vuln-learning-writeback-live-${process.pid}-${Date.now()}`

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
        `packaged App exited before CVE learning writeback smoke report `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `CVE learning writeback smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function assertAppReport(report, appDataDirectory) {
  assert(report.schema === 'milksu-vuln-learning-writeback-packaged-smoke/v1', 'unexpected App report schema')
  assert(!report.error, `CVE learning writeback smoke failed: ${report.error}`)
  assert(report.cveId === cveID, `CVE learning writeback cveId changed: ${report.cveId}`)
  assert(report.dataDirectory === appDataDirectory, `CVE learning writeback used unexpected data directory: ${report.dataDirectory}`)
  assert(typeof report.jobId === 'string' && report.jobId.length > 0, 'CVE learning writeback job id missing')
  assert(report.target?.name === cveID, 'CVE learning writeback target name missing')
  assert(report.target?.version === 'tracking', 'CVE learning writeback target version missing')
  assert(report.target?.fixture === 'cve-tracking', 'CVE learning writeback target fixture missing')
  assert(report.learningCount >= 1, 'CVE learning writeback did not persist learning')
  for (const [gate, value] of Object.entries(report.gates || {})) {
    assert(value === true, `CVE learning writeback gate ${gate} was not true`)
  }
  const serialized = JSON.stringify(report)
  assert(!serialized.includes('"content"'), 'CVE learning writeback report included raw learning content')
  assert(!serialized.includes('User-confirmed packaged smoke learning note'), 'CVE learning writeback report leaked learning body')
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'CVE learning writeback report leaked key-shaped content')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged CVE learning writeback live smoke; set MILKSU_VULN_LEARNING_WRITEBACK_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged CVE learning writeback live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'milksu-vuln-learning-writeback-live-'))
  const fixtureTemp = join(fixtureRoot, 'tmp')
  const appDataDirectory = join(fixtureRoot, 'app-data')
  const appReportPath = join(fixtureRoot, 'vuln-learning-writeback-app-smoke.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(appDataDirectory, { recursive: true, mode: 0o700 })

  let child
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  try {
    child = spawn(appExecutable, [], {
      cwd: fixtureRoot,
      env: {
        HOME: fixtureRoot,
        TMPDIR: fixtureTemp,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        MILKSU_APPDATA_DIR: appDataDirectory,
        MILKSU_ENABLE_MANAGED_LABS: '0',
        MILKSU_INSTANCE_ID: isolatedInstanceId,
        MILKSU_VULN_LEARNING_WRITEBACK_SMOKE_CVE_ID: cveID,
        MILKSU_VULN_LEARNING_WRITEBACK_SMOKE_RESULT: appReportPath,
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
    assertAppReport(appReport, appDataDirectory)
    await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after CVE learning writeback smoke')

    const report = {
      schema: 'milksu-vuln-learning-writeback-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        isolatedDataDirectory: true,
      },
      app: {
        stdoutBytes,
        stderrBytes,
        gracefulShutdown,
      },
      cveId: cveID,
      appReport: {
        schema: appReport.schema,
        ranAt: appReport.ranAt,
        dataDirectory: appReport.dataDirectory,
        jobId: appReport.jobId,
        target: appReport.target,
        learningCount: appReport.learningCount,
        gates: appReport.gates,
      },
      gates: {
        packagedAppCreatedCVETrackingWorkspace: true,
        packagedAppPersistedUserConfirmedLearning: true,
        packagedAppRecoveredProjection: true,
        rawLearningBodyOmittedFromReport: true,
      },
    }
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged CVE learning writeback live smoke passed.')
    console.log(`  CVE: ${cveID}`)
    console.log(`  job: ${appReport.jobId}`)
    console.log(`  learning: ${appReport.learningCount}`)
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
    await fs.rm(fixtureRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
