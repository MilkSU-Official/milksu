#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'vuln-practice-directory-webview-live.json')
const liveSmokeEnabled = process.env.MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_LIVE_SMOKE === '1'
const cveID = String(process.env.MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_CVE_ID || 'CVE-2023-46604')
  .trim()
  .toUpperCase()
const sparsePath = String(process.env.MILKSU_VULHUB_SPARSE_PATH || 'activemq/CVE-2023-46604').trim()
const startupTimeoutMs = 90_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `vuln-practice-directory-webview-live-${process.pid}-${Date.now()}`

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

async function runGit(args, options = {}) {
  const { stdout } = await execFileAsync('git', args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout.trim()
}

async function prepareVulhubDirectory(root) {
  const provided = String(process.env.MILKSU_VULHUB_PRACTICE_DIRECTORY || '').trim()
  if (provided) {
    const absolute = resolve(provided)
    assert(await exists(absolute), `provided Vulhub practice directory does not exist: ${absolute}`)
    assert(await exists(join(absolute, 'docker-compose.yml')), `provided Vulhub practice directory is missing docker-compose.yml: ${absolute}`)
    return {
      directory: absolute,
      source: 'user-provided',
      revision: 'provided',
    }
  }

  const checkout = join(root, 'vulhub')
  await runGit(['clone', '--filter=blob:none', '--sparse', '--depth=1', 'https://github.com/vulhub/vulhub.git', checkout])
  await runGit(['-C', checkout, 'sparse-checkout', 'set', sparsePath])
  const revision = await runGit(['-C', checkout, 'rev-parse', 'HEAD'])
  const directory = join(checkout, sparsePath)
  assert(await exists(join(directory, 'docker-compose.yml')), `Vulhub sparse checkout is missing docker-compose.yml at ${sparsePath}`)
  return {
    directory,
    source: 'github.com/vulhub/vulhub',
    revision,
  }
}

async function waitForAppReport(path, child, spawnErrorRef) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (spawnErrorRef()) throw spawnErrorRef()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before CVE practice directory WebView smoke report `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `CVE practice directory WebView smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function assertAppReport(report, appDataDirectory, vulhubDirectory) {
  assert(report.schema === 'milksu-vuln-practice-directory-webview-smoke/v1', 'unexpected WebView App report schema')
  assert(!report.error, `CVE practice directory WebView smoke failed: ${report.error}`)
  assert(report.cveId === cveID, `CVE practice directory WebView cveId changed: ${report.cveId}`)
  assert(report.dataDirectory === appDataDirectory, `CVE practice directory WebView used unexpected data directory: ${report.dataDirectory}`)
  assert(report.directoryBasename === basename(vulhubDirectory), `CVE practice directory basename changed: ${report.directoryBasename}`)
  for (const [gate, value] of Object.entries(report.gates || {})) {
    assert(value === true, `CVE practice directory WebView gate ${gate} was not true`)
  }
  const serialized = JSON.stringify(report)
  assert(!serialized.includes(vulhubDirectory), 'CVE practice directory WebView report leaked raw local directory')
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'CVE practice directory WebView report leaked key-shaped content')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged CVE practice directory WebView live smoke; set MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged CVE practice directory WebView live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'milksu-vuln-practice-directory-webview-live-'))
  const fixtureTemp = join(fixtureRoot, 'tmp')
  const appDataDirectory = join(fixtureRoot, 'app-data')
  const appReportPath = join(fixtureRoot, 'vuln-practice-directory-webview-app-smoke.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(appDataDirectory, { recursive: true, mode: 0o700 })

  let child
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  try {
    const vulhub = await prepareVulhubDirectory(fixtureRoot)
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
        MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_CVE_ID: cveID,
        MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_DIRECTORY: vulhub.directory,
        MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_RESULT: appReportPath,
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
    assertAppReport(appReport, appDataDirectory, vulhub.directory)
    await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after CVE practice directory WebView smoke')

    const report = {
      schema: 'milksu-vuln-practice-directory-webview-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        isolatedDataDirectory: true,
      },
      vulhub: {
        source: vulhub.source,
        revision: vulhub.revision,
        sparsePath,
        directoryBasename: basename(vulhub.directory),
        composeFilePresent: true,
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
        selectedTitle: appReport.selectedTitle,
        directoryBasename: appReport.directoryBasename,
        gates: appReport.gates,
      },
      gates: {
        packagedAppOpenedCVEWorkspace: true,
        packagedAppConfirmedPracticePlanThroughWebView: true,
        packagedAppBoundRealVulhubDirectoryThroughWebView: true,
        packagedAppDidNotStartDockerRuntime: true,
        rawLocalDirectoryOmittedFromReport: true,
      },
    }
    const serialized = JSON.stringify(report)
    assert(!serialized.includes(vulhub.directory), 'live report leaked raw local Vulhub directory')
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged CVE practice directory WebView live smoke passed.')
    console.log(`  CVE: ${cveID}`)
    console.log(`  Vulhub: ${sparsePath}`)
    console.log(`  revision: ${vulhub.revision}`)
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
