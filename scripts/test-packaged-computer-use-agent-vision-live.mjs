#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createConnection } from 'node:net'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  computerUseRuntimeRoot,
  computerUseSocket,
  ephemeralRoot,
} from '../sidecar/hostpath.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const sidecar = join(appBundle, 'Contents', 'Resources', 'milksu-sidecar')
const node = join(sidecar, 'node')
const driver = join(sidecar, 'cua-driver')
const chatBridge = join(sidecar, 'chat-bridge.cjs')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'computer-use-agent-vision-live.json')
const beforeScreenshotPath = join(resultsDirectory, 'computer-use-agent-vision-live-before.png')
const afterScreenshotPath = join(resultsDirectory, 'computer-use-agent-vision-live-after.png')
const liveSmokeEnabled = process.env.MILKSU_COMPUTER_USE_AGENT_VISION_LIVE_SMOKE === '1'
const sessionId = `computer_agent-vision-${Date.now().toString(36)}`
const targetBundleId = 'com.apple.calculator'
const targetName = 'Calculator'
const computerUseMcpToolName = 'milksu_computer_use_computer_use'
const startupTimeoutMs = 45_000
const fixtureProvider = 'tokenflux'
const fixtureModel = 'grok-4.3'

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
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
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
        CUA_DRIVER_EMBEDDED: '1',
        CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
        CUA_LOG: 'warn',
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
      CUA_DRIVER_EMBEDDED: '1',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      CUA_LOG: 'warn',
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
      const { stdout } = await execFileAsync('/usr/bin/pgrep', ['-x', targetName], {
        encoding: 'utf8',
        timeout: 2_000,
      })
      const pid = Number(stdout.trim().split(/\s+/).at(-1))
      if (Number.isSafeInteger(pid) && pid > 1) return pid
    } catch {
      // The user may have closed Calculator; open(1) can take a moment to show it again.
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

function findButton(observation, labels) {
  return (observation.elements || observation.output?.elements || []).find(element => (
    element.role === 'AXButton' &&
    labels.some(label => element.label === label || String(element.identifier || element.id || '').includes(label))
  ))
}

function buttonSummary(observation) {
  return (observation.elements || observation.output?.elements || [])
    .filter(element => element.role === 'AXButton')
    .map(element => `${element.element_index}:${element.label || element.identifier || ''}`)
    .slice(0, 60)
    .join(', ')
}

function directScreenshotBytes(observation, label) {
  const data = observation.screenshot_png_b64 || observation.output?.screenshot_png_b64
  assert(data, `Computer Use ${label} observe did not return a screenshot`)
  return Buffer.from(data, 'base64')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requestUsage(entry, body) {
  const promptTokens = Math.max(10, Math.ceil(JSON.stringify(body.messages ?? []).length / 4))
  const completionTokens = entry.type === 'tool'
    ? 4
    : Math.max(4, Math.ceil(String(entry.text ?? '').length / 4))
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
}

function sendSSE(response, sequence, entry, body) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'close',
  })
  const base = {
    id: `computer-use-agent-vision-${sequence}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: body.model ?? 'milksu-local-fixture',
  }
  if (entry.type === 'tool') {
    const available = new Set(
      (body.tools ?? []).map(value => value?.function?.name).filter(Boolean),
    )
    assert(available.has(entry.name), `fake provider requested unavailable tool ${entry.name}`)
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: `computer-use-agent-vision-call-${sequence}`,
            type: 'function',
            function: {
              name: entry.name,
              arguments: JSON.stringify(entry.args),
            },
          }],
        },
        finish_reason: null,
      }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: requestUsage(entry, body),
    })}\n\n`)
  } else {
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: entry.text },
        finish_reason: 'stop',
      }],
      usage: requestUsage(entry, body),
    })}\n\n`)
  }
  response.end('data: [DONE]\n\n')
}

function sendResponsesSSE(response, sequence, entry, body) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'close',
  })
  const responseId = `resp_computer_use_agent_vision_${sequence}`
  const itemId = `msg_computer_use_agent_vision_${sequence}`
  const text = String(entry.text ?? '')
  const outputItem = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
  const usage = {
    input_tokens: Math.max(16, Math.ceil(JSON.stringify(body.input ?? []).length / 4)),
    output_tokens: Math.max(4, Math.ceil(text.length / 4)),
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
  usage.total_tokens = usage.input_tokens + usage.output_tokens

  response.write(`data: ${JSON.stringify({
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      status: 'in_progress',
      model: body.model ?? 'milksu-local-fixture',
      output: [],
    },
  })}\n\n`)
  response.write(`data: ${JSON.stringify({
    type: 'response.output_item.added',
    output_index: 0,
    item: { ...outputItem, status: 'in_progress', content: [] },
  })}\n\n`)
  response.write(`data: ${JSON.stringify({
    type: 'response.output_text.delta',
    output_index: 0,
    content_index: 0,
    delta: text,
  })}\n\n`)
  response.write(`data: ${JSON.stringify({
    type: 'response.output_item.done',
    output_index: 0,
    item: outputItem,
  })}\n\n`)
  response.write(`data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      status: 'completed',
      model: body.model ?? 'milksu-local-fixture',
      output: [outputItem],
      usage,
    },
  })}\n\n`)
  response.end('data: [DONE]\n\n')
}

function hasImageInput(body) {
  const serialized = JSON.stringify([body.messages ?? [], body.input ?? []])
  return serialized.includes('"type":"image"') || serialized.includes('"type":"input_image"')
}

function eventPayloadIncludes(event, value) {
  return [
    JSON.stringify(event.input ?? {}),
    String(event.content ?? ''),
  ].some(text => text.includes(value))
}

async function startFakeProvider(clickElementIndex) {
  let sequence = 0
  let mainRequests = 0
  let visionRequests = 0
  let secondMainSawVisualEvidence = false
  let secondMainSawVisionDescription = false
  let secondMainSawAXTree = false
  const requests = []
  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = String(request.url)
      if (request.method !== 'POST' || (!requestUrl.includes('chat/completions') && !requestUrl.endsWith('/responses'))) {
        response.writeHead(404).end()
        return
      }
      let raw = ''
      request.setEncoding('utf8')
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      sequence += 1
      const serialized = JSON.stringify(body)
      if (hasImageInput(body)) {
        visionRequests += 1
        requests.push({ sequence, kind: 'vision', model: body.model })
        const entry = {
          type: 'text',
          text:
            'The screenshot shows the macOS Calculator window. '
            + 'A numeric keypad is visible, including a button labeled 1 that should be clicked.',
        }
        if (requestUrl.endsWith('/responses')) {
          sendResponsesSSE(response, sequence, entry, body)
        } else {
          sendSSE(response, sequence, entry, body)
        }
        return
      }

      mainRequests += 1
      requests.push({ sequence, kind: 'main', model: body.model, mainRequests })
      if (mainRequests === 1) {
        sendSSE(response, sequence, {
          type: 'tool',
          name: 'mcp',
          args: {
            server: 'milksu-computer-use',
            tool: computerUseMcpToolName,
            args: {
              action: 'observe',
              include_screenshot: true,
              max_elements: 500,
              max_depth: 25,
              query: 'Locate the Calculator button labeled 1.',
            },
          },
        }, body)
        return
      }
      if (mainRequests === 2) {
        secondMainSawVisualEvidence = serialized.includes('[MilkSU Computer Use visual evidence]')
        secondMainSawVisionDescription = serialized.includes('button labeled 1')
        secondMainSawAXTree = /AXButton|element_index|tree_markdown/.test(serialized)
        assert(
          secondMainSawVisualEvidence && secondMainSawVisionDescription,
          'main model request did not receive Computer Use auxiliary visual evidence before clicking',
        )
        sendSSE(response, sequence, {
          type: 'tool',
          name: 'mcp',
          args: {
            server: 'milksu-computer-use',
            tool: computerUseMcpToolName,
            args: {
              action: 'click',
              element_index: clickElementIndex,
            },
          },
        }, body)
        return
      }
      if (mainRequests === 3) {
        sendSSE(response, sequence, {
          type: 'text',
          text: 'Clicked the Calculator 1 button after reading MilkSU Computer Use visual evidence.',
        }, body)
        return
      }
      throw new Error(`unexpected extra main model request ${mainRequests}`)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    stats: () => ({
      mainRequests,
      visionRequests,
      secondMainSawVisualEvidence,
      secondMainSawVisionDescription,
      secondMainSawAXTree,
    }),
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

function parseBridgeLines(stdoutBuffer, events, waiters) {
  let buffer = stdoutBuffer
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n')
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const event = JSON.parse(line)
    events.push(event)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue
      waiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.resolve(event)
    }
  }
  return buffer
}

function startBridge({
  workspace,
  agentDirectory,
  baseURL,
  computerUse,
}) {
  const workspaceRuntime = join(workspace, '.milksu', 'runtime')
  const child = spawn(
    node,
    [
      '--permission',
      '--allow-addons',
      '--allow-child-process',
      `--allow-fs-read=${sidecar}`,
      `--allow-fs-read=${workspace}`,
      `--allow-fs-read=${agentDirectory}`,
      `--allow-fs-read=${dirname(node)}`,
      `--allow-fs-write=${workspace}`,
      `--allow-fs-write=${agentDirectory}`,
      `--allow-fs-read=${ephemeralRoot()}`,
      `--allow-fs-write=${ephemeralRoot()}`,
      '--allow-fs-read=/bin/bash',
      '--allow-fs-read=/bin/sh',
      '--allow-fs-read=/usr/bin/env',
      '--allow-fs-read=/usr/bin/sandbox-exec',
      chatBridge,
    ],
    {
      cwd: workspace,
      env: {
        HOME: dirname(workspace),
        TMPDIR: join(workspaceRuntime, 'tmp'),
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        TOKENFLUX_API_KEY: 'fixture-only-not-a-secret',
        TOKENFLUX_BASE_URL: baseURL,
        OPENAI_API_KEY: 'fixture-vision-not-a-secret',
        OPENAI_BASE_URL: baseURL,
        MILKSU_VISION_PROVIDER: 'openai',
        MILKSU_VISION_MODEL: 'gpt-4o',
        MILKSU_PI_AGENT_DIR: agentDirectory,
        MILKSU_WORKSPACE_RUNTIME: workspaceRuntime,
        MILKSU_BACKGROUND_TASKS_DIR: join(workspaceRuntime, 'background-tasks'),
        MILKSU_VISION_CACHE: join(workspaceRuntime, 'vision-cache.json'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const events = []
  const waiters = new Set()
  let stderr = ''
  let stdoutBuffer = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    if (stderr.length < 64_000) stderr += chunk.slice(0, 64_000 - stderr.length)
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdoutBuffer = parseBridgeLines(stdoutBuffer + chunk, events, waiters)
  })
  child.once('error', error => {
    for (const waiter of [...waiters]) {
      waiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  })
  child.once('close', (code, signal) => {
    for (const waiter of [...waiters]) {
      waiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`chat bridge exited (code=${code}, signal=${signal}): ${stderr}`))
    }
  })

  function command(value) {
    child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  function waitFor(predicate, timeoutMs = startupTimeoutMs) {
    const existing = events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = {
        predicate,
        resolve: resolvePromise,
        reject: rejectPromise,
        timer: setTimeout(() => {
          waiters.delete(waiter)
          rejectPromise(new Error(
            `bridge event timeout\nstderr: ${stderr}\nrecent events: `
            + JSON.stringify(events.slice(-20), null, 2),
          ))
        }, timeoutMs),
      }
      waiters.add(waiter)
    })
  }

  async function createSession() {
    const start = events.length
    command({
      action: 'create_session',
      conversationId: 'computer-use-agent-vision-live',
      provider: fixtureProvider,
      model: fixtureModel,
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      computerUse,
    })
    return await waitFor(
      event => events.indexOf(event) >= start
        && event.type === 'ready'
        && event.id === 'computer-use-agent-vision-live',
    )
  }

  async function prompt(text) {
    const start = events.length
    command({
      action: 'send_message',
      conversationId: 'computer-use-agent-vision-live',
      provider: fixtureProvider,
      model: fixtureModel,
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      computerUse,
      prompt: text,
    })
    const done = await waitFor(
      event => events.indexOf(event) >= start
        && event.id === 'computer-use-agent-vision-live'
        && (event.type === 'message_done' || event.type === 'error'),
      60_000,
    )
    if (done.type === 'error') throw new Error(done.error)
    return events.slice(start)
  }

  async function destroy() {
    if (child.exitCode !== null || child.signalCode !== null) return
    command({
      action: 'destroy_session',
      conversationId: 'computer-use-agent-vision-live',
    })
    await waitFor(
      event => event.type === 'session_destroyed'
        && event.id === 'computer-use-agent-vision-live',
      5_000,
    ).catch(() => undefined)
  }

  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await once(child, 'close')
  }

  return { events, createSession, prompt, destroy, stop }
}

async function observeForSetup(socketPath, workspace, targetWindow, clickElementIndex = undefined) {
  const preflightSession = `${sessionId}-setup`
  await driverCall('start_session', {
    session: preflightSession,
    capture_scope: 'window',
  }, socketPath, workspace)
  try {
    const observed = await driverCall('get_window_state', {
      session: preflightSession,
      pid: targetWindow.pid,
      window_id: Number(targetWindow.window_id),
      include_screenshot: true,
      max_elements: 500,
      max_depth: 25,
      query: 'Prepare Calculator for Computer Use agent vision smoke.',
    }, socketPath, workspace)
    if (clickElementIndex !== undefined) {
      await driverCall('click', {
        session: preflightSession,
        pid: targetWindow.pid,
        window_id: Number(targetWindow.window_id),
        scope: 'window',
        delivery_mode: 'background',
        element_index: clickElementIndex,
      }, socketPath, workspace)
    }
    return observed
  } finally {
    await driverCall('end_session', { session: preflightSession }, socketPath, workspace)
      .catch(() => undefined)
  }
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged Computer Use agent vision live smoke; set MILKSU_COMPUTER_USE_AGENT_VISION_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged Computer Use agent vision live smoke requires macOS')
  for (const required of [node, driver, chatBridge]) {
    assert(await exists(required), `missing packaged sidecar artifact: ${required}`)
  }

  const pid = await calculatorPID()
  const workspace = computerUseRuntimeRoot(sessionId)
  const socketPath = computerUseSocket(sessionId)
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

  let provider
  let bridge
  try {
    await waitForSocket(socketPath, driverProcess, () => driverStderr)
    const windows = await driverCall('list_windows', { pid, on_screen_only: true }, socketPath, workspace)
    const targetWindow = chooseMainWindow(windows, pid)
    assert(targetWindow, `Calculator main window not found: ${JSON.stringify(windows)}`)

    const initial = await observeForSetup(socketPath, workspace, targetWindow)
    const clearButton = findButton(initial, ['AC', 'AllClear', '全部清除', 'Clear', '清除'])
    if (clearButton) {
      await observeForSetup(socketPath, workspace, targetWindow, clearButton.element_index)
    }
    const reset = await observeForSetup(socketPath, workspace, targetWindow)
    const oneButton = findButton(reset, ['1', 'One'])
    assert(oneButton, `Calculator button 1 not found: ${buttonSummary(reset)}`)
    const beforeScreenshot = directScreenshotBytes(reset, 'before')
    const beforeHash = sha256(beforeScreenshot)

    provider = await startFakeProvider(oneButton.element_index)
    await fs.mkdir(join(workspace, '.milksu', 'agent'), { recursive: true, mode: 0o700 })
    await fs.mkdir(join(workspace, '.milksu', 'runtime', 'tmp'), { recursive: true, mode: 0o700 })
    await fs.mkdir(join(workspace, '.milksu', 'runtime', 'background-tasks'), { recursive: true, mode: 0o700 })
    const computerUse = {
      sessionId,
      socketPath,
      targetBundleId,
      targetName,
      targetPid: pid,
      targetWindowId: Number(targetWindow.window_id),
    }
    bridge = startBridge({
      workspace,
      agentDirectory: join(workspace, '.milksu', 'agent'),
      baseURL: provider.baseURL,
      computerUse,
    })
    const ready = await bridge.createSession()
    assert(ready.tools?.includes('mcp'), 'Coding bridge did not expose MCP for Computer Use')
    assert(
      ready.capabilities?.some(capability => (
        capability.id === 'computer-use' && capability.status === 'allowed'
      )),
      `Computer Use capability was not allowed: ${JSON.stringify(ready.capabilities)}`,
    )

    const turnEvents = await bridge.prompt(
      'Use the active Computer Use visible app session to press the Calculator button labeled 1. '
      + 'First observe the selected window with screenshot evidence, then click the matching control. '
      + 'Do not use bash, shell scripts, AppleScript, screenshots on disk, IPC, or private protocols.',
    )
    const providerStats = provider.stats()
    const toolStarts = turnEvents.filter(event => event.type === 'tool_call_start')
    const toolEnds = turnEvents.filter(event => event.type === 'tool_call_end')
    const toolEndDebug = () => toolEnds.map(event => ({
      toolName: event.toolName,
      isError: event.isError,
      content: String(event.content ?? '').slice(0, 800),
      visualEvidenceTail: (() => {
        const content = String(event.content ?? '')
        const marker = content.indexOf('[MilkSU Computer Use visual evidence]')
        return marker >= 0 ? content.slice(marker, marker + 1200) : ''
      })(),
    }))
    const observeEnd = toolEnds.find(event => (
      event.toolName === 'mcp' &&
      event.content?.includes('"action": "observe"')
    ))
    const clickEnd = toolEnds.find(event => (
      event.toolName === 'mcp' &&
      event.content?.includes('"action": "click"')
    ))
    assert(
      observeEnd,
      `Computer Use agent smoke did not observe the selected window: ${JSON.stringify(toolEndDebug(), null, 2)}`,
    )
    assert(
      clickEnd,
      `Computer Use agent smoke did not click after observing: ${JSON.stringify(toolEndDebug(), null, 2)}`,
    )
    assert(
      observeEnd.content.includes('[MilkSU Computer Use visual evidence]'),
      'observe tool result did not include MilkSU visual evidence context',
    )
    assert(
      providerStats.visionRequests >= 1,
      'auxiliary vision model was not called for Computer Use screenshot: '
        + JSON.stringify({
          providerStats,
          toolStarts: toolStarts.map(event => ({
            toolName: event.toolName,
            input: event.input,
            content: String(event.content ?? '').slice(0, 500),
          })),
          toolEnds: toolEndDebug(),
          observeContentHasImageMarker: observeEnd.content.includes('"type": "image"')
            || observeEnd.content.includes('"type":"image"'),
        }, null, 2),
    )
    assert(providerStats.secondMainSawVisualEvidence, 'main model did not receive Computer Use visual evidence')
    assert(providerStats.secondMainSawVisionDescription, 'main model did not receive auxiliary vision description')
    assert(providerStats.secondMainSawAXTree, 'main model did not receive AX/tree evidence')
    assert(
      !turnEvents.some(event => event.type === 'approval_requested'),
      'workspace-auto generated a meaningless approval for selected Computer Use',
    )

    const after = await observeForSetup(socketPath, workspace, targetWindow)
    const afterScreenshot = directScreenshotBytes(after, 'after')
    const afterHash = sha256(afterScreenshot)
    assert(beforeHash !== afterHash, 'Calculator screenshot did not change after agent-driven click')

    await fs.mkdir(resultsDirectory, { recursive: true })
    await fs.writeFile(beforeScreenshotPath, beforeScreenshot, { mode: 0o600 })
    await fs.writeFile(afterScreenshotPath, afterScreenshot, { mode: 0o600 })
    const report = {
      schema: 'milksu-computer-use-agent-vision-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        packagedApp: appBundle,
      },
      target: {
        app: targetName,
        bundleId: targetBundleId,
        pid,
        windowId: Number(targetWindow.window_id),
        bounds: targetWindow.bounds,
        title: targetWindow.title,
      },
      gates: {
        packagedCodingBridgeUsed: true,
        firstPartyComputerUseMcpSelected: true,
        mainModelCalledObserve: true,
        auxiliaryVisionConsumedScreenshot: true,
        mainModelSawVisualEvidenceBeforeClick: true,
        mainModelCalledClickAfterObserve: true,
        visualChangeVerified: true,
        noMeaninglessApproval: true,
      },
      provider: {
        usesDeterministicLocalProvider: true,
        externalRealModel: false,
        mainRequests: providerStats.mainRequests,
        visionRequests: providerStats.visionRequests,
        secondMainSawVisualEvidence: providerStats.secondMainSawVisualEvidence,
        secondMainSawVisionDescription: providerStats.secondMainSawVisionDescription,
        secondMainSawAXTree: providerStats.secondMainSawAXTree,
        requests: provider.requests,
      },
	      operation: {
	        observeToolCalls: toolStarts.filter(event => (
	          event.toolName === 'mcp' && eventPayloadIncludes(event, '"observe"')
	        )).length,
	        clickToolCalls: toolStarts.filter(event => (
	          event.toolName === 'mcp' && eventPayloadIncludes(event, '"click"')
	        )).length,
        clickedElement: oneButton.element_index,
        beforeScreenshot: beforeScreenshotPath,
        afterScreenshot: afterScreenshotPath,
        beforeScreenshotSha256: beforeHash,
        afterScreenshotSha256: afterHash,
      },
      limitations: [
        'This is a packaged sidecar engineering smoke with a deterministic local OpenAI-compatible provider.',
        'It proves the main Coding loop receives Computer Use visual evidence before selecting a click tool call.',
        'It is not a real external-provider model quality benchmark and must not be counted as final GUI autonomy.',
      ],
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    assert(!/OPENAI_API_KEY|TOKENFLUX_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'report leaked key-shaped content')
    await fs.writeFile(resultPath, serialized, { mode: 0o600 })
    console.log('MilkSU packaged Computer Use agent vision live smoke passed.')
    console.log(`  target: ${targetBundleId} PID ${pid} Window ${targetWindow.window_id}`)
    console.log('  flow: main model observe -> auxiliary vision -> main model click -> visual change')
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    if (bridge) {
      await bridge.destroy().catch(() => undefined)
      await bridge.stop().catch(() => undefined)
    }
    if (provider) await provider.close().catch(() => undefined)
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
