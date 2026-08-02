// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CTFDebrief from './CTFDebrief.vue'
import type { CTFDebrief as Debrief, CTFHumanOutcome } from '@/ctfTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
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

    expect(host.textContent).toContain('Judge 只证明答案是否正确')
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
})
