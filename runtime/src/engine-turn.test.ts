import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import { computerUseSocket } from './computercap/hostpath.ts'
import type { AppSettings } from './config/settings-store.ts'
import { Engine, type StartSidecar } from './engine.ts'
import {
  BROWSER_USE_MCP,
  buildSendMessageCommand,
  CODING_BROWSER_MCP,
  COMPUTER_USE_MCP,
  type SendMessageTurnInput,
} from './engine-turn.ts'
import type { SidecarProcess } from './sidecar.ts'

const FAKE_KEY = 'sk-test-engine-turn-secret'
const FAKE_SIDECAR = `
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
      type: 'user_memory_turn',
      id: command.conversationId,
      phase: 'finish',
      userText: 'remember this',
      assistantText: 'ok',
    }) + '\\n')
  }
})
`

function baseInput(overrides: Partial<SendMessageTurnInput> = {}): SendMessageTurnInput {
  return {
    conversationId: 'conv-1',
    prompt: 'hello',
    workspace: tmpdir(),
    home: tmpdir(),
    sessionRole: '',
    imageDraw: false,
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    mcpServers: [CODING_BROWSER_MCP, COMPUTER_USE_MCP, BROWSER_USE_MCP],
    mcpConfigDigest: '',
    attachments: [],
    branchFromUserOccurrence: -1,
    traceId: 'trc_test',
    provider: 'tokenflux',
    model: 'gpt-4.1',
    thinkingLevel: 'high',
    modelSourcePreference: '',
    settings: {},
    locale: 'zh',
    userMemories: [],
    memoryRevision: 0,
    ...overrides,
  }
}

function validBrowser() {
  return {
    sessionId: 'browser_conv-1',
    cdpEndpoint: 'http://127.0.0.1:9222',
  }
}

function validComputerUse() {
  const sessionId = 'computer_abcd1234'
  return {
    sessionId,
    socketPath: computerUseSocket(sessionId),
    targetBundleId: 'com.apple.Safari',
    targetName: 'Safari',
    targetPid: 42,
    targetWindowId: 7,
  }
}

test('user memories enter the send_message command', () => {
  const command = buildSendMessageCommand(baseInput({
    userMemories: [{ id: 'mem_1', title: '语言', markdown: '用中文回复' }],
    memoryRevision: 4,
  }))
  assert.equal(command.action, 'send_message')
  assert.equal(command.memoryRevision, 4)
  const memories = command.userMemories as Array<Record<string, string>>
  assert.equal(memories[0]?.id, 'mem_1')
  assert.equal(memories[0]?.markdown, '用中文回复')
})

test('models without reasoning send thinking.enabled false', () => {
  const command = buildSendMessageCommand(baseInput({
    model: 'gpt-4.1',
    thinkingLevel: 'high',
  }))
  const thinking = command.thinking as { enabled: boolean; level?: string }
  assert.equal(thinking.enabled, false)
  assert.equal(thinking.level, undefined)
})

test('illegal thinking level falls back to the model default', () => {
  const command = buildSendMessageCommand(baseInput({
    provider: 'tokenflux',
    model: 'deepseek/deepseek-flash',
    thinkingLevel: 'not-a-level',
  }))
  const thinking = command.thinking as { enabled: boolean; level?: string }
  assert.equal(thinking.enabled, true)
  assert.equal(thinking.level, 'high')
})

test('customProvider appears from resolved settings and worker thinking is resolved', () => {
  const settings: AppSettings = {
    active_provider: 'custom-relay-deepseek',
    active_model: 'deepseek-flash',
    worker_provider: 'tokenflux',
    worker_model: 'deepseek/deepseek-flash',
    worker_source: 'personal',
    providers: {
      'custom-relay-deepseek': {
        custom: true,
        enabled: true,
        name: 'DeepSeek',
        api_key: FAKE_KEY,
        base_url: 'https://api.deepseek.com',
        api: 'openai',
      },
    },
  }
  const command = buildSendMessageCommand(baseInput({
    provider: 'custom-relay-deepseek',
    model: 'deepseek-flash',
    settings,
  }))
  const custom = command.customProvider as Record<string, unknown>
  assert.equal(custom.id, 'custom-relay-deepseek')
  assert.equal(custom.baseUrl, 'https://api.deepseek.com')
  assert.equal(custom.key === FAKE_KEY, true)
  const worker = command.workerModel as { provider: string; thinking: { enabled: boolean } }
  assert.equal(worker.provider, 'tokenflux')
  assert.equal(worker.thinking.enabled, true)
})

