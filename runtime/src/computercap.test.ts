import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import { bindComputerUse, closeComputerUse, handleComputerUseWorkspaceAction } from './domains/computeruse.ts'
import './domains/computeruse.ts'
import { Engine, type StartSidecar } from './engine.ts'
import { handleOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import { inspectExecutable } from './computercap/driver.ts'
import type { SidecarProcess } from './sidecar.ts'
import type { Permissions, SigningStatus, Status, Target } from './computercap/index.ts'

const FAKE_DRIVER = `const net = require('node:net')
const args = process.argv.slice(2)
if (args[0] === '--version') {
  process.stdout.write('cua-driver 0.38.0\\n')
  process.exit(0)
}
if (args[0] !== 'serve') process.exit(64)
const index = args.indexOf('--socket')
const socket = index >= 0 ? args[index + 1] : ''
if (!socket) process.exit(64)
const server = net.createServer((connection) => connection.end())
server.listen(socket)
`

const TEXT_EDIT: Target = {
  name: 'TextEdit',
  bundleId: 'com.apple.TextEdit',
  pid: 4242,
  windowId: 9001,
  windowTitle: 'Untitled',
}

const HOST_WINDOW: Target = {
  name: 'MilkSU',
  bundleId: 'com.milksu.app',
  pid: 1111,
  windowId: 1,
}

async function fakeDriverPath(home: string): Promise<string> {
  const path = join(home, 'cua-driver.cjs')
  await writeFile(path, FAKE_DRIVER, { mode: 0o755 })
  await chmod(path, 0o755)
  return path
}

function commandFactory(driverPath: string) {
  return (spec: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdio?: 'pipe' | 'ignore-stdout' }) => {
    const stdout = spec.stdio === 'pipe' ? 'pipe' : 'ignore'
    return spawn(process.execPath, [driverPath, ...spec.args], {
      env: spec.env,
      stdio: ['ignore', stdout, 'pipe'],
    })
  }
}

async function openCtx(options: {
  permissions?: Permissions
  windows?: Target[]
  signing?: SigningStatus
  failServeAfter?: number
}): Promise<{ home: string; ctx: HandlerContext; probeCalls: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'milksu-computeruse-'))
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'data', 'stores', 'lab-jobs'))
  await labJobs.ensure()
  const probeCalls: string[] = []
  const windows = options.windows ?? [HOST_WINDOW, TEXT_EDIT]
  const permissions = options.permissions ?? { accessibility: true, screenRecording: true }
  const signing = options.signing ?? {
    bundleId: 'com.milksu.app',
    signature: 'signed',
    teamIdentifier: 'TEAM',
    stableIdentity: true,
  }
  const driverPath = await fakeDriverPath(home)
  const factory = commandFactory(driverPath)
  const failServeAfter = Number.isFinite(options.failServeAfter) ? Number(options.failServeAfter) : Number.POSITIVE_INFINITY
  let serveAttempts = 0
  bindComputerUse(home, {
    home,
    os: 'darwin',
    binaryPath: driverPath,
    targetPid: 1111,
    hostBundleId: 'com.milksu.app',
    startTimeoutMs: 2000,
    grantDirectory: join(home, 'data', 'services', 'computer-use', 'task-authorizations'),
    commandFactory: (spec) => {
      if (spec.args[0] === 'serve') serveAttempts += 1
      if (spec.args[0] === 'serve' && serveAttempts > failServeAfter) {
        probeCalls.push('failing-serve')
        return spawn(process.execPath, ['--eval', 'process.exit(70)'], {
          env: spec.env,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      }
      return factory(spec)
    },
    permissionProbe: async () => permissions,
    permissionPrompt: async (kind) => {
      probeCalls.push(kind === 'screen-recording' ? 'prompt-screen-recording' : 'prompt-accessibility')
      return permissions
    },
    permissionOpen: async (kind) => {
      probeCalls.push(
        kind === 'screen-recording'
          ? 'request-screen-recording'
          : 'request-accessibility',
      )
    },
    signingProbe: async () => signing,
    targetProvider: async () => {
      probeCalls.push('list-windows')
      return windows
    },
    hostExecutable: async () => '',
  })
  const ctx: HandlerContext = {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {
      detachSession: async () => {},
      destroySession: async () => {},
    } as Engine,
    emit: () => {},
    home,
  }
  return { home, ctx, probeCalls }
}

test('inspectExecutable skips unix execute bits for windows os', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-inspect-exec-'))
  const path = join(home, 'cua-driver.bin')
  await writeFile(path, 'x')
  assert.equal(await inspectExecutable(path, 'windows'), true)
  if (process.platform !== 'win32') {
    assert.equal(await inspectExecutable(path, 'darwin'), false)
  }
})

