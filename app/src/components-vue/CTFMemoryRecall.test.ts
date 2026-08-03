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
    const inspected: string[] = []
    const delegatedMemory = memory()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFMemoryRecall, {
      memories: [delegatedMemory],
      onArchive: (value: CTFTrainingMemory) => archived.push(value),
      onInspectEvidence: (value: { kind: string, id: string }) => {
        inspected.push(`${value.kind}:${value.id}`)
      },
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const text = host.textContent ?? ''
    expect(text).toContain('正确性证据和贡献归属分别标记')
    expect(text).toContain('Judge 验证')
    expect(text).toContain('Agent 代做 · 代理/未归属')
    expect(text).toContain('可作为 Agent Memory，不增加用户独立完成计数。')
    expect(text).toContain('推荐依据：同为栈偏移枚举；旧题失败分支相似')
    expect(text).toContain('Judge 回执 receipt_1')
    expect(text).toContain('失败分支 branch_1')
    expect(text).not.toContain('用户完成 · 无协助')
    const judgeEvidence = host.querySelector<HTMLButtonElement>('[data-evidence-kind="judge"]')
    expect(judgeEvidence?.getAttribute('data-evidence-id'))
      .toBe('receipt_1')
    judgeEvidence?.click()
    await nextTick()
    expect(inspected).toEqual(['judge:receipt_1'])

    const archive = host.querySelector<HTMLButtonElement>(
      'button[aria-label="停用记忆：栈偏移枚举策略"]',
    )
    expect(archive).not.toBeNull()
    archive?.click()
    await nextTick()
    expect(archived).toEqual([delegatedMemory])
  })

  it('falls back to stored evidence references when recall links are absent', async () => {
    const inspected: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFMemoryRecall, {
      memories: [memory({
        id: 'memory-fallback-evidence',
        actor: 'shared',
        assistance: 'copilot',
        evidenceRefs: [
          'job:job_crypto_shared',
          'judge:receipt_crypto_1',
          'hint:hint_used_1',
          'step:user_step_1',
          'failure:dead_branch_1',
        ],
        recall: undefined,
      })],
      onArchive: () => {},
      onInspectEvidence: (value: { kind: string, id: string }) => {
        inspected.push(`${value.kind}:${value.id}`)
      },
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const text = host.textContent ?? ''
    expect(text).toContain('共同完成 · 搭档协作')
    expect(text).toContain('可作为协作经验和 Memory，不等同于用户独立完成。')
    expect(text).toContain('可核对证据：')
    expect(text).toContain('job:job_crypto_shared')
    expect(text).toContain('judge:receipt_crypto_1')
    expect(text).toContain('hint:hint_used_1')
    expect(text).toContain('step:user_step_1')
    expect(text).not.toContain('failure:dead_branch_1')
    const judgeEvidence = host.querySelector<HTMLButtonElement>('[data-evidence-kind="judge"]')
    expect(judgeEvidence?.getAttribute('title'))
      .toBe('judge:receipt_crypto_1')
    judgeEvidence?.click()
    await nextTick()
    expect(inspected).toEqual(['judge:receipt_crypto_1'])
  })

  it('labels user independent memories as ability evidence without changing correctness evidence', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFMemoryRecall, {
      memories: [memory({
        id: 'memory-user-independent',
        actor: 'user',
        assistance: 'none',
        summary: '用户独立完成 Web 参数枚举，并保留 Judge 回执。',
        category: 'web',
        tags: ['web', 'enumeration'],
        evidenceRefs: ['judge:receipt_web_1', 'step:user_step_1'],
        recall: {
          schemaVersion: 'ctf-training-memory-recall/v1alpha1',
          score: 0.9,
          reasons: ['同为参数枚举'],
          evidence: [
            { kind: 'judge', id: 'receipt_web_1', label: 'Judge 回执 receipt_web_1' },
            { kind: 'step', id: 'user_step_1', label: '用户步骤 user_step_1' },
          ],
        },
      })],
      onArchive: () => {},
      onInspectEvidence: () => {},
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const text = host.textContent ?? ''
    expect(text).toContain('用户完成 · 无协助')
    expect(text).toContain('可作为用户独立完成能力证据。')
    expect(text).toContain('Judge 回执 receipt_web_1')
    expect(text).not.toContain('不增加用户独立完成计数')
  })

  it('redacts provider credentials from recalled legacy memory text and evidence', async () => {
    const inspected: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFMemoryRecall, {
      memories: [memory({
        id: 'memory-legacy-secret',
        title: 'Legacy sk-title-secret12345',
        summary: 'Old note leaked Bearer provider-token-12345 and OPENAI_API_KEY=sk-env-secret12345',
        tags: ['api_key=sk-tag-secret12345', 'web'],
        evidenceRefs: [
          'judge:receipt_1',
          'failure:sk-evidence-secret12345',
        ],
        recall: {
          schemaVersion: 'ctf-training-memory-recall/v1alpha1',
          score: 0.4,
          reasons: ['历史导入记录'],
          evidence: [
            {
              kind: 'judge',
              id: 'receipt_1',
              label: 'Judge 回执 receipt_1',
            },
            {
              kind: 'failure',
              id: 'sk-evidence-secret12345',
              label: '失败分支 Bearer evidence-token-12345',
            },
          ],
        },
      })],
      onArchive: () => {},
      onInspectEvidence: (value: { kind: string, id: string, label: string }) => {
        inspected.push(`${value.kind}:${value.id}:${value.label}`)
      },
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const text = host.textContent ?? ''
    expect(text).toContain('[credential redacted]')
    expect(text).not.toContain('sk-title-secret12345')
    expect(text).not.toContain('provider-token-12345')
    expect(text).not.toContain('sk-env-secret12345')
    expect(text).not.toContain('sk-tag-secret12345')
    expect(text).not.toContain('sk-evidence-secret12345')
    expect(text).not.toContain('evidence-token-12345')

    const archive = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="停用记忆："]',
    )
    expect(archive?.getAttribute('aria-label')).not.toContain('sk-title-secret12345')

    const failureEvidence = host.querySelector<HTMLButtonElement>('[data-evidence-kind="failure"]')
    expect(failureEvidence?.getAttribute('data-evidence-id')).toBe('[credential redacted]')
    expect(failureEvidence?.getAttribute('title')).toBe('failure:[credential redacted]')
    failureEvidence?.click()
    await nextTick()
    expect(inspected).toEqual([
      'failure:[credential redacted]:失败分支 Bearer [credential redacted]',
    ])
  })
})