test('go mode with an open browser attaches codingBrowser; plan mode does not', () => {
  const go = buildSendMessageCommand(baseInput({
    executionMode: 'go',
    codingBrowser: validBrowser(),
  }))
  assert.deepEqual(go.codingBrowser, validBrowser())
  assert.ok((go.mcpServers as string[]).includes(CODING_BROWSER_MCP))

  const plan = buildSendMessageCommand(baseInput({
    executionMode: 'plan',
    codingBrowser: validBrowser(),
  }))
  assert.equal(plan.codingBrowser, undefined)
  assert.equal((plan.mcpServers as string[]).includes(CODING_BROWSER_MCP), false)
})

test('Computer Use is omitted when unauthorized or read-only', () => {
  const allowed = buildSendMessageCommand(baseInput({
    computerUse: validComputerUse(),
  }))
  assert.equal((allowed.computerUse as { sessionId: string }).sessionId, 'computer_abcd1234')

  const readOnly = buildSendMessageCommand(baseInput({
    approvalPolicy: 'read-only',
    computerUse: validComputerUse(),
  }))
  assert.equal(readOnly.computerUse, undefined)
  assert.equal((readOnly.mcpServers as string[]).includes(COMPUTER_USE_MCP), false)

  const off = buildSendMessageCommand(baseInput({
    computerUse: validComputerUse(),
    settings: { computer_use_enabled: false },
  }))
  assert.equal(off.computerUse, undefined)
  assert.equal((off.mcpServers as string[]).includes(COMPUTER_USE_MCP), false)
})

test('probe sessions attach a text_projection turnPolicy', () => {
  const command = buildSendMessageCommand(baseInput({
    conversationId: 'milksu_model_probe_abc',
  }))
  assert.deepEqual(command.turnPolicy, {
    toolAccess: 'none',
    reason: 'text_projection',
  })
})

async function startFakeSidecar(
  onLine: (value: unknown) => void,
  recorded: Record<string, unknown>[],
  source = FAKE_SIDECAR,
): Promise<SidecarProcess> {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-engine-turn-fake-'))
  const script = join(dir, 'fake-sidecar.mjs')
  await writeFile(script, source, { mode: 0o700 })
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    try {
      onLine(JSON.parse(line))
    } catch {
      onLine({ type: 'error', error: 'fake sidecar protocol error' })
    }
  })
  let writeChain = Promise.resolve()
  return {
    kernel: 'pi',
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
}

