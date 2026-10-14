import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from '../conversations.ts'
import { bindTerminals } from '../domains/terminals.ts'
import '../domains/terminals.ts'
import type { Engine } from '../engine.ts'
import {
  assertInvokeSource,
  handleOwnedMethod,
  isOwnedMethod,
  type HandlerContext,
} from '../handlers.ts'
import { LabJobStore } from '../lab.ts'
import {
  TerminalManager,
  createHelperPtyDriver,
  terminalEnvironment,
  type PtyDriver,
  type PtyHandle,
  type PtyOpenRequest,
  type TerminalEvent,
} from './terminals.ts'

type DriverCall =
  | { op: 'open'; request: PtyOpenRequest }
  | { op: 'write'; id: string; data: string }
  | { op: 'resize'; id: string; columns: number; rows: number }
  | { op: 'close'; id: string }

class FakePtyDriver implements PtyDriver {
  readonly calls: DriverCall[] = []
  private seq = 0

  async open(request: PtyOpenRequest): Promise<PtyHandle> {
    this.calls.push({ op: 'open', request })
    this.seq += 1
    return { id: `pty_${this.seq}`, pid: 4000 + this.seq }
  }

  async write(id: string, data: string): Promise<void> {
    this.calls.push({ op: 'write', id, data })
  }

  async resize(id: string, columns: number, rows: number): Promise<void> {
    this.calls.push({ op: 'resize', id, columns, rows })
  }

  async close(id: string): Promise<void> {
    this.calls.push({ op: 'close', id })
  }
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function stubCtx(home: string): Promise<HandlerContext> {
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'data', 'stores', 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {} as Engine,
    emit: () => {},
    home,
    invokeHelper: async (method) => {
      throw new Error(`helper should not see ${method}`)
    },
  }
}

function openedEnv(driver: FakePtyDriver): string[] {
  const opened = driver.calls.find((call) => call.op === 'open')
  return opened && opened.op === 'open' ? opened.request.env : []
}

test('terminal environment keeps developer variables and drops provider keys', () => {
  const environment = terminalEnvironment([
    'PATH=/custom/bin',
    'SSH_AUTH_SOCK=/private/tmp/agent.sock',
    'OPENAI_API_KEY=provider-secret',
    'TERM=dumb',
    'COLORTERM=false',
  ])
  assert.equal(environment.includes('PATH=/custom/bin'), true)
  assert.equal(environment.includes('SSH_AUTH_SOCK=/private/tmp/agent.sock'), true)
  assert.equal(environment.includes('TERM=xterm-256color'), true)
  assert.equal(environment.includes('COLORTERM=truecolor'), true)
  assert.equal(environment.includes('MILKSU_TERMINAL=1'), true)
  assert.equal(environment.some((entry) => entry.startsWith('OPENAI_API_KEY=')), false)
})

