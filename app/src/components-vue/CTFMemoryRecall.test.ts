// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CTFMemoryRecall from './CTFMemoryRecall.vue'
import type { CTFTrainingMemory } from '@/ctfTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function memory(overrides: Partial<CTFTrainingMemory> = {}): CTFTrainingMemory {
  return {
    id: 'memory-agent-delegated',
    schemaVersion: 'ctf-training-memory/v1alpha1',
    kind: 'technique',
    verification: 'judge-verified',
    actor: 'agent',
    assistance: 'delegated',
    title: '栈偏移枚举策略',
    summary: 'Agent 在代理模式下完成利用偏移枚举，并保留 Judge 回执。',
    category: 'pwn',
    tags: ['pwn', 'offset'],
    sourceJobId: 'job_pwn_offset',
    sourceSessionId: 'session_agent',
    evidenceRefs: ['judge:receipt_1', 'failure:branch_1'],
    confidence: 1,
    path: 'memories/memory-agent-delegated.md',
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
    recall: {
      schemaVersion: 'ctf-training-memory-recall/v1alpha1',
      score: 0.8,
      reasons: ['同为栈偏移枚举', '旧题失败分支相似'],
      evidence: [
        { kind: 'judge', id: 'receipt_1', label: 'Judge 回执 receipt_1' },
        { kind: 'failure', id: 'branch_1', label: '失败分支 branch_1' },
      ],
    },
    ...overrides,
  }
}

describe('CTFMemoryRecall', () => {
  it('separates correctness evidence from user ability attribution', async () => {
    const archived: CTFTrainingMemory[] = []
    const delegatedMemory = memory()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFMemoryRecall, {
      memories: [delegatedMemory],
      onArchive: (value: CTFTrainingMemory) => archived.push(value),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const text = host.textContent ?? ''
    expect(text).toContain('正确性证据和贡献归属分别标记')
    expect(text).toContain('Judge 验证')
    expect(text).toContain('Agent 代做 · 代理/未归属')
    expect(text).toContain('推荐依据：同为栈偏移枚举；旧题失败分支相似')
    expect(text).toContain('Judge 回执 receipt_1')
    expect(text).toContain('失败分支 branch_1')
    expect(text).not.toContain('用户完成 · 无协助')

    const archive = host.querySelector<HTMLButtonElement>(
      'button[aria-label="停用记忆：栈偏移枚举策略"]',
    )
    expect(archive).not.toBeNull()
    archive?.click()
    await nextTick()
    expect(archived).toEqual([delegatedMemory])
  })
})
