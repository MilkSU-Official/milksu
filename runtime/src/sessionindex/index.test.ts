import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { ConversationStore, type StoredConversation } from '../conversations.ts'
import { FACT_BOUNDARY, SessionIndexStore, redactSnippet } from './index.ts'

const FIXED_NOW = new Date('2026-08-04T12:00:00.000Z')

function sampleConversations(): StoredConversation[] {
  return [
    {
      id: 'coding-1',
      title: 'Computer Use validation',
      createdAt: Date.parse('2026-08-04T09:00:00.000Z'),
      workspacePath: '/Users/demo/code/milksu',
      modelId: 'gpt-5',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '请验证 Computer Use 外部 App 点击',
          timestamp: Date.parse('2026-08-04T09:01:00.000Z'),
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: 'clicked OK; OPENAI_API_KEY=sk-session-index-secret12345',
          timestamp: Date.parse('2026-08-04T09:02:00.000Z'),
          toolName: 'computer_use.click',
          toolCallId: 'tool-call-1',
          durationMs: 1234,
          approvalInput: '{"text":"Bearer approval-token-secret123"}',
        },
      ],
    },
    {
      id: 'coding-legacy-1',
      title: '旧工作区接力',
      createdAt: Date.parse('2026-08-04T08:00:00.000Z'),
      workspacePath: '/Users/demo/code/milksu',
      workspaceHome: 'ctf',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '继续当前工作区里的验证步骤',
          timestamp: Date.parse('2026-08-04T08:30:00.000Z'),
        },
      ],
    },
    {
      id: 'cve-1',
      title: 'CVE-2024-3400 接力',
      createdAt: Date.parse('2026-08-04T07:00:00.000Z'),
      workspacePath: '/Users/demo/code/milksu',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'NVD CVE-2024-3400 同步完成；Bearer cve-secret-token12345',
          timestamp: Date.parse('2026-08-04T07:20:00.000Z'),
        },
      ],
    },
  ]
}

test('session index initializes the MilkSU Obelisk schema', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'milksu-session-index-')), 'obelisk.sqlite')
  const store = SessionIndexStore.open(path)
  store.now = () => FIXED_NOW
  const status = store.status()
  assert.equal(status.available, true)
  assert.equal(status.mode, 'milksu-obelisk-core')
  assert.equal(status.readOnly, true)
  assert.equal(status.indexPath, path)
  assert.equal(status.factBoundary, FACT_BOUNDARY)
})

test('refresh indexes conversation JSON, tools, and redacts secrets', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'milksu-session-index-')), 'obelisk.sqlite')
  const store = SessionIndexStore.open(path)
  store.now = () => FIXED_NOW
  const result = await store.refresh(sampleConversations())
  assert.equal(result.sessionCount, 3)
  assert.equal(result.messageCount, 4)
  assert.equal(result.toolCallCount, 1)

  const status = store.status()
  assert.equal(status.sessionCount, 3)
  assert.equal(status.messageCount, 4)
  assert.equal(status.toolCallCount, 1)
  const sources = Object.fromEntries(status.sources.map((item) => [item.source, item.count]))
  assert.equal(sources['milksu-coding'], 2)
  assert.equal(sources['milksu-cve'], 1)
  assert.equal(sources['milksu-ctf'], undefined)

  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const row = db.prepare('SELECT group_concat(text, char(10)) AS text FROM messages').get() as { text: string }
    assert.equal(row.text.includes('sk-session-index-secret'), false)
    assert.equal(row.text.includes('cve-secret-token'), false)
    const tool = db.prepare(`SELECT input_json FROM tool_calls WHERE name = 'computer_use.click'`).get() as { input_json: string }
    assert.equal(tool.input_json.includes('approval-token-secret'), false)
  } finally {
    db.close()
  }

  const found = store.search({ query: 'Computer Use' })
  assert.ok(found.results.length >= 1)
  assert.ok(found.results.some((item) => item.sessionId === 'milksu:coding-1'))
  assert.equal(JSON.stringify(found).includes('sk-session-index-secret'), false)
})

test('refresh scans conversation JSON on disk including old ctf workspaceHome', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-session-json-'))
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  await writeFile(join(conversations.directory, 'legacy-ctf.json'), `${JSON.stringify({
    id: 'legacy-ctf',
    title: 'old workspace',
    createdAt: Date.parse('2026-08-04T06:00:00.000Z'),
    workspaceHome: 'ctf',
    messages: [{ id: 'm1', role: 'user', content: '继续当前 Coding 任务', timestamp: Date.parse('2026-08-04T06:01:00.000Z') }],
  })}\n`, { mode: 0o600 })
  await conversations.save({
    id: 'coding-live',
    title: 'live coding',
    createdAt: Date.parse('2026-08-04T06:10:00.000Z'),
    messages: [{ id: 'm2', role: 'user', content: '扫描这段会话 JSON', timestamp: Date.parse('2026-08-04T06:11:00.000Z') }],
  })
  const listed = await conversations.list()
  const legacy = listed.find((item) => item.id === 'legacy-ctf')
  assert.equal(legacy?.workspaceHome, 'chat')

  const store = SessionIndexStore.open(join(home, 'data', 'stores', 'session-index', 'obelisk.sqlite'))
  const result = await store.refresh(listed)
  assert.equal(result.sessionCount, 2)
  const status = store.status()
  const sources = Object.fromEntries(status.sources.map((item) => [item.source, item.count]))
  assert.equal(sources['milksu-coding'], 2)
  const found = store.search({ query: '扫描这段会话 JSON' })
  assert.equal(found.results[0]?.sessionId, 'milksu:coding-live')
})

test('redactSnippet is idempotent for already redacted values', () => {
  const once = [
    'OPENAI_API_KEY=[credential redacted]',
    'Authorization: Bearer [credential redacted]',
    'https://provider.example.test/v1?api_key=[credential redacted]&model=x',
  ].join(' ')
  const redacted = redactSnippet(once)
  assert.equal(redactSnippet(redacted), redacted)
  assert.equal(redacted.includes('redacted] redacted]'), false)
  const polluted = redactSnippet('OPENAI_API_KEY=[credential redacted] redacted] redacted]')
  assert.match(polluted, /OPENAI_API_KEY=\[credential redacted\]/)
  assert.equal(polluted.includes('redacted] redacted]'), false)
})