test('window list is filtered and never opens a permission prompt', async () => {
  const { home, ctx, probeCalls } = await openCtx({})
  try {
    const targets = await handleOwnedMethod(ctx, 'renderer', 'ListCodingComputerUseTargets', []) as Target[]
    assert.equal(targets.length, 1)
    assert.equal(targets[0]?.bundleId, 'com.apple.TextEdit')
    assert.equal(targets[0]?.pid, 4242)
    assert.ok(probeCalls.includes('list-windows'))
    assert.equal(probeCalls.includes('request-screen-recording'), false)
  } finally {
    await closeComputerUse(home)
  }
})

test('status without permissions stays honest and Start is refused', async () => {
  const { home, ctx } = await openCtx({
    permissions: { accessibility: false, screenRecording: false },
  })
  try {
    const status = await handleOwnedMethod(ctx, 'renderer', 'GetCodingComputerUseStatus', []) as Status
    assert.equal(status.permissions.accessibility, false)
    assert.equal(status.permissions.screenRecording, false)
    assert.equal(status.enabled, false)
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'StartCodingComputerUse', ['conversation-1', 4242, 9001]),
      /辅助功能与屏幕录制/,
    )
  } finally {
    await closeComputerUse(home)
  }
})

test('Grant and Revoke persist and drop task authorization', async () => {
  const { home, ctx } = await openCtx({})
  try {
    const started = await handleOwnedMethod(
      ctx,
      'renderer',
      'GrantComputerUseTarget',
      ['conversation-grant', 4242, 9001],
    ) as Status
    assert.equal(started.enabled, true)
    assert.equal(started.phase, 'ready')
    assert.equal(started.authorized, true)
    assert.equal(started.conversationId, 'conversation-grant')
    assert.equal(started.target.pid, 4242)
    assert.equal(started.driverVersion, '0.38.0')
    assert.match(started.sessionId ?? '', /^computer_/)
    assert.equal(started.target.executablePath, undefined)

    const granted = await handleOwnedMethod(
      ctx,
      'renderer',
      'GetComputerUseStatus',
      ['conversation-grant'],
    ) as Status
    assert.equal(granted.authorized, true)
    assert.equal(granted.grantedTarget?.bundleId, 'com.apple.TextEdit')

    const stopped = await handleOwnedMethod(
      ctx,
      'renderer',
      'RevokeComputerUseTarget',
      ['conversation-grant'],
    ) as Status
    assert.equal(stopped.enabled, false)
    assert.equal(stopped.authorized, false)
    assert.equal(stopped.grantedTarget, undefined)
    assert.equal(stopped.conversationId, undefined)
  } finally {
    await closeComputerUse(home)
  }
})

test('StartCodingComputerUse / StopCodingComputerUse match Grant/Revoke', async () => {
  const { home, ctx } = await openCtx({})
  try {
    const started = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-start', 4242, 9001],
    ) as Status
    assert.equal(started.phase, 'ready')
    const stopped = await handleOwnedMethod(
      ctx,
      'renderer',
      'StopCodingComputerUse',
      ['conversation-start'],
    ) as Status
    assert.equal(stopped.enabled, false)
    assert.equal(stopped.authorized, false)
  } finally {
    await closeComputerUse(home)
  }
})

test('RequestCodingComputerUsePermissions prompts the missing kind natively', async () => {
  // 用户拒绝（或弹框没能绑定新签名）：prompt 之后探测仍不过，Status 带
  // 清晰 Problem；原生弹框取代了打开系统设置页的旧行为。
  const { home, ctx, probeCalls } = await openCtx({
    permissions: { accessibility: true, screenRecording: false },
  })
  try {
    const status = await handleOwnedMethod(
      ctx,
      'renderer',
      'RequestCodingComputerUsePermissions',
      ['screen-recording'],
    ) as Status
    assert.equal(status.permissions.screenRecording, false)
    assert.equal(status.permissions.accessibility, true)
    // 缺失的那一项走原生弹框路径；另一项（辅助功能）不弹。
    assert.equal(probeCalls.filter((call) => call === 'prompt-screen-recording').length, 1)
    assert.equal(probeCalls.includes('prompt-accessibility'), false)
    // 原生弹框取代了打开系统设置页；向导按三态指引接手。
    assert.equal(probeCalls.includes('request-screen-recording'), false)
    assert.equal(probeCalls.includes('request-accessibility'), false)
    assert.match(status.problem ?? '', /屏幕录制/)
  } finally {
    await closeComputerUse(home)
  }
})

