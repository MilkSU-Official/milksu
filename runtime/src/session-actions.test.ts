import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationStore, type StoredConversation, type StoredMessage } from './conversations.ts'
import type { Engine } from './engine.ts'
import { handleOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import { ResearchService } from './research/service.ts'
import {
  forkConversationRecord,
  rewindVisibleMessages,
  sliceMessagesToRoleOccurrence,
} from './session-actions.ts'

function message(id: string, role: StoredMessage['role'], extra: Partial<StoredMessage> = {}): StoredMessage {
  return { id, role, content: extra.content ?? id, timestamp: extra.timestamp ?? 1, ...extra }
}

function conversation(id: string, extra: Partial<StoredConversation> = {}): StoredConversation {
  return {
    id,
    title: extra.title ?? '新编码任务',
    createdAt: extra.createdAt ?? 10,
    messages: extra.messages ?? [],
    ...extra,
  }
}

async function tempStores(): Promise<{
  conversations: ConversationStore
  labJobs: LabJobStore
  research: ResearchService
  home: string
}> {
  const home = await mkdtemp(join(tmpdir(), 'milksu-session-actions-'))
  const conversations = new ConversationStore(join(home, 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'lab-jobs'))
  await labJobs.ensure()
  const research = ResearchService.open(join(home, 'data'))
  return { conversations, labJobs, research, home }
}

function stubEngine(overrides: Record<string, unknown> = {}): Engine {
  return {
    detachSession: async () => {},
    destroySession: async () => {},
    clearConversationProblem: async () => {},
    sendMessage: async () => {},
    abortMessage: async () => {},
    steerMessage: async () => {},
    restartEngine: async () => {},
    respondToolApproval: async () => {},
    queueMessage: async () => {},
    removeQueuedMessage: async () => {},
    hasLiveSession: () => false,
    kernelFor: () => 'pi',
    bindSessionKernel: () => {},
    forkSession: async () => {
      throw new Error('PI Sidecar is not running')
    },
    rewindSession: async () => {
      throw new Error('PI session not found: missing')
    },
    handoffSession: async () => {
      throw new Error('PI session not found: missing')
    },
    compactSession: async () => {
      throw new Error('PI session not found: missing')
    },
    generateText: async () => {
      throw new Error('generateText not stubbed')
    },
    ...overrides,
  } as unknown as Engine
}

async function makeContext(
  overrides: {
    engine?: Engine
    home?: string
  } = {},
): Promise<HandlerContext> {
  const stores = await tempStores()
  return {
    conversations: stores.conversations,
    labJobs: stores.labJobs,
    research: stores.research,
    engine: overrides.engine ?? stubEngine(),
    emit: () => {},
    home: overrides.home ?? stores.home,
  }
}

test('sliceMessagesToRoleOccurrence keeps through the chosen assistant turn', () => {
  const messages = [
    message('u1', 'user'),
    message('a1', 'assistant'),
    message('u2', 'user'),
    message('a2', 'assistant'),
  ]
  assert.deepEqual(
    sliceMessagesToRoleOccurrence(messages, 'assistant', 1).map((item) => item.id),
    ['u1', 'a1', 'u2', 'a2'],
  )
  assert.deepEqual(
    sliceMessagesToRoleOccurrence(messages, 'assistant', 0).map((item) => item.id),
    ['u1', 'a1'],
  )
})

test('rewindVisibleMessages drops the latest user turn', () => {
  const messages = [
    message('u1', 'user'),
    message('a1', 'assistant'),
    message('u2', 'user'),
    message('a2', 'assistant'),
  ]
  assert.deepEqual(rewindVisibleMessages(messages)?.map((item) => item.id), ['u1', 'a1'])
  assert.equal(rewindVisibleMessages(messages.slice(0, 2)), null)
})

test('ForkConversation copies JSON to a new id', async () => {
  const ctx = await makeContext({})
  await ctx.conversations.save(conversation('source-1', {
    title: 'Fix login',
    workspacePath: join(ctx.home, 'workspace'),
    messages: [
      message('u1', 'user', { content: 'fix login' }),
      message('a1', 'assistant', { content: 'plan' }),
      message('u2', 'user', { content: 'do it' }),
      message('a2', 'assistant', { content: 'done' }),
    ],
  }))
  const forkedId = await handleOwnedMethod(ctx, 'renderer', 'ForkConversation', [
    'source-1',
    'assistant',
    1,
  ]) as string
  assert.match(String(forkedId), /^[0-9a-f-]{36}$/i)
  assert.notEqual(forkedId, 'source-1')
  const listed = await ctx.conversations.list()
  assert.equal(listed.some((item) => item.id === forkedId), true)
  const forked = await ctx.conversations.get(String(forkedId))
  assert.equal(forked.workspacePath, join(ctx.home, 'workspace'))
  assert.deepEqual(forked.messages.map((item) => item.id), ['u1', 'a1', 'u2', 'a2'])
})

test('forkConversationRecord uses the sidecar session id when provided', async () => {
  const stores = await tempStores()
  await stores.conversations.save(conversation('source-live', {
    messages: [message('u1', 'user'), message('a1', 'assistant')],
  }))
  const copied = await forkConversationRecord(
    stores.conversations,
    'source-live',
    'forked-from-sidecar',
    'assistant',
    0,
  )
  assert.equal(copied.id, 'forked-from-sidecar')
  const got = await stores.conversations.get('forked-from-sidecar')
  assert.deepEqual(got.messages.map((item) => item.id), ['u1', 'a1'])
})

test('RewindCodingSession truncates messages', async () => {
  const ctx = await makeContext()
  await ctx.conversations.save(conversation('rewind-1', {
    messages: [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
    ],
  }))
  await handleOwnedMethod(ctx, 'renderer', 'RewindCodingSession', ['rewind-1'])
  const stored = await ctx.conversations.get('rewind-1')
  assert.deepEqual(stored.messages.map((item) => item.id), ['u1', 'a1'])
})

test('HandoffCodingSession writes a new conversation from the sidecar receipt', async () => {
  const engine = stubEngine({
    hasLiveSession: () => true,
    handoffSession: async () => ({
      sessionId: 'handed-session',
      summary: 'Goal: keep the dock',
      surfaceText: '',
    }),
  })
  const ctx = await makeContext({ engine })
  await ctx.conversations.save(conversation('source-handoff', {
    title: 'Keep the dock',
    kernel: 'pi',
    workspacePath: join(ctx.home, 'app'),
    messages: [message('u1', 'user'), message('a1', 'assistant')],
  }))
  const receipt = await handleOwnedMethod(ctx, 'renderer', 'HandoffCodingSession', [
    'source-handoff',
    'pi',
  ]) as { sessionId: string; summary?: string }
  assert.equal(receipt.sessionId, 'handed-session')
  assert.equal(receipt.summary, 'Goal: keep the dock')
  const handed = await ctx.conversations.get('handed-session')
  assert.equal(handed.kernel, 'pi')
  assert.equal(handed.workspacePath, join(ctx.home, 'app'))
  assert.equal(handed.messages.length, 1)
  assert.equal(handed.messages[0]?.role, 'assistant')
  assert.equal(handed.messages[0]?.content, 'Goal: keep the dock')
})

test('HandoffCodingSession to another kernel falls back to stored text when sidecar is down', async () => {
  const ctx = await makeContext()
  await ctx.conversations.save(conversation('source-stored', {
    kernel: 'pi',
    messages: [
      message('u1', 'user', { content: 'keep going' }),
      message('a1', 'assistant', { content: 'ok' }),
    ],
  }))
  const receipt = await handleOwnedMethod(ctx, 'renderer', 'HandoffCodingSession', [
    'source-stored',
    'dsh',
  ]) as { sessionId: string; summary?: string }
  assert.match(String(receipt.sessionId), /^[0-9a-f-]{36}$/i)
  const handed = await ctx.conversations.get(receipt.sessionId)
  assert.equal(handed.kernel, 'dsh')
  assert.equal(handed.acpAgentId, undefined)
  assert.match(String(receipt.summary), /keep going/)
})

test('HandoffCodingSession stores the target Agent id and clears it when returning to Pi', async () => {
  const ctx = await makeContext()
  await ctx.conversations.save(conversation('source-agent', {
    kernel: 'pi',
    acpAgentId: 'agt_stale',
    messages: [message('u1', 'user', { content: 'switch' })],
  }))
  const toAgent = await handleOwnedMethod(ctx, 'renderer', 'HandoffCodingSession', [
    'source-agent',
    'dsh',
    'agt_codex',
  ]) as { sessionId: string }
  const agentSession = await ctx.conversations.get(toAgent.sessionId)
  assert.equal(agentSession.kernel, 'dsh')
  assert.equal(agentSession.acpAgentId, 'agt_codex')

  const toPi = await handleOwnedMethod(ctx, 'renderer', 'HandoffCodingSession', [
    toAgent.sessionId,
    'pi',
    'agt_ignored',
  ]) as { sessionId: string }
  const piSession = await ctx.conversations.get(toPi.sessionId)
  assert.equal(piSession.kernel, 'pi')
  assert.equal(piSession.acpAgentId, undefined)
})

test('GenerateConversationTitle writes the model title back to JSON', async () => {
  const prompts: string[] = []
  const ctx = await makeContext({
    engine: stubEngine({
      generateText: async (prompt: string) => {
        prompts.push(prompt)
        return '修复登录回调'
      },
    }),
  })
  await ctx.conversations.save(conversation('title-1', {
    title: '新编码任务',
    messages: [message('u1', 'user', { content: '请修复登录回调状态恢复' })],
  }))
  const title = await handleOwnedMethod(ctx, 'renderer', 'GenerateConversationTitle', [
    '请修复登录回调状态恢复',
    '',
    '',
    '',
    'title-1',
  ])
  assert.equal(title, '修复登录回调')
  const stored = await ctx.conversations.get('title-1')
  assert.equal(stored.title, '修复登录回调')
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0]?.includes('请修复登录回调状态恢复'), true)
})

