#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const sidecar = join(appBundle, 'Contents', 'Resources', 'milksu-sidecar')
const node = join(sidecar, 'node')
const driver = join(sidecar, 'cua-driver')
const proxy = join(sidecar, 'computer-use-proxy.cjs')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'computer-use-live.json')
const resetScreenshotPath = join(resultsDirectory, 'computer-use-live-reset.png')
const afterScreenshotPath = join(resultsDirectory, 'computer-use-live-after.png')
const runtimeRoot = '/private/tmp/milksu-computer-use'
const sessionId = `computer_live-calculator-${Date.now().toString(36)}`
const targetBundleId = 'com.apple.calculator'
const targetName = 'Calculator'
const query = 'MilkSU Computer Use live Calculator smoke'
const observeOptions = {
  include_screenshot: true,
  max_elements: 500,
  max_depth: 25,
  query,
}

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

async function waitForSocket(path, child, stderrRef) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Cua Driver exited before opening socket (code=${child.exitCode}, signal=${child.signalCode}): ${stderrRef()}`,
      )
    }
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        const socket = createConnection(path)
        socket.once('connect', () => {
          socket.end()
          resolvePromise()
        })
        socket.once('error', rejectPromise)
      })
      return
    } catch {
      await delay(100)
    }
  }
  throw new Error(`timed out waiting for Cua Driver socket: ${path}\n${stderrRef()}`)
}

async function driverCall(tool, args, socketPath, cwd) {
  const { stdout } = await execFileAsync(
    driver,
    ['call', tool, JSON.stringify(args), '--socket', socketPath],
    {
      cwd,
      env: {
        HOME: cwd,
        TMPDIR: cwd,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      },
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 32 << 20,
    },
  )
  const text = stdout.trim()
  return text ? JSON.parse(text) : {}
}

async function driverStop(socketPath, cwd) {
  await execFileAsync(driver, ['stop', '--socket', socketPath], {
    cwd,
    env: {
      HOME: cwd,
      TMPDIR: cwd,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
    },
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1 << 20,
  })
}

async function calculatorPID() {
  await execFileAsync('/usr/bin/open', ['-b', targetBundleId], { timeout: 5_000 })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync('/usr/bin/pgrep', ['-x', 'Calculator'], {
        encoding: 'utf8',
        timeout: 2_000,
      })
      const pid = Number(stdout.trim().split(/\s+/).at(-1))
      if (Number.isSafeInteger(pid) && pid > 1) return pid
    } catch {
      // Calculator can take a moment to appear after open(1).
    }
    await delay(100)
  }
  throw new Error('Calculator did not start')
}

function chooseMainWindow(windows, pid) {
  return [...(windows.windows || [])]
    .filter(window => (
      Number(window.pid) === pid &&
      window.is_on_screen !== false &&
      Number(window.bounds?.width) >= 120 &&
      Number(window.bounds?.height) >= 120
    ))
    .sort((left, right) => (
      (Number(right.bounds?.width) * Number(right.bounds?.height)) -
      (Number(left.bounds?.width) * Number(left.bounds?.height))
    ))[0]
}

function mcpRequest(method, params, id) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
}

async function createMcpClient(socketPath, targetWindow, workspace) {
  const child = spawn(
    node,
    [
      proxy,
      '--socket',
      socketPath,
      '--session',
      sessionId,
      '--target-name',
      targetName,
      '--target-bundle-id',
      targetBundleId,
      '--target-pid',
      String(targetWindow.pid),
      '--target-window-id',
      String(targetWindow.window_id),
      '--driver',
      driver,
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        HOME: workspace,
        TMPDIR: workspace,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
  const waiters = new Map()
  child.stdout.on('data', chunk => {
    stdout += chunk
    const lines = stdout.split('\n')
    stdout = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      const response = JSON.parse(line)
      const waiter = waiters.get(response.id)
      if (waiter) {
        waiters.delete(response.id)
        waiter.resolve(response)
      }
    }
  })
  child.stderr.on('data', chunk => {
    if (stderr.length < 16_384) stderr += chunk.slice(0, 16_384 - stderr.length)
  })
  child.once('error', error => {
    for (const [id, waiter] of waiters) {
      clearTimeout(waiter.timeout)
      waiters.delete(id)
      waiter.reject(error)
    }
  })
  child.once('close', (code, signal) => {
    for (const [id, waiter] of waiters) {
      clearTimeout(waiter.timeout)
      waiters.delete(id)
      waiter.reject(new Error(`Computer Use proxy exited (code=${code}, signal=${signal}): ${stderr}`))
    }
  })
  let nextID = 1
  function send(method, params = {}) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(
        new Error(`Computer Use proxy is not running (code=${child.exitCode}, signal=${child.signalCode}): ${stderr}`),
      )
    }
    const id = nextID++
    const promise = new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        waiters.delete(id)
        rejectPromise(new Error(`MCP request ${method} timed out: ${stderr}`))
      }, 20_000)
      waiters.set(id, {
        resolve: value => {
          clearTimeout(timeout)
          resolvePromise(value)
        },
        reject: rejectPromise,
        timeout,
      })
    })
    child.stdin.write(mcpRequest(method, params, id))
    return promise
  }
  return {
    child,
    stderr: () => stderr,
    async initialize() {
      await send('initialize', { protocolVersion: '2025-06-18' })
      const tools = await send('tools/list')
      return tools.result?.tools || []
    },
    async call(args) {
      const response = await send('tools/call', {
        name: 'computer_use',
        arguments: args,
      })
      assert(!response.result?.isError, response.result?.content?.[0]?.text || 'computer_use returned an error')
      const image = (response.result?.content || []).find(item => item?.type === 'image')
      return {
        ...response.result?.structuredContent,
        ...(image ? { image } : {}),
      }
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.stdin.end()
      const closed = await Promise.race([
        new Promise(resolvePromise => child.once('close', () => resolvePromise(true))),
        delay(2_000).then(() => false),
      ])
      if (closed) return
      child.kill('SIGTERM')
      const terminated = await Promise.race([
        new Promise(resolvePromise => child.once('close', () => resolvePromise(true))),
        delay(2_000).then(() => false),
      ])
      if (!terminated) child.kill('SIGKILL')
    },
  }
}

function findButton(observation, labels) {
  return (observation.output?.elements || []).find(element => (
    element.role === 'AXButton' &&
    labels.some(label => element.label === label || String(element.identifier || element.id || '').includes(label))
  ))
}

function displayText(observation) {
  return String(observation.output?.tree_markdown || '')
}

function buttonSummary(observation) {
  return (observation.output?.elements || [])
    .filter(element => element.role === 'AXButton')
    .map(element => `${element.element_index}:${element.label || element.identifier || ''}`)
    .slice(0, 40)
    .join(', ')
}

function screenshotBytes(observation, label) {
  const data = observation.image?.data
  assert(data, `Computer Use ${label} observe did not return a screenshot`)
  return Buffer.from(data, 'base64')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function main() {
  if (process.env.MILKSU_COMPUTER_USE_LIVE_SMOKE !== '1') {
    console.log('Skipping packaged Computer Use live smoke; set MILKSU_COMPUTER_USE_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Computer Use live smoke requires macOS')
  for (const required of [node, driver, proxy]) {
    assert(await exists(required), `missing packaged Computer Use artifact: ${required}`)
  }

  const pid = await calculatorPID()
  const workspace = join(runtimeRoot, sessionId)
  const socketPath = join(workspace, 'driver.sock')
  const policyPath = join(workspace, 'session-policy.yaml')
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 })
  await fs.writeFile(policyPath, `version: 2
