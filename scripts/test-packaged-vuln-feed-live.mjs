#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
const resultPath = join(resultsDirectory, 'vuln-feed-live.json')
const snapshotEvidencePath = join(resultsDirectory, 'vuln-feed-live-snapshot.json')
const liveSmokeEnabled = process.env.MILKSU_VULN_FEED_LIVE_SMOKE === '1'
const cveID = String(process.env.MILKSU_VULN_FEED_SMOKE_CVE_ID || 'CVE-2024-3400').trim().toUpperCase()
const startupTimeoutMs = 45_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `vuln-feed-live-${process.pid}-${Date.now()}`

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
        `packaged App exited before CVE feed smoke report (code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `CVE feed smoke report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function assertAppReport(report, appDataDirectory) {
  assert(report.schema === 'milksu-vuln-feed-packaged-smoke/v1', 'unexpected CVE feed smoke schema')
  assert(!report.error, `CVE feed smoke failed: ${report.error}`)
  assert(report.cveId === cveID, `CVE feed smoke cveId changed: ${report.cveId}`)
  assert(report.download?.sourceName === 'NVD', 'CVE feed smoke did not use NVD')
  assert(
    typeof report.download?.sourceUrl === 'string'
      && report.download.sourceUrl.includes(`cveId=${encodeURIComponent(cveID)}`),
    `CVE feed smoke source URL did not include the selected CVE: ${report.download?.sourceUrl}`,
  )
  assert(report.download?.retrievedAt, 'CVE feed smoke missing retrievedAt')
  assert(report.download?.httpStatus === 200, `CVE feed smoke unexpected HTTP status: ${report.download?.httpStatus}`)
  assert(
    String(report.download?.contentType || '').toLowerCase().includes('json'),
    `CVE feed smoke unexpected content type: ${report.download?.contentType}`,
  )
  assert(report.download?.bodyBytes > 100, 'CVE feed smoke returned an unexpectedly small payload')
  assert(report.download?.bodyContainsCve === true, 'CVE feed smoke body did not include the selected CVE')
  assert(report.fact?.present === true && report.fact?.id === cveID, 'CVE feed smoke did not extract the selected CVE fact')
  assert(report.fact?.published && report.fact?.lastModified, 'CVE feed smoke missing selected CVE timing facts')
  assert(report.download?.snapshotPath, 'CVE feed smoke missing persisted snapshot path')
  const expectedSnapshotPrefix = join(appDataDirectory, 'vuln', 'feed-snapshots', 'nvd') + '/'
  assert(
    String(report.download.snapshotPath).startsWith(expectedSnapshotPrefix),
    `CVE feed snapshot escaped App data directory: ${report.download.snapshotPath}`,
  )
  const snapshot = await fs.readFile(report.download.snapshotPath)
  assert(snapshot.length === report.download.snapshotSizeBytes, 'CVE feed snapshot size mismatch')
  const digest = sha256(snapshot)
  assert(digest === report.download.snapshotSha256, 'CVE feed snapshot sha256 mismatch')
  assert(snapshot.includes(Buffer.from(cveID)), 'CVE feed snapshot file did not contain the selected CVE')
  const info = await fs.stat(report.download.snapshotPath)
  assert((info.mode & 0o777) === 0o600, `CVE feed snapshot mode = ${(info.mode & 0o777).toString(8)}, want 600`)
  const serialized = JSON.stringify(report)
  assert(!serialized.includes('"body"'), 'CVE feed smoke report included raw feed body')
  return { snapshot, digest }
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged CVE feed live smoke; set MILKSU_VULN_FEED_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged CVE feed live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-vuln-feed-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(
    fixtureHome,
    'Library',
    'Application Support',
    'com.milksu.app',
  )
  const appReportPath = join(fixtureHome, 'vuln-feed-app-smoke.json')
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
        MILKSU_VULN_FEED_SMOKE_CVE_ID: cveID,
        MILKSU_VULN_FEED_SMOKE_RESULT: appReportPath,
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
    const { snapshot, digest } = await assertAppReport(appReport, appDataDirectory)
    await fs.mkdir(resultsDirectory, { recursive: true })
    await fs.writeFile(snapshotEvidencePath, snapshot, { mode: 0o600 })

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after CVE feed smoke')

    const report = {
      schema: 'milksu-vuln-feed-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        isolatedHome: true,
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
        download: appReport.download,
        fact: appReport.fact,
      },
      snapshotEvidence: {
        path: snapshotEvidencePath,
        bytes: snapshot.length,
        sha256: digest,
      },
      gates: {
        packagedAppFetchedNVD: true,
        sourceTimingPresent: true,
        selectedCVEFactPresent: true,
        persistedSnapshotInAppData: true,
        snapshotCopiedForEvidence: true,
        rawFeedBodyOmittedFromReport: true,
      },
    }
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged CVE feed live smoke passed.')
    console.log(`  CVE: ${cveID}`)
    console.log(`  source: ${appReport.download.sourceName} ${appReport.download.httpStatus}`)
    console.log(`  retrievedAt: ${appReport.download.retrievedAt}`)
    console.log(`  snapshot: ${relative(repositoryRoot, snapshotEvidencePath)} (${snapshot.length} bytes)`)
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
