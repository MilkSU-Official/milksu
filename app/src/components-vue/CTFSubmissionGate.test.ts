// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CTFSubmissionGate from './CTFSubmissionGate.vue'
import type { CTFProjection } from '@/ctfTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function projection(overrides: Partial<CTFProjection> = {}): CTFProjection {
  return {
    challenge: { externalPlatform: 'nssctf-web' },
    agentCandidates: [{
      id: 'candidate_1',
      sessionId: 'session_1',
      candidate: 'NSSCTF{candidate}',
      explanation: '候选来自 Agent 的显式候选文件。',
      artifactId: 'artifact_1',
      assessment: { status: 'plausible', warnings: [] },
      createdAt: '2026-08-03T00:00:00Z',
    }],
    submissions: [],
    judgeReceipts: [],
    evaluations: [],
    ...overrides,
  } as CTFProjection
}

function mountGate(
  value: string,
  data = projection(),
  overrides: Partial<{
    platformReview: boolean
    externalJudgeLabel: string
  }> = {},
) {
  const submitted: boolean[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CTFSubmissionGate, {
    modelValue: value,
    projection: data,
    working: false,
    canContinue: true,
    activeStartCost: 0,
    activeBrowserCanSubmit: true,
    ctfshowBridgeReady: false,
    platformReview: overrides.platformReview ?? false,
    externalJudgeLabel: overrides.externalJudgeLabel ?? '外部平台',
    onSubmit: () => submitted.push(true),
  })
  app.mount(host)
  mountedApps.push(app)
  return { host, submitted }
}

describe('CTFSubmissionGate', () => {
  it('renders the discovered candidate as the only solve-time submission action', async () => {
    const { host, submitted } = mountGate('NSSCTF{candidate}')
    await nextTick()

    expect(host.textContent).toContain('提交候选')
    expect(host.textContent).toContain('Agent 候选已载入')
    expect(host.textContent).not.toContain('Endpoint 授权')
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('NSSCTF{candidate}')

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('提交到 NSSCTF'),
    )
    expect(submit?.disabled).toBe(false)
    submit?.click()
    await nextTick()
    expect(submitted).toEqual([true])
  })

  it('blocks an already rejected candidate instead of offering another blind retry', async () => {
    const data = projection({
      submissions: [{
        candidate: 'NSSCTF{candidate}',
        verdict: 'fail',
        summary: 'Rejected',
      }],
    })
    const { host } = mountGate('NSSCTF{candidate}', data)
    await nextTick()

    expect(host.textContent).toContain('已经被平台拒绝')
    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('提交到 NSSCTF'),
    )
    expect(submit?.disabled).toBe(true)
  })

  it('redacts provider credentials from candidate rationale and Judge review text', async () => {
    const data = projection({
      agentCandidates: [{
        id: 'candidate_secret',
        sessionId: 'session_1',
        candidate: 'NSSCTF{candidate}',
        explanation: '候选来自 Bearer candidate-token-12345 的调试日志。',
        artifactId: 'artifact_1',
        assessment: {
          status: 'unusual',
          warnings: ['OPENAI_API_KEY=sk-warning-secret12345'],
        },
        createdAt: '2026-08-03T00:00:00Z',
      }],
      judgeReceipts: [{
        id: 'judge_secret',
        platform: 'NSSCTF',
        status: 'error',
        correct: false,
        summary: 'Judge failed with x-api-key: sk-judge-secret12345',
        reference: 'receipt',
        recordedAt: '2026-08-03T00:10:00Z',
      }],
      evaluations: [{ verdict: 'inconclusive' }],
    } as Partial<CTFProjection>)
    const { host, submitted } = mountGate('NSSCTF{candidate}', data, {
      platformReview: true,
      externalJudgeLabel: '外部 Judge api_key=sk-label-secret12345',
    })
    await nextTick()

    const text = host.textContent ?? ''
    expect(text).toContain('Bearer [credential redacted]')
    expect(text).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(text).toContain('x-api-key=[credential redacted]')
    expect(text).toContain('外部 Judge api_key=[credential redacted]的结果是？')
    expect(text).not.toContain('candidate-token-12345')
    expect(text).not.toContain('sk-warning-secret12345')
    expect(text).not.toContain('sk-judge-secret12345')
    expect(text).not.toContain('sk-label-secret12345')

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('提交到 NSSCTF'),
    )
    expect(submit?.disabled).toBe(false)
    submit?.click()
    await nextTick()
    expect(submitted).toEqual([true])
  })
})
