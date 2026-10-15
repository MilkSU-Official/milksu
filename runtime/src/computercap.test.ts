import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import { bindComputerUse, closeComputerUse } from './domains/computeruse.ts'
import './domains/computeruse.ts'
import type { Engine } from './engine.ts'
import { handleOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import type { Permissions, SigningStatus, Status, Target } from './computercap/index.ts'

const FAKE_DRIVER = `const net = require('node:net')
const args = process.argv.slice(2)
if (args[0] === '--version') {
  process.stdout.write('cua-driver 0.29.1\\n')
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
  bindComputerUse(home, {
    home,
    os: 'darwin',
    binaryPath: driverPath,
    targetPid: 1111,
    hostBundleId: 'com.milksu.app',
    startTimeoutMs: 2000,
    grantDirectory: join(home, 'data', 'services', 'computer-use', 'task-authorizations'),
    commandFactory: commandFactory(driverPath),
    permissionProbe: async () => permissions,
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
    assert.equal(started.driverVersion, '0.29.1')
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

test('RequestCodingComputerUsePermissions opens the screen-recording panel', async () => {
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
    assert.ok(probeCalls.includes('request-screen-recording'))
    assert.equal(probeCalls.includes('request-accessibility'), false)
  } finally {
    await closeComputerUse(home)
  }
})
