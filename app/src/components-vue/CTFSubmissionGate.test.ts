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

function mountGate(value: string, data = projection()) {
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
    platformReview: false,
    externalJudgeLabel: '外部平台',
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
})