test('RequestCodingComputerUsePermissions skips the prompt for granted kinds', async () => {
  // 屏幕录制缺失、辅助功能已授权：请求辅助功能直接返回，不打扰、无 Problem。
  const { home, ctx, probeCalls } = await openCtx({
    permissions: { accessibility: true, screenRecording: false },
  })
  try {
    const status = await handleOwnedMethod(
      ctx,
      'renderer',
      'RequestCodingComputerUsePermissions',
      ['accessibility'],
    ) as Status
    assert.equal(status.permissions.accessibility, true)
    assert.equal(probeCalls.includes('prompt-accessibility'), false)
    assert.equal(probeCalls.includes('prompt-screen-recording'), false)
    assert.equal(probeCalls.includes('request-accessibility'), false)
    assert.equal(status.problem, undefined)
  } finally {
    await closeComputerUse(home)
  }
})

test('Start rebinds a same-conversation lock to a different target', async () => {
  const CHROME: Target = {
    name: 'Google Chrome',
    bundleId: 'com.google.Chrome',
    pid: 4343,
    windowId: 9002,
    windowTitle: 'Chrome task',
  }
  const { home, ctx } = await openCtx({ windows: [HOST_WINDOW, TEXT_EDIT, CHROME] })
  try {
    const started = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-rebind', 4242, 9001],
    ) as Status
    assert.equal(started.enabled, true)
    assert.equal(started.authorized, true)
    assert.equal(started.target.pid, 4242)

    // Audit D3: locking another window from the same conversation used to
    // return the stale target with authorized=false. The rebind must release
    // the old session and return the new target, authorized.
    const rebound = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-rebind', 4343, 9002],
    ) as Status
    assert.equal(rebound.enabled, true)
    assert.equal(rebound.authorized, true)
    assert.equal(rebound.target.pid, 4343)
    assert.equal(rebound.target.windowId, 9002)
    assert.notEqual(rebound.sessionId, started.sessionId)

    const granted = await handleOwnedMethod(
      ctx,
      'renderer',
      'GetComputerUseStatus',
      ['conversation-rebind'],
    ) as Status
    assert.equal(granted.authorized, true)
    assert.equal(granted.grantedTarget?.pid, 4343)

    // Same-target relock is idempotent and keeps the authorized bit (the old
    // early return lost it because statusLocked never sets authorized).
    const idempotent = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-rebind', 4343, 9002],
    ) as Status
    assert.equal(idempotent.enabled, true)
    assert.equal(idempotent.authorized, true)
    assert.equal(idempotent.target.pid, 4343)
    assert.equal(idempotent.sessionId, rebound.sessionId)

    // Cross-conversation exclusivity must survive the rebind semantics.
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'StartCodingComputerUse', ['conversation-other', 4242, 9001]),
      /already attached to another visible Coding task/,
    )
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'StopCodingComputerUse', ['conversation-other']),
      /does not belong to this Coding task/,
    )

    // Unlock returns the conversation to an unlocked state and any target
    // can be locked again.
    const stopped = await handleOwnedMethod(
      ctx,
      'renderer',
      'StopCodingComputerUse',
      ['conversation-rebind'],
    ) as Status
    assert.equal(stopped.enabled, false)
    assert.equal(stopped.authorized, false)
    const again = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-rebind', 4242, 9001],
    ) as Status
    assert.equal(again.enabled, true)
    assert.equal(again.authorized, true)
    assert.equal(again.target.pid, 4242)
  } finally {
    await closeComputerUse(home)
  }
})

test('an invalid rebind target keeps the current lock', async () => {
  const { home, ctx } = await openCtx({})
  try {
    const started = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-invalid-rebind', 4242, 9001],
    ) as Status
    assert.equal(started.enabled, true)
    // The rebind candidate disappears after the initial lock, as if the
    // process exited or the window closed (only TextEdit stays listed).
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'StartCodingComputerUse', ['conversation-invalid-rebind', 9999, 9999]),
      /原锁定保持不变/,
    )
    const status = await handleOwnedMethod(
      ctx,
      'renderer',
      'GetComputerUseStatus',
      [],
    ) as Status
    assert.equal(status.enabled, true)
    assert.equal(status.target.pid, 4242)
    assert.equal(status.conversationId, 'conversation-invalid-rebind')
  } finally {
    await closeComputerUse(home)
  }
})