test('resolved customProvider reaches sidecar writes and the fake key stays out of emit', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-engine-turn-home-'))
  const conversations = await ConversationStore.open(home)
  await conversations.save({
    id: 'conv-custom',
    title: 'custom',
    createdAt: 1,
    kernel: 'pi',
    messages: [],
  })
  const recorded: Record<string, unknown>[] = []
  const emitted: unknown[] = []
  const notes: Array<{ phase: string; session?: string }> = []
  const startSidecar: StartSidecar = (input) => startFakeSidecar(input.onLine, recorded)
  const engine = new Engine(
    home,
    conversations,
    process.execPath,
    (_event, payload) => {
      emitted.push(payload)
    },
    undefined,
    undefined,
    startSidecar,
  )
  engine.attachSettings({
    get: () => ({
      active_provider: 'custom-relay-deepseek',
      active_model: 'deepseek-flash',
      providers: {
        'custom-relay-deepseek': {
          custom: true,
          enabled: true,
          name: 'DeepSeek',
          has_api_key: true,
          base_url: 'https://api.deepseek.com',
        },
      },
    }),
    getResolved: () => ({
      active_provider: 'custom-relay-deepseek',
      active_model: 'deepseek-flash',
      providers: {
        'custom-relay-deepseek': {
          custom: true,
          enabled: true,
          name: 'DeepSeek',
          api_key: FAKE_KEY,
          base_url: 'https://api.deepseek.com',
        },
      },
    }),
    exportSidecarEnvironment: () => [],
  } as never)
  engine.attachCompanion({
    publishedMemory: () => ({
      revision: 2,
      memories: [{ id: 'mem_1', title: '语言', markdown: '用中文' }],
    }),
    noteExternalTurn: async (phase) => {
      notes.push({ phase })
    },
    setMemoryViewListener: () => {},
  })
  try {
    await engine.sendMessage({
      conversationId: 'conv-custom',
      prompt: 'hello',
      workspacePath: '',
      modelMode: '',
      modelProvider: 'custom-relay-deepseek',
      modelId: 'deepseek-flash',
      thinkingLevel: '',
      modelSourcePreference: '',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      mcpConfigDigest: '',
      mcpServers: [],
      attachments: [],
      branchFromUserOccurrence: -1,
      traceId: 'trc_custom',
    })
    const send = recorded.find((item) => item.action === 'send_message') as
      | { customProvider?: Record<string, unknown>; userMemories?: unknown[]; memoryRevision?: number }
      | undefined
    assert.ok(send)
    assert.equal(send.customProvider?.id, 'custom-relay-deepseek')
    assert.equal(send.customProvider?.key === FAKE_KEY, true)
    assert.equal(send.memoryRevision, 2)
    assert.equal(JSON.stringify(emitted).includes(FAKE_KEY), false)
    const deadline = Date.now() + 2000
    while (notes.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(notes[0]?.phase, 'finish')
    assert.equal(
      emitted.some((item) => item && typeof item === 'object' && (item as { type?: string }).type === 'user_memory_turn'),
      false,
    )
  } finally {
    await engine.stopAll()
  }
})

const FAKE_TEXT_SIDECAR = `
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
      type: 'text_delta',
      id: command.conversationId,
      delta: '修复登录回调',
    }) + '\\n')
    process.stdout.write(JSON.stringify({
      type: 'message_done',
      id: command.conversationId,
      content: '修复登录回调',
    }) + '\\n')
  }
})
`

test('generateText stays silent, tool-free, and does not leak a fake key', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-engine-text-home-'))
  const conversations = await ConversationStore.open(home)
  const recorded: Record<string, unknown>[] = []
  const emitted: unknown[] = []
  const startSidecar: StartSidecar = (input) => startFakeSidecar(input.onLine, recorded, FAKE_TEXT_SIDECAR)
  const engine = new Engine(
    home,
    conversations,
    process.execPath,
    (_event, payload) => {
      emitted.push(payload)
    },
    undefined,
    undefined,
    startSidecar,
  )
  engine.attachSettings({
    get: () => ({
      active_provider: 'custom-relay-deepseek',
      active_model: 'deepseek-flash',
      providers: {
        'custom-relay-deepseek': {
          custom: true,
          enabled: true,
          name: 'DeepSeek',
          has_api_key: true,
          base_url: 'https://api.deepseek.com',
        },
      },
    }),
    getResolved: () => ({
      active_provider: 'custom-relay-deepseek',
      active_model: 'deepseek-flash',
      providers: {
        'custom-relay-deepseek': {
          custom: true,
          enabled: true,
          name: 'DeepSeek',
          api_key: FAKE_KEY,
          base_url: 'https://api.deepseek.com',
        },
      },
    }),
    exportSidecarEnvironment: () => [],
  } as never)
  try {
    const text = await engine.generateText('return a title')
    assert.equal(text, '修复登录回调')
    const send = recorded.find((item) => item.action === 'send_message') as
      | {
        conversationId?: string
        executionMode?: string
        approvalPolicy?: string
        turnPolicy?: Record<string, unknown>
        customProvider?: Record<string, unknown>
      }
      | undefined
    assert.ok(send)
    assert.equal(String(send.conversationId).startsWith('milksu_text_projection_'), true)
    assert.equal(send.executionMode, 'plan')
    assert.equal(send.approvalPolicy, 'read-only')
    assert.deepEqual(send.turnPolicy, { toolAccess: 'none', reason: 'text_projection' })
    assert.equal(send.customProvider?.key === FAKE_KEY, true)
    const destroyed = recorded.find((item) => item.action === 'destroy_session') as
      | { conversationId?: string; deletePersisted?: boolean }
      | undefined
    assert.ok(destroyed)
    assert.equal(destroyed.conversationId, send.conversationId)
    assert.equal(destroyed.deletePersisted, true)
    assert.equal(
      emitted.some((item) => {
        const event = item as { sessionId?: string; type?: string }
        return String(event.sessionId ?? '').startsWith('milksu_text_projection_')
          || event.type === 'assistant.delta'
          || event.type === 'assistant.completed'
      }),
      false,
    )
    assert.equal(JSON.stringify(emitted).includes(FAKE_KEY), false)
  } finally {
    await engine.stopAll()
  }
})

