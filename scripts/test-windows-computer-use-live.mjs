#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { createConnection } from 'node:net'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sidecar = resolve(
  process.env.MILKSU_SIDECAR_DIR
  || join(repositoryRoot, 'build', 'sidecar', 'windows-amd64'),
)
const driver = join(sidecar, 'cua-driver.exe')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'windows-computer-use-live.json')
const sessionId = `computer_live-window-${Date.now().toString(36)}`
const token = `MILKSU_CUA_${Date.now().toString(36).toUpperCase()}`
const socketPath = `\\\\.\\pipe\\milksu-computer-use-${sessionId}`

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

function driverEnv(workspace) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    USERPROFILE: join(workspace, 'home'),
    APPDATA: join(workspace, 'home', 'AppData', 'Roaming'),
    LOCALAPPDATA: join(workspace, 'home', 'AppData', 'Local'),
    TEMP: join(workspace, 'tmp'),
    TMP: join(workspace, 'tmp'),
    PATH: join(systemRoot, 'System32'),
    CUA_DRIVER_EMBEDDED: '1',
    CUA_DRIVER_HOST_BUNDLE_ID: 'com.milksu.app',
    CUA_DRIVER_PERMISSION_MODE: 'bounded',
    CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
    CUA_LOG: 'warn',
  }
}

async function waitForPipe(path, child, stderrRef) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Cua Driver exited before opening named pipe (code=${child.exitCode}, signal=${child.signalCode}): ${stderrRef()}`,
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
      await delay(80)
    }
  }
  throw new Error(`timed out waiting for Cua Driver named pipe: ${path}\n${stderrRef()}`)
}

async function driverCall(tool, args, workspace) {
  const { stdout, stderr } = await execFileAsync(
    driver,
    ['call', tool, JSON.stringify(args), '--socket', socketPath],
    {
      cwd: workspace,
      env: driverEnv(workspace),
      encoding: 'utf8',
      timeout: 25_000,
      maxBuffer: 32 << 20,
    },
  )
  const text = stdout.trim()
  if (!text) {
    throw new Error(`empty ${tool} response: ${stderr}`)
  }
  return JSON.parse(text)
}

async function driverStop(workspace) {
  await execFileAsync(driver, ['stop', '--socket', socketPath], {
    cwd: workspace,
    env: driverEnv(workspace),
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1 << 20,
  })
}

async function processPath(pid, workspace) {
  const helper = join(workspace, 'process-path.ps1')
  await fs.writeFile(helper, [
    'param([int]$ProcessId)',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public static class MilkSUProcessPath {',
    '  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint a, bool b, int pid);',
    '  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]',
    '  static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);',
    '  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
    '  public static string Path(int pid) {',
    '    var handle = OpenProcess(0x1000, false, pid);',
    '    if (handle == IntPtr.Zero) return "";',
    '    try {',
    '      var buffer = new StringBuilder(32768);',
    '      int size = buffer.Capacity;',
    '      return QueryFullProcessImageName(handle, 0, buffer, ref size) ? buffer.ToString() : "";',
    '    } finally { CloseHandle(handle); }',
    '  }',
    '}',
    '"@',
    '[Console]::Out.Write([MilkSUProcessPath]::Path($ProcessId))',
    '',
  ].join('\r\n'), { mode: 0o600 })
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, String(pid)],
    { encoding: 'utf8', timeout: 8_000 },
  )
  return stdout.trim()
}

function yamlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function chooseTargetWindow(windows, marker) {
  return [...(windows.windows || [])]
    .filter(window => {
      const title = String(window.title || '')
      return (
        window.is_on_screen !== false
        && Number(window.bounds?.width) >= 80
        && Number(window.bounds?.height) >= 80
        && title.toLowerCase().includes(marker.toLowerCase())
      )
    })
    .sort((left, right) => (
      (Number(right.bounds?.width) * Number(right.bounds?.height))
      - (Number(left.bounds?.width) * Number(left.bounds?.height))
    ))[0]
}

function collectText(value, into = []) {
  if (value == null) return into
  if (typeof value === 'string' || typeof value === 'number') {
    into.push(String(value))
    return into
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, into)
    return into
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, into)
  }
  return into
}

function observationText(observation) {
  return collectText(observation).join('\n')
}

function findEditableElement(observation) {
  const elements = observation.output?.elements
    || observation.structuredContent?.elements
    || observation.elements
    || []
  const preferredRoles = ['document', 'edit', 'textbox', 'text']
  return elements.find(element => {
    const role = String(element.role || element.control_type || '').toLowerCase()
    const name = String(element.label || element.name || element.value || '')
    return preferredRoles.some(item => role.includes(item))
      && !name.toLowerCase().includes('find')
  }) || elements.find(element => Number.isInteger(element.element_index))
}

async function buildLiveTarget(workspace) {
  const source = join(repositoryRoot, 'scripts', 'windows-cua-live-target.go')
  const binary = join(workspace, 'milksu-cua-live-target.exe')
  await execFileAsync('go', ['build', '-o', binary, source], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return binary
}

async function startLiveTarget(binary, title) {
  const child = spawn(binary, [title], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  return child
}

async function stopTarget(pid) {
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      timeout: 5_000,
    })
  } catch {
    // The window may already have closed.
  }
}

async function main() {
  assert(platform() === 'win32', 'Windows Computer Use live smoke requires Windows')
  assert(await exists(driver), `missing bundled Cua Driver: ${driver}`)

  const { stdout: version } = await execFileAsync(driver, ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      PATH: join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    },
  })
  assert(version.trim() === 'cua-driver 0.14.2', `unexpected driver version: ${version.trim()}`)

  const workspace = join(tmpdir(), 'milksu-computer-use', sessionId)
  const marker = `milksu-cua-${Date.now().toString(36)}`
  await fs.mkdir(join(workspace, 'home', 'AppData', 'Roaming'), { recursive: true, mode: 0o700 })
  await fs.mkdir(join(workspace, 'home', 'AppData', 'Local'), { recursive: true, mode: 0o700 })
  await fs.mkdir(join(workspace, 'tmp'), { recursive: true, mode: 0o700 })
  const targetBinary = await buildLiveTarget(workspace)
  const target = await startLiveTarget(targetBinary, marker)

  let driverProcess
  let targetPid
  try {
    await delay(400)
    const policyPath = join(workspace, 'session-policy.yaml')
    const launchedPid = target.pid
    const executable = await processPath(launchedPid, workspace) || targetBinary
    const realPath = await fs.realpath(executable)
    const policyExecutable = realPath.startsWith('\\\\?\\') ? realPath : `\\\\?\\${realPath}`
    console.error(`resolved live target pid=${launchedPid} executable=${policyExecutable}`)

    await fs.writeFile(policyPath, `version: 2