test('a failed rebind start reports the unlocked state and keeps the grant anchor', async () => {
  const CHROME: Target = {
    name: 'Google Chrome',
    bundleId: 'com.google.Chrome',
    pid: 4343,
    windowId: 9002,
    windowTitle: 'Chrome task',
  }
  const { home, ctx } = await openCtx({
    windows: [HOST_WINDOW, TEXT_EDIT, CHROME],
    failServeAfter: 1,
  })
  try {
    const started = await handleOwnedMethod(
      ctx,
      'renderer',
      'StartCodingComputerUse',
      ['conversation-rebind-fail', 4242, 9001],
    ) as Status
    assert.equal(started.enabled, true)
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'StartCodingComputerUse', ['conversation-rebind-fail', 4343, 9002]),
      /改绑/,
    )
    const status = await handleOwnedMethod(
      ctx,
      'renderer',
      'GetComputerUseStatus',
      [],
    ) as Status
    assert.equal(status.enabled, false)
    // The grant anchor survives so a retry lock restores the conversation.
    const granted = await handleOwnedMethod(
      ctx,
      'renderer',
      'GetComputerUseStatus',
      ['conversation-rebind-fail'],
    ) as Status
    assert.equal(granted.authorized, true)
    assert.equal(granted.grantedTarget?.pid, 4242)
  } finally {
    await closeComputerUse(home)
  }
})

test('workspace actions list, lock, and unlock a visible session', async () => {
  const { home, ctx } = await openCtx({})
  try {
    const listed = JSON.parse(
      await handleComputerUseWorkspaceAction(ctx, 'conversation-ws', 'list_computer_use_windows', ''),
    ) as { windows: Target[] }
    assert.equal(listed.windows.length, 1)
    assert.equal(listed.windows[0]?.bundleId, 'com.apple.TextEdit')

    const locked = JSON.parse(await handleComputerUseWorkspaceAction(
      ctx,
      'conversation-ws',
      'lock_computer_use_window',
      JSON.stringify({ targetPid: 4242, targetWindowId: 9001 }),
    )) as {
      locked: boolean
      status: Status
      descriptor?: { sessionId: string; targetPid: number }
    }
    assert.equal(locked.locked, true)
    assert.equal(locked.status.enabled, true)
    assert.equal(locked.status.authorized, true)
    assert.equal(locked.descriptor?.targetPid, 4242)
    assert.match(locked.descriptor?.sessionId ?? '', /^computer_/)

    // The bridge clears its session descriptor on unlock; the payload must
    // land the conversation back in an unlocked, unauthorized state.
    const unlocked = JSON.parse(
      await handleComputerUseWorkspaceAction(ctx, 'conversation-ws', 'unlock_computer_use_window', ''),
    ) as { unlocked: boolean; status: Status }
    assert.equal(unlocked.unlocked, true)
    assert.equal(unlocked.status.enabled, false)
    assert.equal(unlocked.status.authorized, false)

    const driver = JSON.parse(
      await handleComputerUseWorkspaceAction(ctx, 'conversation-ws', 'computer_use_driver_status', ''),
    ) as { ready: boolean; version: string }
    assert.equal(driver.ready, true)
    assert.equal(driver.version, '0.38.0')

    await assert.rejects(
      () => handleComputerUseWorkspaceAction(ctx, 'conversation-ws', 'lock_computer_use_window', 'not-json'),
      /invalid workspace action input/,
    )
  } finally {
    await closeComputerUse(home)
  }
})

const FAKE_CU_SIDECAR = `
import readline from 'node:readline'
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  let command
  try { command = JSON.parse(line) } catch { return }
  if (command.action === 'shutdown') {
    process.exit(0)
    return
  }
  if (command.action === 'send_message') {
    process.stdout.write(JSON.stringify({
      type: 'workspace_action',
      id: command.conversationId ?? null,
      action: 'unlock_computer_use_window',
      requestId: 'wa-cu-unlock',
      input: '{}',
    }) + '\\n')
  }
})
`

