#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, release, tmpdir } from 'node:os'
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
const packagedSidecar = join(appBundle, 'Contents', 'Resources', 'milksu-sidecar')
const frontendDist = join(repositoryRoot, 'app', 'dist')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'local-delivery-baseline.json')
const startupTimeoutMs = 30_000
const idleSampleDelayMs = 2_000
const shutdownTimeoutMs = 10_000

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

async function inspectTree(root) {
  const files = []
  let directories = 0
  let symlinks = 0
  let bytes = 0

  async function walk(directory) {
    directories += 1
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      const stat = await fs.lstat(path)
      if (entry.isSymbolicLink()) symlinks += 1
      if (entry.isFile()) {
        bytes += stat.size
        files.push({
          path: relative(root, path).split('\\').join('/'),
          bytes: stat.size,
        })
      }
    }
  }

  await walk(root)
  files.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path))
  return {
    bytes,
    fileCount: files.length,
    directoryCount: directories,
    symlinkCount: symlinks,
    largestFiles: files.slice(0, 8),
  }
}

async function readProcessRows() {
  const { stdout } = await execFileAsync('/bin/ps', [
    '-axo',
    'pid=,ppid=,rss=,comm=',
  ])
  return stdout
    .split('\n')
    .map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/))
    .filter(Boolean)
    .map(match => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKiB: Number(match[3]),
      command: match[4],
    }))
}

function processTree(rows, rootPID) {
  const selected = new Set([rootPID])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (selected.has(row.ppid) && !selected.has(row.pid)) {
        selected.add(row.pid)
        changed = true
      }
    }
  }
  return rows.filter(row => selected.has(row.pid))
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

function configuredWindowBounds(source) {
  const minWidth = Number(source.match(/\bMinWidth:\s*(\d+)/)?.[1])
  const minHeight = Number(source.match(/\bMinHeight:\s*(\d+)/)?.[1])
  const defaultWidth = Number(source.match(/\bWidth:\s*(\d+)/)?.[1])
  const defaultHeight = Number(source.match(/\bHeight:\s*(\d+)/)?.[1])
  return { defaultWidth, defaultHeight, minWidth, minHeight }
}

function printableMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

