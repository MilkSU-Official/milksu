import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ConversationStore,
  hasStarted,
  isValidConversationId,
  normalizeKernel,
  KERNEL_DSH,
  KERNEL_PI,
  type StoredConversation,
} from './conversations.ts'

async function tempStore(): Promise<ConversationStore> {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-conversations-'))
  const store = new ConversationStore(directory)
  await store.ensure()
  return store
}

test('conversation id rejects paths and accepts UUID', () => {
  for (const id of ['', '../settings', 'a/b', 'a b', '.']) {
    assert.equal(isValidConversationId(id), false)
  }
  assert.equal(isValidConversationId('bb97144e-64b2-4bcc-a07f-4f5b3f9f8aa1'), true)
})

test('normalizeKernel maps ACP aliases to dsh and the rest to pi', () => {
  assert.equal(normalizeKernel(''), KERNEL_PI)
  assert.equal(normalizeKernel('unknown'), KERNEL_PI)
  assert.equal(normalizeKernel('DeepSeek-Harness'), KERNEL_DSH)
  assert.equal(normalizeKernel('acp'), KERNEL_DSH)
})

test('hasStarted ignores queued user text', () => {
  assert.equal(hasStarted({ id: 'x', title: '', createdAt: 1, messages: [] }), false)
  assert.equal(hasStarted({
    id: 'x', title: '', createdAt: 1,
    messages: [{ id: '1', role: 'user', content: 'steer', timestamp: 1, status: 'queued' }],
  }), false)
  assert.equal(hasStarted({
    id: 'x', title: '', createdAt: 1,
    messages: [{ id: '1', role: 'user', content: 'hello', timestamp: 1 }],
  }), true)
})

test('store round-trips a conversation and fills missing kernel as pi', async () => {
  const store = await tempStore()
  await assert.rejects(() => store.get('conversation-1'), /read conversation/)
  const want: StoredConversation = {
    id: 'conversation-1',
    title: '浏览器证据',
    createdAt: 42,
    workspacePath: '/tmp/milksu-workspace',
    messages: [],
  }
  await store.save(want)
  const got = await store.get('conversation-1')
  assert.equal(got.kernel, KERNEL_PI)
  assert.equal(got.title, want.title)
  assert.equal(got.createdAt, 42)
})

test('store rejects invalid ids', async () => {
  const store = await tempStore()
  await assert.rejects(
    () => store.save({ id: '../x', title: 'no', createdAt: 1, messages: [] }),
    /invalid conversation id/,
  )
})

test('archive moves the file into archived/ and restore moves it back', async () => {
  const store = await tempStore()
  await store.save({
    id: 'conversation-archive',
    title: '已归档',
    createdAt: 42,
    messages: [{ id: 'message-1', role: 'user', content: '保留上下文', timestamp: 43 }],
  })
  await store.archive('conversation-archive')
  await assert.rejects(() => store.get('conversation-archive'), /read conversation/)
  const archived = await store.listArchived()
  assert.equal(archived.length, 1)
  assert.equal(archived[0].id, 'conversation-archive')
  assert.ok((archived[0].archivedAt ?? 0) > 0)
  await store.restore('conversation-archive')
  const live = await store.get('conversation-archive')
  assert.equal(live.archivedAt, 0)
  assert.equal((await store.listArchived()).length, 0)
})

test('save does not revive an archived conversation', async () => {
  const store = await tempStore()
  await store.save({
    id: 'conversation-archive',
    title: '已归档',
    createdAt: 42,
    messages: [],
  })
  await store.archive('conversation-archive')
  await assert.rejects(
    () => store.save({
      id: 'conversation-archive',
      title: '复活',
      createdAt: 42,
      messages: [],
    }),
    /conversation is archived/,
  )
})

test('workspaceHome ctf reads as Coding and leftover CTF fields are dropped', async () => {
  const store = await tempStore()
  const path = join(store.directory, 'legacy-ctf.json')
  await mkdir(store.directory, { recursive: true })
  await writeFile(path, JSON.stringify({
    id: 'legacy-ctf',
    title: 'old ctf',
    createdAt: 1,
    workspaceHome: 'ctf',
    ctfJobId: 'job-1',
    ctfMode: 'attack',
    ctfRole: 'player',
    domainTaskContext: { kind: 'ctf', jobId: 'job-1' },
    messages: [],
  }), { mode: 0o600 })
  const got = await store.get('legacy-ctf')
  assert.equal(got.workspaceHome, 'chat')
  assert.equal(got.kernel, KERNEL_PI)
  assert.equal(got.domainTaskContext, undefined)
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  assert.ok(!('ctfJobId' in got))
  await store.save(got)
  const saved = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  assert.equal(saved.workspaceHome, 'chat')
  assert.equal(saved.ctfJobId, undefined)
  assert.equal(saved.ctfMode, undefined)
  assert.equal(saved.ctfRole, undefined)
  void raw
})