test('list is bound to conversationId and fake helper records open/write/close', async () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'must-not-reach-terminal'
  const driver = new FakePtyDriver()
  const events: TerminalEvent[] = []
  const manager = new TerminalManager({ driver, emit: (event) => events.push(event) })
  const workspace = await tempDir('milksu-term-ws-')
  try {
    const started = await manager.start('conversation-one', workspace, 80, 24)
    assert.equal(started.status, 'running')
    assert.equal(started.conversationId, 'conversation-one')
    assert.equal(started.columns, 80)
    assert.equal(started.rows, 24)
    assert.equal(started.id.startsWith('term_'), true)
    assert.equal(openedEnv(driver).some((entry) => entry.startsWith('OPENAI_API_KEY=')), false)
    assert.equal(openedEnv(driver).includes('MILKSU_TERMINAL=1'), true)

    await manager.write('conversation-one', started.id, 'pwd\n')
    assert.deepEqual(await manager.list('conversation-two'), [])
    await assert.rejects(
      () => manager.write('conversation-two', started.id, 'pwd\n'),
      /does not belong to this Coding task/,
    )

    manager.handlePtyOutput('pty_1', 'hello')
    const listed = await manager.list('conversation-one')
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, started.id)
    assert.equal(listed[0]?.output, 'hello')
    assert.equal(events.some((event) => event.type === 'terminal.output' && event.data === 'hello'), true)

    const resized = await manager.resize('conversation-one', started.id, 132, 40)
    assert.equal(resized.columns, 132)
    assert.equal(resized.rows, 40)

    await manager.closeSession('conversation-one', started.id)
    assert.equal(driver.calls.some((call) => call.op === 'write' && call.data === 'pwd\n'), true)
    assert.equal(driver.calls.some((call) => call.op === 'resize' && call.columns === 132 && call.rows === 40), true)
    assert.equal(driver.calls.some((call) => call.op === 'close' && call.id === 'pty_1'), true)
    assert.deepEqual(await manager.list('conversation-one'), [])
    assert.equal(
      events.some((event) => event.type === 'terminal.closed' && event.terminalId === started.id && !event.session),
      true,
    )
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test('helper driver records OpenPty write close as electron_host', async () => {
  const calls: Array<{ method: string; args: unknown[]; source?: string }> = []
  const driver = createHelperPtyDriver(async (method, args, source) => {
    calls.push({ method, args, source })
    if (method === 'OpenPty') return { id: 'pty_helper', pid: 9 }
    return null
  })
  const events: TerminalEvent[] = []
  const manager = new TerminalManager({ driver, emit: (event) => events.push(event) })
  driver.attach({
    output: (id, data) => manager.handlePtyOutput(id, data),
    exit: (id, code, error) => manager.handlePtyExit(id, code, error),
  })
  const workspace = await tempDir('milksu-term-helper-')
  driver.handleEvent('pty-output', { id: 'pty_helper', data: 'buffered' })
  const started = await manager.start('conversation-one', workspace, 80, 24)
  assert.equal(started.pid, 9)
  assert.equal((await manager.list('conversation-one'))[0]?.output, 'buffered')
  await manager.write('conversation-one', started.id, 'ls\n')
  await manager.closeSession('conversation-one', started.id)
  assert.equal(calls[0]?.method, 'OpenPty')
  assert.equal(calls[0]?.source, 'electron_host')
  assert.equal(calls.some((call) => call.method === 'PtyWrite'), true)
  assert.equal(calls.some((call) => call.method === 'ClosePty'), true)
  assert.deepEqual(await manager.list('conversation-two'), [])
})

test('stop marks the session stopped when the helper exits', async () => {
  const driver = new FakePtyDriver()
  const events: TerminalEvent[] = []
  const manager = new TerminalManager({ driver, emit: (event) => events.push(event) })
  const started = await manager.start('conversation-stop', await tempDir('milksu-term-stop-'), 0, 0)
  const snapshot = await manager.stop('conversation-stop', started.id)
  assert.equal(snapshot.status, 'running')
  assert.equal(driver.calls.some((call) => call.op === 'close'), true)
  manager.handlePtyExit('pty_1', 0)
  const exited = events.find((event) => event.type === 'terminal.exited')
  assert.equal(exited?.session?.status, 'stopped')
})

test('list returns terminal tabs in stable creation order', async () => {
  const manager = new TerminalManager({ driver: new FakePtyDriver() })
  manager.replaceSessionsForTest([
    { id: 'term-newest', conversationId: 'conversation-order', workspace: '', shell: '', status: 'exited', columns: 80, rows: 24, startedAt: 30 },
    { id: 'term-oldest', conversationId: 'conversation-order', workspace: '', shell: '', status: 'exited', columns: 80, rows: 24, startedAt: 10 },
    { id: 'term-middle', conversationId: 'conversation-order', workspace: '', shell: '', status: 'exited', columns: 80, rows: 24, startedAt: 20 },
    { id: 'term-other-conversation', conversationId: 'conversation-other', workspace: '', shell: '', status: 'exited', columns: 80, rows: 24, startedAt: 5 },
  ])
  const sessions = await manager.list('conversation-order')
  assert.deepEqual(sessions.map((session) => session.id), ['term-oldest', 'term-middle', 'term-newest'])
})

test('terminal creation timestamps are strictly monotonic', () => {
  const manager = new TerminalManager({ driver: new FakePtyDriver() })
  const first = manager.nextStartedAtForTest()
  const second = manager.nextStartedAtForTest()
  assert.equal(second > first, true)
})

test('closed manager does not start another PTY', async () => {
  const driver = new FakePtyDriver()
  const manager = new TerminalManager({ driver })
  const workspace = await tempDir('milksu-term-closed-')
  await manager.start('conversation-close', workspace, 80, 24)
  await manager.close()
  await assert.rejects(
    () => manager.start('conversation-close', workspace, 80, 24),
    /closed/,
  )
})

test('owned handlers list by conversation and reject a missing runtime', async () => {
  const home = await tempDir('milksu-term-home-')
  const driver = new FakePtyDriver()
  const events: TerminalEvent[] = []
  const manager = new TerminalManager({ driver, emit: (event) => events.push(event) })
  bindTerminals(home, manager)
  const ctx = await stubCtx(home)
  const workspace = await tempDir('milksu-term-owned-')
  assert.equal(isOwnedMethod('ListCodingTerminals'), true)
  assert.equal(isOwnedMethod('StartCodingTerminal'), true)
  assert.equal(isOwnedMethod('WriteCodingTerminal'), true)
  assert.equal(isOwnedMethod('ResizeCodingTerminal'), true)
  assert.equal(isOwnedMethod('StopCodingTerminal'), true)
  assert.equal(isOwnedMethod('CloseCodingTerminal'), true)
  assert.equal(isOwnedMethod('OpenPty'), false)
  assert.throws(() => assertInvokeSource('OpenPty', 'renderer'), /unavailable to renderer/)

  const started = await handleOwnedMethod(ctx, 'renderer', 'StartCodingTerminal', [
    'conversation-one',
    workspace,
    80,
    24,
  ]) as { id: string; conversationId: string }
  assert.equal(started.conversationId, 'conversation-one')
  const listed = await handleOwnedMethod(ctx, 'renderer', 'ListCodingTerminals', ['conversation-one']) as Array<{ id: string }>
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.id, started.id)
  assert.deepEqual(await handleOwnedMethod(ctx, 'renderer', 'ListCodingTerminals', ['conversation-two']), [])
  await handleOwnedMethod(ctx, 'renderer', 'WriteCodingTerminal', ['conversation-one', started.id, 'echo\n'])
  await handleOwnedMethod(ctx, 'renderer', 'CloseCodingTerminal', ['conversation-one', started.id])
  assert.deepEqual(await handleOwnedMethod(ctx, 'renderer', 'ListCodingTerminals', ['conversation-one']), [])

  const other = await stubCtx(await tempDir('milksu-term-missing-'))
  await assert.rejects(
    () => handleOwnedMethod(other, 'renderer', 'ListCodingTerminals', ['conversation-one']),
    /Coding terminal runtime is unavailable/,
  )
})