async function startFakeCuSidecar(
  onLine: (value: unknown) => void,
  recorded: Record<string, unknown>[],
): Promise<SidecarProcess> {  const dir = await mkdtemp(join(tmpdir(), 'milksu-cu-fake-'))
  const script = join(dir, 'fake-sidecar.mjs')
  await writeFile(script, FAKE_CU_SIDECAR, { mode: 0o700 })
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.pipe(process.stderr)
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    try {
      onLine(JSON.parse(line))
    } catch {
      onLine({ type: 'error', error: 'fake sidecar protocol error' })
    }
  })
  let writeChain = Promise.resolve()
  const proc: SidecarProcess = {
    kernel: 'dsh',
    workspace: dir,
    child: child as SidecarProcess['child'],
    write(command) {
      recorded.push(command)
      const encoded = `${JSON.stringify(command)}\n`
      writeChain = writeChain.then(
        () => new Promise<void>((resolve, reject) => {
          child.stdin.write(encoded, (error) => {
            if (error) reject(error)
            else resolve()
          })
        }),
      )
      return writeChain
    },
    async kill() {
      if (child.exitCode !== null) return
      try {
        child.stdin.write(`${JSON.stringify({ action: 'shutdown' })}\n`)
        child.stdin.end()
      } catch {
        // already closed
      }
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 800)),
      ])
      if (child.exitCode === null) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }
    },
  }
  return proc
}

function stubCuSettings(command: string): { get(): { acp_agent: { command: string } }; exportSidecarEnvironment(): string[] } {
  return {
    get: () => ({ acp_agent: { command } }),
    exportSidecarEnvironment: () => [],
  }
}

test('engine routes Computer Use workspace actions to the dispatcher', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-cu-engine-'))
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  await conversations.save({ id: 'cu-route', title: 'CU route', createdAt: 1, kernel: 'dsh', messages: [] })
  const recorded: Record<string, unknown>[] = []
  const routed: Array<{ conversationId: string; action: string; input: string }> = []
  const engine = new Engine(
    home,
    conversations,
    process.execPath,
    () => {},
    undefined,
    undefined,
    (input) => startFakeCuSidecar(input.onLine, recorded),
  )
  engine.attachSettings(stubCuSettings(process.execPath) as never)
  engine.attachComputerUseActions(async (conversationId, action, input) => {
    routed.push({ conversationId, action, input })
    return JSON.stringify({ unlocked: true, status: { enabled: false, authorized: false, phase: 'disabled' } })
  })
  try {
    await engine.sendMessage({
      conversationId: 'cu-route',
      prompt: 'hello',
      workspacePath: '',
      modelMode: '',
      modelProvider: '',
      modelId: '',
      thinkingLevel: '',
      modelSourcePreference: 'auto',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      mcpConfigDigest: '',
      mcpServers: [],
      attachments: [],
      branchFromUserOccurrence: -1,
      traceId: '',
    })
    const deadline = Date.now() + 5000
    while (
      !recorded.some((item) => item.action === 'workspace_action_response')
      && Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const response = recorded.find((item) => item.action === 'workspace_action_response') as {
      ok?: boolean
      result?: string
      requestId?: string
    } | undefined
    assert.ok(response, 'engine must answer the Computer Use workspace action')
    assert.equal(response.ok, true)
    assert.equal(response.requestId, 'wa-cu-unlock')
    assert.deepEqual(routed, [
      { conversationId: 'cu-route', action: 'unlock_computer_use_window', input: '{}' },
    ])
    assert.equal(JSON.parse(String(response.result ?? '')).unlocked, true)
  } finally {
    await engine.stopAll()
  }
})

test('engine fails fast when Computer Use actions are not wired', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-cu-engine-'))
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  await conversations.save({ id: 'cu-unwired', title: 'CU unwired', createdAt: 1, kernel: 'dsh', messages: [] })
  const recorded: Record<string, unknown>[] = []
  const engine = new Engine(
    home,
    conversations,
    process.execPath,
    () => {},
    undefined,
    undefined,
    (input) => startFakeCuSidecar(input.onLine, recorded),
  )
  engine.attachSettings(stubCuSettings(process.execPath) as never)
  try {
    await engine.sendMessage({
      conversationId: 'cu-unwired',
      prompt: 'hello',
      workspacePath: '',
      modelMode: '',
      modelProvider: '',
      modelId: '',
      thinkingLevel: '',
      modelSourcePreference: 'auto',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      mcpConfigDigest: '',
      mcpServers: [],
      attachments: [],
      branchFromUserOccurrence: -1,
      traceId: '',
    })
    const deadline = Date.now() + 5000
    while (
      !recorded.some((item) => item.action === 'workspace_action_response')
      && Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const response = recorded.find((item) => item.action === 'workspace_action_response') as {
      ok?: boolean
      error?: string
    } | undefined
    assert.ok(response, 'engine must answer the Computer Use workspace action')
    assert.equal(response.ok, false)
    assert.match(String(response.error ?? ''), /Computer Use workspace actions are unavailable/)
  } finally {
    await engine.stopAll()
  }
})