test('each workspace gets its own sidecar and delete sends destroy_session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-engine-ws-home-'))
  const workspaceA = join(home, 'ws-a')
  const workspaceB = join(home, 'ws-b')
  await mkdir(workspaceA)
  await mkdir(workspaceB)
  const conversations = await ConversationStore.open(home)
  await conversations.save({ id: 'conv-a', title: 'a', createdAt: 1, kernel: 'pi', messages: [] })
  await conversations.save({ id: 'conv-b', title: 'b', createdAt: 2, kernel: 'pi', messages: [] })
  const started: string[] = []
  const recorded: Record<string, unknown>[] = []
  const startSidecar: StartSidecar = async (input) => {
    started.push(input.workspace)
    const proc = await startFakeSidecar(input.onLine, recorded)
    return { ...proc, kernel: input.kernel, workspace: input.workspace }
  }
  const engine = new Engine(
    home,
    conversations,
    process.execPath,
    () => {},
    undefined,
    undefined,
    startSidecar,
  )
  engine.attachSettings({
    get: () => ({ active_provider: 'tokenflux', active_model: 'deepseek-flash' }),
    getResolved: () => ({ active_provider: 'tokenflux', active_model: 'deepseek-flash' }),
    exportSidecarEnvironment: () => [],
  } as never)
  const send = (id: string, workspacePath: string) => engine.sendMessage({
    conversationId: id,
    prompt: 'hello',
    workspacePath,
    modelMode: '',
    modelProvider: 'tokenflux',
    modelId: 'deepseek-flash',
    thinkingLevel: '',
    modelSourcePreference: '',
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    mcpConfigDigest: '',
    mcpServers: [],
    attachments: [],
    branchFromUserOccurrence: -1,
    traceId: `trc_${id}`,
  })
  const workspaceC = join(home, 'ws-c')
  await mkdir(workspaceC)
  await conversations.save({ id: 'conv-c', title: 'c', createdAt: 3, kernel: 'pi', messages: [] })
  try {
    await send('conv-a', workspaceA)
    await send('conv-b', workspaceB)
    assert.deepEqual(started, [workspaceA, workspaceB])
    await engine.destroySession('conv-a', true)
    const destroyed = recorded.filter((item) => item.action === 'destroy_session')
    assert.equal(destroyed.some((item) => item.conversationId === 'conv-a' && item.deletePersisted === true), true)
    await send('conv-b', workspaceB)
    assert.deepEqual(started, [workspaceA, workspaceB])
    await send('conv-c', workspaceC)
    assert.deepEqual(started, [workspaceA, workspaceB, workspaceC])
  } finally {
    await engine.stopAll()
  }
})