mode: bounded
expires_after: 8h
idle_timeout: 30m
resources:
  apps:
    - bundle_id: ${targetBundleId}
      launch: false
      windows: all
      terminate: deny
allow:
  tools:
    - check_permissions
    - start_session
    - get_session_state
    - end_session
    - list_windows
    - get_window_state
    - click
    - type_text
    - press_key
    - scroll
deny:
  tools:
    - get_desktop_state
    - launch_app
    - hotkey
    - drag
    - page
    - browser_prepare
    - escalate_session
    - start_recording
`, { mode: 0o600 })

  let driverStderr = ''
  const driverProcess = spawn(driver, [
    'serve',
    '--embedded',
    '--host-bundle-id',
    'com.milksu.app',
    '--socket',
    socketPath,
    '--permission-mode',
    'bounded',
    '--session-policy',
    policyPath,
    '--approve-session-policy',
    '--no-permissions-gate',
  ], {
    cwd: workspace,
    env: {
      HOME: workspace,
      TMPDIR: workspace,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      CUA_DRIVER_EMBEDDED: '1',
      CUA_DRIVER_HOST_BUNDLE_ID: 'com.milksu.app',
      CUA_DRIVER_PERMISSION_MODE: 'bounded',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      CUA_LOG: 'warn',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  driverProcess.stderr.setEncoding('utf8')
  driverProcess.stderr.on('data', chunk => {
    if (driverStderr.length < 16_384) driverStderr += chunk.slice(0, 16_384 - driverStderr.length)
  })

  let client
  try {
    await waitForSocket(socketPath, driverProcess, () => driverStderr)
    const windows = await driverCall('list_windows', { pid, on_screen_only: true }, socketPath, workspace)
    const targetWindow = chooseMainWindow(windows, pid)
    assert(targetWindow, `Calculator main window not found: ${JSON.stringify(windows)}`)

    client = await createMcpClient(socketPath, targetWindow, workspace)
    const tools = await client.initialize()
    assert(tools.length === 1 && tools[0].name === 'computer_use', 'Computer Use proxy exposed an unexpected tool surface')

    const initial = await client.call({ action: 'observe', ...observeOptions })
    const clearButton = findButton(initial, ['AC', 'AllClear', '全部清除', 'Clear', '清除'])
    if (clearButton) {
      await client.call({ action: 'click', element_index: clearButton.element_index })
    }
    const reset = await client.call({ action: 'observe', ...observeOptions })
    const oneButton = findButton(reset, ['1', 'One'])
    assert(
      oneButton,
      `Calculator button 1 not found: ${buttonSummary(reset) || displayText(reset).slice(0, 1600)}`,
    )
    const resetScreenshot = screenshotBytes(reset, 'reset')
    const resetHash = sha256(resetScreenshot)
    const click = await client.call({ action: 'click', element_index: oneButton.element_index })
    const after = await client.call({ action: 'observe', ...observeOptions })
    const afterScreenshot = screenshotBytes(after, 'after')
    const afterHash = sha256(afterScreenshot)
    assert(
      resetHash !== afterHash,
      `Calculator screenshot did not change after clicking button 1: ${buttonSummary(after) || displayText(after).slice(0, 1600)}`,
    )
    assert(click.action === 'click', 'Computer Use proxy did not report click action')
    assert(click.target?.bundleId === targetBundleId, 'Computer Use proxy target bundle changed')
    assert(Number(click.target?.pid) === pid, 'Computer Use proxy target PID changed')
    assert(Number(click.target?.windowId) === Number(targetWindow.window_id), 'Computer Use proxy target window changed')

    const report = {
      schema: 'milksu-computer-use-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
      },
      target: {
        sessionId,
        app: targetName,
        bundleId: targetBundleId,
        pid,
        windowId: Number(targetWindow.window_id),
        bounds: targetWindow.bounds,
        title: targetWindow.title,
      },
      operation: {
        observeBefore: true,
        click: true,
        observeAfter: true,
        clickedElement: oneButton.element_index,
        visualChangeVerified: true,
        resetScreenshot: resetScreenshotPath,
        afterScreenshot: afterScreenshotPath,
        resetScreenshotSha256: resetHash,
        afterScreenshotSha256: afterHash,
      },
      scope: {
        capture: 'window',
        desktopAccess: false,
        launchAppDenied: true,
        targetBundleImmutable: true,
      },
    }
    await fs.mkdir(resultsDirectory, { recursive: true })
    await fs.writeFile(resetScreenshotPath, resetScreenshot, { mode: 0o600 })
    await fs.writeFile(afterScreenshotPath, afterScreenshot, { mode: 0o600 })
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged Computer Use live smoke passed.')
    console.log(`  target: ${targetBundleId} PID ${pid} Window ${targetWindow.window_id}`)
    console.log('  operation: observe -> click 1 -> observe screenshot changed')
    console.log(`  report: ${resultPath}`)
  } finally {
    if (client) await client.close().catch(() => {})
    try {
      await driverStop(socketPath, workspace)
    } catch {
      driverProcess.kill('SIGTERM')
    }
    await new Promise(resolvePromise => {
      if (driverProcess.exitCode !== null || driverProcess.signalCode !== null) {
        resolvePromise()
        return
      }
      const timeout = setTimeout(() => {
        driverProcess.kill('SIGKILL')
        resolvePromise()
      }, 2_000)
      driverProcess.once('exit', () => {
        clearTimeout(timeout)
        resolvePromise()
      })
    })
    await fs.rm(workspace, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