mode: bounded
expires_after: 8h
idle_timeout: 30m
resources:
  apps:
    - executable: ${yamlQuote(policyExecutable)}
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
    driverProcess = spawn(driver, [
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
      env: driverEnv(workspace),
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    driverProcess.stderr.setEncoding('utf8')
    driverProcess.stderr.on('data', chunk => {
      if (driverStderr.length < 16_384) driverStderr += chunk.slice(0, 16_384 - driverStderr.length)
    })

    await waitForPipe(socketPath, driverProcess, () => driverStderr)
    const windows = await driverCall('list_windows', {
      pid: launchedPid,
      on_screen_only: true,
    }, workspace)
    const targetWindow = chooseTargetWindow(windows, marker)
    assert(targetWindow, `live target window not found: ${JSON.stringify(windows)}`)
    targetPid = Number(targetWindow.pid)

    await driverCall('start_session', {
      session: sessionId,
      capture_scope: 'window',
    }, workspace)

    const before = await driverCall('get_window_state', {
      pid: targetPid,
      window_id: Number(targetWindow.window_id),
      session: sessionId,
      include_screenshot: false,
      max_elements: 200,
      max_depth: 18,
    }, workspace)
    assert(
      !observationText(before).includes(token),
      'live target already contained the token before type_text',
    )
    const field = findEditableElement(before)
    assert(
      field && Number.isInteger(field.element_index),
      `live target edit field not found: ${observationText(before).slice(0, 1600)}`,
    )

    const typed = await driverCall('type_text', {
      pid: targetPid,
      window_id: Number(targetWindow.window_id),
      session: sessionId,
      text: token,
      element_index: field.element_index,
      ...(field.element_token ? { element_token: field.element_token } : {}),
      delivery_mode: 'background',
    }, workspace)

    const after = await driverCall('get_window_state', {
      pid: targetPid,
      window_id: Number(targetWindow.window_id),
      session: sessionId,
      include_screenshot: false,
      max_elements: 200,
      max_depth: 18,
    }, workspace)
    const afterText = observationText(after)
    assert(
      afterText.includes(token),
      `live target did not contain typed token after type_text: ${afterText.slice(0, 2000)}\ncall=${JSON.stringify(typed).slice(0, 1000)}`,
    )

    const report = {
      schema: 'milksu-windows-computer-use-live/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        driver,
        driverVersion: version.trim(),
      },
      target: {
        sessionId,
        app: 'milksu-cua-live-target',
        executable,
        pid: targetPid,
        windowId: Number(targetWindow.window_id),
        bounds: targetWindow.bounds,
        title: targetWindow.title,
      },
      operation: {
        observeBefore: true,
        typeText: true,
        observeAfter: true,
        typedElement: field.element_index,
        token,
        textChangeVerified: true,
      },
      scope: {
        capture: 'window',
        desktopAccess: false,
        launchAppDenied: true,
        userInstalledDriver: false,
      },
    }
    await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU Windows Computer Use live smoke passed.')
    console.log(`  target: ${executable} PID ${targetPid} Window ${targetWindow.window_id}`)
    console.log(`  operation: observe -> type_text ${token} -> observe token present`)
    console.log(`  report: ${resultPath}`)
  } finally {
    try {
      await driverStop(workspace)
    } catch {
      if (driverProcess && driverProcess.exitCode === null) driverProcess.kill()
    }
    if (targetPid) await stopTarget(targetPid)
    if (target.pid && target.pid !== targetPid) await stopTarget(target.pid)
    await fs.rm(workspace, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
