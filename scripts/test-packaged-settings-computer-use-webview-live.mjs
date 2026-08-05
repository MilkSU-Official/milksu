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
const resultPath = join(resultsDirectory, 'settings-computer-use-webview-live.json')
const liveSmokeEnabled = process.env.MILKSU_SETTINGS_COMPUTER_USE_WEBVIEW_LIVE_SMOKE === '1'
const startupTimeoutMs = 90_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `settings-computer-use-webview-live-${process.pid}-${Date.now()}`

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
        `packaged App exited before Settings Computer Use WebView smoke report `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `Settings Computer Use WebView smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function assertAppReport(report, appDataDirectory) {
  assert(report.schema === 'milksu-settings-computer-use-webview-smoke/v1', 'unexpected Settings WebView App report schema')
  assert(!report.error, `Settings Computer Use WebView smoke failed: ${report.error}`)
  assert(report.dataDirectory === appDataDirectory, `Settings Computer Use WebView used unexpected data directory: ${report.dataDirectory}`)
  assert(report.initialStatus?.phase, 'initial Computer Use status missing')
  assert(report.refreshedStatus?.phase, 'refreshed Computer Use status missing')
  assert(report.initialStatus?.permissions, 'initial Computer Use permissions missing')
  assert(report.refreshedStatus?.permissions, 'refreshed Computer Use permissions missing')
  for (const [gate, value] of Object.entries(report.gates || {})) {
    assert(value === true, `Settings Computer Use WebView gate ${gate} was not true`)
  }
  const serialized = JSON.stringify(report)
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]/.test(serialized), 'Settings Computer Use WebView report leaked key-shaped content')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Settings Computer Use WebView live smoke; set MILKSU_SETTINGS_COMPUTER_USE_WEBVIEW_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Settings Computer Use WebView live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'milksu-settings-computer-use-webview-live-'))
  const fixtureTemp = join(fixtureRoot, 'tmp')
  const appDataDirectory = join(fixtureRoot, 'app-data')
  const appReportPath = join(fixtureRoot, 'settings-computer-use-webview-app-smoke.json')
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
        MILKSU_SETTINGS_COMPUTER_USE_WEBVIEW_SMOKE_RESULT: appReportPath,
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
    assert(!exit.timedOut, 'packaged App did not terminate after Settings Computer Use WebView smoke')

    const report = {
      schema: 'milksu-settings-computer-use-webview-live-smoke/v1',
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
      appReport: {
        schema: appReport.schema,
        ranAt: appReport.ranAt,
        dataDirectory: appReport.dataDirectory,
        initialPermissions: appReport.initialStatus.permissions,
        refreshedPermissions: appReport.refreshedStatus.permissions,
        signing: appReport.refreshedStatus.signing,
        gates: appReport.gates,
      },
      gates: {
        packagedAppOpenedSettings: true,
        packagedAppDisplayedComputerUsePermissions: true,
        packagedAppRecheckedComputerUseReadonly: true,
        keyShapesOmittedFromReport: true,
      },
    }
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged Settings Computer Use WebView live smoke passed.')
    console.log(`  permissions: accessibility=${appReport.refreshedStatus.permissions.accessibility} screenRecording=${appReport.refreshedStatus.permissions.screenRecording}`)
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