test('EnsureCodingArtifactWorkspace stores a workspace path on the conversation JSON', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-artifact-home-'))
  const artifacts = join(home, 'MilkSU')
  const previous = process.env.MILKSU_USER_ARTIFACTS_DIR
  process.env.MILKSU_USER_ARTIFACTS_DIR = artifacts
  try {
    const conversations = new ConversationStore(join(home, 'conversations'))
    await conversations.ensure()
    const labJobs = new LabJobStore(join(home, 'lab-jobs'))
    await labJobs.ensure()
    const research = ResearchService.open(join(home, 'data'))
    await conversations.save(conversation('coding-1', { messages: [] }))
    const ctx: HandlerContext = {
      conversations,
      labJobs,
      research,
      engine: stubEngine(),
      emit: () => {},
      home,
    }
    const workspace = await handleOwnedMethod(ctx, 'renderer', 'EnsureCodingArtifactWorkspace', [
      'coding-1',
    ]) as string
    assert.ok(workspace.includes('agent-workspaces'))
    const stored = await conversations.get('coding-1')
    assert.equal(stored.workspacePath, workspace)
  } finally {
    if (previous === undefined) delete process.env.MILKSU_USER_ARTIFACTS_DIR
    else process.env.MILKSU_USER_ARTIFACTS_DIR = previous
  }
})

test('DeleteConversation removes JSON then drops research', async () => {
  const ctx = await makeContext({})
  await ctx.conversations.save(conversation('gone-1', { title: 'delete me', kernel: 'pi' }))
  const run = await ctx.research.start('gone-1', 'drop with the conversation', 'trc_550e8400-e29b-41d4-a716-446655440000')
  await handleOwnedMethod(ctx, 'renderer', 'DeleteConversation', ['gone-1'])
  const listed = await ctx.conversations.list()
  assert.equal(listed.some((item) => item.id === 'gone-1'), false)
  const remaining = await ctx.research.list('gone-1')
  assert.equal(remaining.some((item) => item.id === run.id), false)
  ctx.research.close()
})
