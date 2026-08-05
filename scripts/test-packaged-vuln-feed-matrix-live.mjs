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
const resultPath = join(resultsDirectory, 'vuln-feed-matrix-live.json')
const liveSmokeEnabled = process.env.MILKSU_VULN_FEED_MATRIX_LIVE_SMOKE === '1'
const cveID = String(process.env.MILKSU_VULN_FEED_MATRIX_SMOKE_CVE_ID || 'CVE-2023-46604')
  .trim()
  .toUpperCase()
const startupTimeoutMs = 120_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `vuln-feed-matrix-live-${process.pid}-${Date.now()}`

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
        `packaged App exited before CVE feed matrix smoke report (code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `CVE feed matrix smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sourceSlug(sourceName) {
  return String(sourceName || 'feed')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'feed'
}

function bySource(report, sourceName) {
  const download = report.downloads?.find(item => item.sourceName === sourceName)
  assert(download, `missing ${sourceName} download`)
  return download
}

async function assertAndCopySnapshots(report, appDataDirectory) {
  const evidence = []
  for (const download of report.downloads || []) {
    assert(download.retrievedAt || download.lastModified, `${download.sourceName} missing source timing`)
    assert(download.httpStatus >= 200 && download.httpStatus < 300, `${download.sourceName} HTTP ${download.httpStatus}`)
    assert(download.bodyBytes > 0, `${download.sourceName} body size missing`)
    assert(download.snapshotPath, `${download.sourceName} missing snapshot path`)
    assert(
      String(download.snapshotPath).startsWith(join(appDataDirectory, 'vuln', 'feed-snapshots') + '/'),
      `${download.sourceName} snapshot escaped App data: ${download.snapshotPath}`,
    )
    const snapshot = await fs.readFile(download.snapshotPath)
    assert(snapshot.length === download.snapshotSizeBytes, `${download.sourceName} snapshot size mismatch`)
    const digest = sha256(snapshot)
    assert(digest === download.snapshotSha256, `${download.sourceName} snapshot sha256 mismatch`)
    const info = await fs.stat(download.snapshotPath)
    assert((info.mode & 0o777) === 0o600, `${download.sourceName} snapshot mode ${(info.mode & 0o777).toString(8)}, want 600`)
    const copyPath = join(resultsDirectory, `vuln-feed-matrix-live-${sourceSlug(download.sourceName)}.json`)
    await fs.writeFile(copyPath, snapshot, { mode: 0o600 })
    evidence.push({
      sourceName: download.sourceName,
      path: copyPath,
      bytes: snapshot.length,
      sha256: digest,
    })
  }
  return evidence
}

function assertAppReport(report, appDataDirectory) {
  assert(report.schema === 'milksu-vuln-feed-matrix-packaged-smoke/v1', 'unexpected CVE feed matrix schema')
  assert(!report.error, `CVE feed matrix smoke failed: ${report.error}`)
  assert(report.cveId === cveID, `CVE feed matrix cveId changed: ${report.cveId}`)
  assert(report.dataDirectory === appDataDirectory, `CVE feed matrix used unexpected data directory: ${report.dataDirectory}`)
  assert(Array.isArray(report.downloads) && report.downloads.length === 6, 'CVE feed matrix did not return six source downloads')
  for (const source of ['NVD', 'FIRST EPSS', 'OSV', 'GitHub Advisory Database', 'CISA KEV', 'Vulhub Practice Catalog']) {
    bySource(report, source)
  }
  assert(report.nvd?.present === true && report.nvd?.id === cveID, 'NVD selected CVE fact missing')
  assert(report.epss?.present === true && report.epss?.cve === cveID, 'FIRST EPSS selected CVE fact missing')
  assert(report.osv?.present === true, 'OSV selected CVE fact missing')
  assert(report.githubAdvisory?.present === true && report.githubAdvisory?.cveId === cveID, 'GitHub Advisory selected CVE fact missing')
  assert(report.cisaKev?.present === true && report.cisaKev?.cveId === cveID, 'CISA KEV selected CVE fact missing')
  assert(
    report.vulhub?.present === true &&
      report.vulhub?.firstMatch?.cveId === cveID &&
      String(report.vulhub?.firstMatch?.directory || '').includes(cveID),
    'Vulhub selected CVE practice match missing',
  )
  for (const [gate, value] of Object.entries(report.gates || {})) {
    assert(value === true, `CVE feed matrix gate ${gate} was not true`)
  }
  const serialized = JSON.stringify(report)
  assert(!serialized.includes('"body"'), 'CVE feed matrix report included raw feed body')
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'CVE feed matrix report leaked key-shaped content')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged CVE feed matrix live smoke; set MILKSU_VULN_FEED_MATRIX_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged CVE feed matrix live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'milksu-vuln-feed-matrix-live-'))
  const fixtureTemp = join(fixtureRoot, 'tmp')
  const appDataDirectory = join(fixtureRoot, 'app-data')
  const appReportPath = join(fixtureRoot, 'vuln-feed-matrix-app-smoke.json')
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
        MILKSU_VULN_FEED_MATRIX_SMOKE_CVE_ID: cveID,
        MILKSU_VULN_FEED_MATRIX_SMOKE_RESULT: appReportPath,
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
    await fs.mkdir(resultsDirectory, { recursive: true })
    const snapshotEvidence = await assertAndCopySnapshots(appReport, appDataDirectory)

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after CVE feed matrix smoke')

    const report = {
      schema: 'milksu-vuln-feed-matrix-live-smoke/v1',
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
        downloads: appReport.downloads,
        nvd: appReport.nvd,
        epss: appReport.epss,
        osv: appReport.osv,
        githubAdvisory: appReport.githubAdvisory,
        cisaKev: appReport.cisaKev,
        vulhub: appReport.vulhub,
        gates: appReport.gates,
      },
      snapshotEvidence,
      gates: {
        packagedAppFetchedNVD: true,
        packagedAppFetchedFIRSTEPSS: true,
        packagedAppFetchedOSV: true,
        packagedAppFetchedGitHubAdvisory: true,
        packagedAppFetchedCISAKEV: true,
        packagedAppFetchedVulhub: true,
        selectedCVEHasPracticeCandidate: true,
        snapshotsCopiedForEvidence: snapshotEvidence.length === 6,
        rawFeedBodiesOmittedFromReport: true,
      },
    }
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged CVE feed matrix live smoke passed.')
    console.log(`  CVE: ${cveID}`)
    console.log('  sources: NVD + FIRST EPSS + OSV + GitHub Advisory + CISA KEV + Vulhub')
    console.log(`  Vulhub: ${appReport.vulhub.firstMatch.directory}`)
    console.log(`  snapshots: ${snapshotEvidence.length}`)
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
