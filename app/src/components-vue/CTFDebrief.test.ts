// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CTFDebrief from './CTFDebrief.vue'
import type { CTFDebrief as Debrief, CTFHumanOutcome } from '@/ctfTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('CTFDebrief contribution evidence', () => {
  it('requires an explicit user confirmation before recording a step', async () => {
    const submitted: string[] = []
    const debrief: Debrief = {
      status: 'succeeded',
      summary: 'Judge accepted the candidate.',
      keyObservations: [],
      failureBranches: [],
      candidates: [],
      knowledgePoints: [],
      hintCount: 1,
      reflectionCount: 0,
      independentSteps: 0,
      evidenceCount: 1,
      artifactCount: 0,
      needsReflection: true,
      recommendedNextAction: 'Write a reflection.',
    }
    const humanOutcome: CTFHumanOutcome = {
      goal: 'Understand the parser.',
      knowledgePoints: [],
      hintCount: 1,
      reflectionCount: 0,
      independentSteps: 0,
      contribution: {
        primaryActor: 'user',
        assistance: 'hint',
        userRecords: 1,
        agentRecords: 1,
        sharedRecords: 0,
        importedRecords: 0,
        userIndependentSteps: 0,
        userAssistedSteps: 1,
      },
      summary: 'Evidence-backed contribution.',
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFDebrief, {
      debrief,
      humanOutcome,
      onSubmitIndependentStep: (content: string) => submitted.push(content),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.textContent).not.toContain('Judge 只证明答案是否正确')
    expect(host.textContent).toContain('依赖提示')
    expect(host.textContent).toContain('用户在协助下 1 步')

    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder*="我手动比较"]',
    )
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('保存用户步骤'),
    )
    expect(textarea).not.toBeNull()
    expect(checkbox).not.toBeNull()
    expect(save?.disabled).toBe(true)

    if (!textarea || !checkbox || !save) throw new Error('missing user-step controls')
    textarea.value = 'I reproduced the parsing branch.'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(save.disabled).toBe(true)

    checkbox.click()
    await nextTick()
    expect(save.disabled).toBe(false)
    save.click()
    await nextTick()
    expect(submitted).toEqual(['I reproduced the parsing branch.'])
  })

  it('copies a bounded CTF debrief handoff summary', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    const debrief: Debrief = {
      status: 'succeeded',
      summary: 'Judge accepted the candidate.',
      keyObservations: ['Manual diff confirmed the branch.'],
      failureBranches: ['The first encoding path was wrong.'],
      candidates: [
        { candidate: 'flag{wrong}', verdict: 'fail', summary: 'Rejected.' },
        { candidate: 'flag{ok}', verdict: 'pass', summary: 'Accepted.' },
      ],
      knowledgePoints: ['web'],
      hintCount: 1,
      reflectionCount: 2,
      independentSteps: 1,
      evidenceCount: 4,
      artifactCount: 1,
      needsReflection: false,
      recommendedNextAction: 'Save memory after checking contribution.',
    }
    const humanOutcome: CTFHumanOutcome = {
      goal: 'Solve one challenge.',
      knowledgePoints: ['web'],
      hintCount: 1,
      reflectionCount: 2,
      independentSteps: 1,
      contribution: {
        primaryActor: 'shared',
        assistance: 'copilot',
        userRecords: 2,
        agentRecords: 3,
        sharedRecords: 1,
        importedRecords: 0,
        userIndependentSteps: 1,
        userAssistedSteps: 1,
      },
      summary: 'Shared work with judge evidence.',
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFDebrief, {
      debrief,
      humanOutcome,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.textContent).toContain('复盘接力棒')
    expect(host.textContent).toContain('# MilkSU CTF 复盘接力棒')
    expect(host.textContent).toContain('Judge：Accepted')
    expect(host.textContent).toContain('贡献归属：用户与 Agent 共同完成；搭档协作')
    expect(host.textContent).not.toContain('不能写成用户独立能力事实')

    const copy = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('复制复盘摘要'))
    copy?.click()
    await Promise.resolve()
    await nextTick()

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('MilkSU CTF 复盘接力棒'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Judge：Accepted'))
    expect(writeText.mock.calls[0]?.[0]).not.toContain('不能写成用户独立能力事实')
    expect(host.textContent).toContain('已复制')
  })

})
