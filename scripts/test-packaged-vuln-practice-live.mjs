#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
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
const resultPath = join(resultsDirectory, 'vuln-practice-live.json')
const appReportPath = join(resultsDirectory, 'vuln-practice-live-app-report.json')
const liveSmokeEnabled = process.env.MILKSU_VULN_PRACTICE_LIVE_SMOKE === '1'
const startupTimeoutMs = 90_000
const shutdownTimeoutMs = 20_000
const imageCandidates = ['debian:12-slim', 'debian:12']
const cveId = 'CVE-2023-46604'
const environmentId = 'vulhub-cve-2023-46604'
const providerKeySentinel = 'MILKSU_FAKE_PROVIDER_KEY_SENTINEL_FOR_VULN_PRACTICE'

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

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.error) throw result.error
  return result
}

function findLocalPracticeImage() {
  for (const image of imageCandidates) {
    const result = docker(['image', 'inspect', image])
    if (result.status === 0) return image
  }
  return ''
}

function spawnPackagedApp({ fixtureHome, fixtureTemp, appDataDirectory, practiceDirectory, reportPath, projectName }) {
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
      DEEPSEEK_API_KEY: providerKeySentinel,
      MILKSU_APPDATA_DIR: appDataDirectory,
      MILKSU_ENABLE_MANAGED_LABS: '0',
      MILKSU_INSTANCE_ID: `vuln-practice-live-${process.pid}-${Date.now()}`,
      MILKSU_VULN_PRACTICE_SMOKE_RESULT: reportPath,
      MILKSU_VULN_PRACTICE_SMOKE_DIRECTORY: practiceDirectory,
      MILKSU_VULN_PRACTICE_SMOKE_CVE: cveId,
      MILKSU_VULN_PRACTICE_SMOKE_ENVIRONMENT: environmentId,
      MILKSU_VULN_PRACTICE_SMOKE_REVISION: 'local benign compose fixture for lifecycle smoke',
      MILKSU_VULN_PRACTICE_SMOKE_PROJECT: projectName,
      MILKSU_VULN_PRACTICE_SMOKE_QUIT: '1',
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

async function waitForReport(path, app) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (app.spawnError()) throw app.spawnError()
    if (app.child.exitCode !== null || app.child.signalCode !== null) {
      throw new Error(
        `packaged App exited before vulnerability practice report `
          + `(code=${app.child.exitCode}, signal=${app.child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `vulnerability practice report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  return readJSON(path)
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

async function writeComposeFixture(directory, image) {
  const compose = [
    'services:',
    '  learner:',
    `    image: ${image}`,
    '    command: ["sh", "-c", "while true; do sleep 5; done"]',
    '    labels:',
    '      org.milksu.fixture: vuln-practice-live',
    '    networks:',
    '      - lab',
    'networks:',
    '  lab:',
    '    internal: true',
    '',
  ].join('\n')
  await fs.writeFile(join(directory, 'docker-compose.yml'), compose, { mode: 0o600 })
}

function assertAppReport(report) {
  assert(report.schema === 'milksu-vuln-practice-packaged-smoke/v1', 'unexpected App report schema')
  assert(!report.error, `App vulnerability practice smoke failed: ${report.error}`)
  assert(report.gates?.packagedAppStartedPractice === true, 'App did not start practice environment')
  assert(report.gates?.packagedAppObservedStatus === true, 'App did not observe practice status')
  assert(report.gates?.packagedAppStoppedPractice === true, 'App did not stop practice environment')
  assert(report.gates?.evidencePersisted === true, 'App did not persist practice evidence')
  assert(report.gates?.noProviderCredentialLeak === true, 'App reported provider credential leakage')
  assert(report.start?.gates?.started === true, 'start gate missing')
  assert(report.status?.containerCount > 0, 'status did not include a running container')
  assert(report.stop?.state === 'stopped', 'stop report did not end stopped')
  const serialized = JSON.stringify(report)
  assert(!serialized.includes(providerKeySentinel), 'App report leaked provider sentinel')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged vulnerability practice live smoke; set MILKSU_VULN_PRACTICE_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged vulnerability practice live smoke requires macOS')
  assert(arch() === 'arm64', 'packaged vulnerability practice live smoke expects darwin/arm64 App build')
  assert(await exists(appExecutable), `missing packaged artifact: ${appExecutable}`)
  assert(docker(['version', '--format', '{{.Server.Version}}']).status === 0, 'Docker daemon is unavailable')
  const image = findLocalPracticeImage()
  assert(image, `no local practice image found; expected one of ${imageCandidates.join(', ')}`)

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-vuln-practice-live-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const appDataDirectory = join(fixtureHome, 'app-data')
  const practiceDirectory = join(fixtureHome, 'vulhub', 'activemq', cveId)
  const rawReportPath = join(fixtureHome, 'vuln-practice-app-report.json')
  const projectName = `milksu-cve-smoke-${process.pid}`.toLowerCase()
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(practiceDirectory, { recursive: true, mode: 0o700 })
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })
  await writeComposeFixture(practiceDirectory, image)

  let app
  try {
    app = spawnPackagedApp({
      fixtureHome,
      fixtureTemp,
      appDataDirectory,
      practiceDirectory,
      reportPath: rawReportPath,
      projectName,
    })
    const appReport = await waitForReport(rawReportPath, app)
    assertAppReport(appReport)
    const exit = await waitForExit(app.child, shutdownTimeoutMs)
    assert(!exit.timedOut, 'packaged App did not quit after vulnerability practice smoke')
    assert(exit.code === 0, `packaged App did not exit cleanly: ${JSON.stringify(exit)}`)
    const remaining = docker([
      'compose',
      '--ansi',
      'never',
      '--project-name',
      projectName,
      '--file',
      join(practiceDirectory, 'docker-compose.yml'),
      'ps',
      '--quiet',
      '--all',
    ], { cwd: practiceDirectory })
    assert(remaining.status === 0, `docker compose ps after stop failed: ${remaining.stderr}`)
    assert(!remaining.stdout.trim(), `practice containers remained after stop: ${remaining.stdout}`)

    await fs.copyFile(rawReportPath, appReportPath)
    await fs.chmod(appReportPath, 0o600)
    const finalReport = {
      schema: 'milksu-vuln-practice-live/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        packagedApp: appBundle,
        isolatedAppData: appDataDirectory,
        practiceDirectory,
        localImage: image,
      },
      app: app.app(),
      exit,
      cveId,
      environmentId,
      projectName,
      evidence: {
        appReportPath,
        appReportRelativePath: relative(repositoryRoot, appReportPath),
        startEvidencePath: appReport.start.evidencePath,
        statusEvidencePath: appReport.status.evidencePath,
        stopEvidencePath: appReport.stop.evidencePath,
      },
      gates: {
        packagedAppStartedPractice: true,
        packagedAppObservedStatus: true,
        packagedAppStoppedPractice: true,
        composeContainersRemoved: true,
        evidencePersisted: true,
        noProviderCredentialLeak: true,
      },
      limitations: [
        'This smoke uses a benign local Compose fixture to verify lifecycle plumbing.',
        'It does not run exploit code, vulnerability-triggering input, or external target traffic.',
      ],
    }
    const serialized = `${JSON.stringify(finalReport, null, 2)}\n`
    assert(!serialized.includes(providerKeySentinel), 'final report leaked provider sentinel')
    await fs.writeFile(resultPath, serialized, { mode: 0o600 })
    console.log('MilkSU packaged vulnerability practice live smoke passed.')
    console.log(`  image: ${image}`)
    console.log(`  project: ${projectName}`)
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    docker([
      'compose',
      '--ansi',
      'never',
      '--project-name',
      projectName,
      '--file',
      join(practiceDirectory, 'docker-compose.yml'),
      'down',
      '--remove-orphans',
      '--volumes',
    ], { cwd: practiceDirectory })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
