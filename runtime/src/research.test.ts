import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import './domains/research.ts'
import type { Engine } from './engine.ts'
import { handleOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import { ResearchService } from './research/service.ts'
import { MAX_SOURCE_BYTES } from './research/types.ts'

const TRACE = 'trc_550e8400-e29b-41d4-a716-446655440000'

async function openTemp(): Promise<{ home: string; service: ResearchService; conversations: ConversationStore; ctx: HandlerContext }> {
  const home = await mkdtemp(join(tmpdir(), 'milksu-research-'))
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'data', 'stores', 'lab-jobs'))
  await labJobs.ensure()
  const service = ResearchService.open(join(home, 'data'))
  await conversations.save({
    id: 'pi-1',
    title: 'keep json',
    createdAt: 10,
    kernel: 'pi',
    messages: [],
  })
  const engine = {
    detachSession: async () => {},
    destroySession: async () => {},
    cancelResearchRun: async (conversationId: string, runId: string) => service.cancel(conversationId, runId),
    hasLiveSession: () => false,
    kernelFor: () => 'pi',
  } as unknown as Engine
  const ctx: HandlerContext = {
    conversations,
    labJobs,
    research: service,
    engine,
    emit: () => {},
    home,
    invokeHelper: async (method) => {
      throw new Error(`helper should not see ${method}`)
    },
  }
  return { home, service, conversations, ctx }
}

test('Start persists a traceId and List/Get/Cancel share the sqlite store', async () => {
  const { service } = await openTemp()
  try {
    const run = await service.start('pi-1', 'compare two public RFCs', TRACE)
    assert.equal(run.traceId, TRACE)
    assert.match(run.id, /^research_/)
    const listed = await service.list('pi-1')
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, run.id)
    assert.equal(listed[0]?.traceId, TRACE)
    assert.equal(listed[0]?.report, '')
    const snapshot = await service.get('pi-1', run.id)
    assert.equal(snapshot.run.id, run.id)
    assert.equal(snapshot.run.traceId, TRACE)
    const cancelled = await service.cancel('pi-1', run.id)
    assert.equal(cancelled.status, 'cancelled')
    const after = await service.get('pi-1', run.id)
    assert.equal(after.run.status, 'cancelled')
  } finally {
    service.close()
  }
})

test('DropResearchForConversation leaves conversation JSON', async () => {
  const { service, conversations, ctx } = await openTemp()
  try {
    const run = await service.start('pi-1', 'drop research only', TRACE)
    await handleOwnedMethod(ctx, 'electron_host', 'DropResearchForConversation', ['pi-1'])
    const stored = await conversations.get('pi-1')
    assert.equal(stored.title, 'keep json')
    const runs = await service.list('pi-1')
    assert.equal(runs.some((item) => item.id === run.id), false)
  } finally {
    service.close()
  }
})

test('renderer cannot drop research; List/Get/Cancel go through owned handlers', async () => {
  const { service, ctx } = await openTemp()
  try {
    const run = await service.start('pi-1', 'owned rpc', TRACE)
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'DropResearchForConversation', ['pi-1']),
      /unavailable to renderer/,
    )
    const listed = await handleOwnedMethod(ctx, 'renderer', 'ListResearchRuns', ['pi-1']) as Array<{ id: string; traceId: string }>
    assert.equal(listed[0]?.id, run.id)
    assert.equal(listed[0]?.traceId, TRACE)
    const snapshot = await handleOwnedMethod(ctx, 'renderer', 'GetResearchRun', ['pi-1', run.id]) as { run: { id: string } }
    assert.equal(snapshot.run.id, run.id)
    const cancelled = await handleOwnedMethod(ctx, 'renderer', 'CancelResearchRun', ['pi-1', run.id]) as { status: string }
    assert.equal(cancelled.status, 'cancelled')
  } finally {
    service.close()
  }
})

test('source URLs are redacted and artifacts stay under the byte cap', async () => {
  const { service } = await openTemp()
  try {
    const run = await service.start('pi-1', 'sanitize sources', TRACE)
    const source = await service.addSource(
      'pi-1',
      run.id,
      'https://reader:synthetic-password@example.test/paper?keep=value&api_key=synthetic-key&access_token=synthetic-token#access_token=synthetic-fragment',
      'Example paper',
      'durable source content',
    )
    const parsed = new URL(source.url)
    assert.equal(parsed.username, '')
    assert.equal(parsed.password, '')
    assert.equal(parsed.searchParams.has('api_key'), false)
    assert.equal(parsed.searchParams.has('access_token'), false)
    assert.equal(parsed.searchParams.get('keep'), 'value')
    assert.equal(source.url.includes('synthetic-'), false)
    const { extract } = await service.readSource('pi-1', source.id)
    assert.equal(extract, 'durable source content')
    const artifactPath = join(service.store.directory, 'artifacts', run.id, source.artifactRef)
    assert.equal(await readFile(artifactPath, 'utf8'), 'durable source content')
    await assert.rejects(
      () => service.addSource('pi-1', run.id, 'https://example.test/too-big', 'big', 'x'.repeat(MAX_SOURCE_BYTES + 1)),
      /between 1 and/,
    )
  } finally {
    service.close()
  }
})

test('Start/Resume/Cancel/RecordWorkerUpdates share one sqlite', async () => {
  const { service } = await openTemp()
  try {
    const run = await service.start('pi-1', 'worker batch', TRACE)
    const task = await service.registerTask('pi-1', run.id, 'collect standard A')
    await service.recordWorkerUpdates('pi-1', run.id, [{
      id: task.id,
      prompt: task.prompt,
      status: 'running',
      workerId: 'worker-one',
    }])
    await service.sealBatch('pi-1', run.id)
    await service.recordWorkerUpdates('pi-1', run.id, [{
      id: task.id,
      prompt: task.prompt,
      status: 'succeeded',
      workerId: 'worker-one',
      result: 'Standard A requires...',
    }])
    await service.markInterrupted('pi-1', run.id)
    const interrupted = await service.get('pi-1', run.id)
    assert.equal(interrupted.run.status, 'interrupted')
    const resumed = await service.resume('pi-1', run.id)
    assert.equal(resumed.run.status, 'running')
    assert.equal(resumed.tasks[0]?.id, task.id)
    const cancelled = await service.cancel('pi-1', run.id)
    assert.equal(cancelled.status, 'cancelled')
    const again = await service.get('pi-1', run.id)
    assert.equal(again.tasks[0]?.prompt, 'collect standard A')
  } finally {
    service.close()
  }
})

test('Start generates a trc_ uuid when the supplied id is junk', async () => {
  const { service } = await openTemp()
  try {
    const run = await service.start('pi-1', 'junk trace', 'conversation-1')
    assert.match(run.traceId, /^trc_[0-9a-f-]{36}$/i)
    assert.notEqual(run.traceId, 'conversation-1')
  } finally {
    service.close()
  }
})