async function main() {
  assert(platform() === 'darwin', 'the packaged App baseline currently requires macOS')
  for (const required of [appExecutable, packagedSidecar, frontendDist]) {
    assert(await exists(required), `required build artifact is missing: ${required}`)
  }

  const processRowsBefore = await readProcessRows()
  const alreadyRunning = processRowsBefore.find(
    row => row.command.includes('/MilkSU.app/Contents/MacOS/MilkSU'),
  )
  assert(
    !alreadyRunning,
    `refusing to disturb an existing MilkSU App process (PID ${alreadyRunning?.pid})`,
  )

  const [appSize, sidecarSize, frontendSize, mainSource] = await Promise.all([
    inspectTree(appBundle),
    inspectTree(packagedSidecar),
    inspectTree(frontendDist),
    fs.readFile(join(repositoryRoot, 'main.go'), 'utf8'),
  ])
  const windowBounds = configuredWindowBounds(mainSource)
  assert(
    windowBounds.minWidth === 1080 && windowBounds.minHeight === 680,
    `minimum window changed to ${windowBounds.minWidth}x${windowBounds.minHeight}`,
  )

  const infoPlist = join(appBundle, 'Contents', 'Info.plist')
  const [{ stdout: bundleIdentifier }, { stdout: bundleVersion }] = await Promise.all([
    execFileAsync('/usr/bin/plutil', [
      '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist,
    ]),
    execFileAsync('/usr/bin/plutil', [
      '-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist,
    ]),
  ])
  assert(
    bundleIdentifier.trim() === 'com.milksu.app',
    `unexpected bundle identifier: ${bundleIdentifier.trim()}`,
  )

  const fixtureHome = await fs.mkdtemp(join(tmpdir(), 'milksu-local-delivery-'))
  const fixtureTemp = join(fixtureHome, 'tmp')
  const lifespanPath = join(
    fixtureHome,
    'Library',
    'Application Support',
    'com.milksu.app',
    'lifespan.json',
  )
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })

  let child
  let stdoutBytes = 0
  let stderrBytes = 0
  let spawnError
  let forcedShutdown = false
  try {
    const startedAt = performance.now()
    child = spawn(appExecutable, [], {
      cwd: fixtureHome,
      env: {
        HOME: fixtureHome,
        TMPDIR: fixtureTemp,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        MILKSU_ENABLE_MANAGED_LABS: '0',
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

    const deadline = performance.now() + startupTimeoutMs
    while (!(await exists(lifespanPath))) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `packaged App exited before its startup marker (code=${child.exitCode}, signal=${child.signalCode})`,
        )
      }
      assert(performance.now() < deadline, `startup marker exceeded ${startupTimeoutMs} ms`)
      await delay(50)
    }
    const startupMarkerMs = Math.round(performance.now() - startedAt)

    const startupState = JSON.parse(await fs.readFile(lifespanPath, 'utf8'))
    assert(startupState.schema === 'milksu-lifespan/v1', 'unexpected lifespan schema')
    assert(startupState.lastExit === 'running', 'App did not record a running lifespan')
    assert(startupState.pid === child.pid, 'lifespan PID does not match the launched App')

    await delay(idleSampleDelayMs)
    const rows = processTree(await readProcessRows(), child.pid)
    const idleRSSKiB = rows.reduce((total, row) => total + row.rssKiB, 0)
    assert(rows.length > 0 && idleRSSKiB > 0, 'could not sample the App process tree RSS')

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    if (exit.timedOut) {
      forcedShutdown = true
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate')
    assert(!forcedShutdown, 'packaged App required SIGKILL instead of graceful SIGTERM')

    const shutdownState = JSON.parse(await fs.readFile(lifespanPath, 'utf8'))
    assert(shutdownState.lastExit === 'clean', 'graceful shutdown did not record a clean exit')

    const frontendChunks = frontendSize.largestFiles.filter(
      file => file.path.endsWith('.js') || file.path.endsWith('.css'),
    )
    const report = {
      schema: 'milksu-local-delivery-baseline/v1alpha1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        osRelease: release(),
        isolatedHome: true,
        providerConfigurationPresent: false,
        providerCredentialsUsed: false,
      },
      app: {
        bundleIdentifier: bundleIdentifier.trim(),
        version: bundleVersion.trim(),
        size: appSize,
        startupMarkerMs,
        idleSampleDelayMs,
        idleRSSBytes: idleRSSKiB * 1024,
        processCount: rows.length,
        gracefulShutdown: true,
        firstRunWithoutProviderConfiguration: true,
        stdoutBytes,
        stderrBytes,
      },
      sidecar: sidecarSize,
      frontend: {
        ...frontendSize,
        largestChunks: frontendChunks,
      },
      window: windowBounds,
      gates: {
        buildArtifactsPresent: true,
        startupWithin30Seconds: startupMarkerMs <= startupTimeoutMs,
        lifespanStartedAndExitedCleanly: true,
        minimumWindow1080x680: true,
        isolatedNoProviderFirstRun: true,
      },
    }

    await fs.mkdir(resultsDirectory, { recursive: true })
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU local delivery baseline passed.')
    console.log(`  startup marker: ${startupMarkerMs} ms`)
    console.log(`  idle process-tree RSS: ${printableMiB(report.app.idleRSSBytes)}`)
    console.log(`  App logical size: ${printableMiB(appSize.bytes)}`)
    console.log(`  packaged Sidecar logical size: ${printableMiB(sidecarSize.bytes)}`)
    console.log(`  frontend dist logical size: ${printableMiB(frontendSize.bytes)}`)
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
