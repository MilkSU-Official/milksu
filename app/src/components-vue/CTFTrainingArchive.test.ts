// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CTFTrainingArchive from './CTFTrainingArchive.vue'
import type { CTFTrainingReportExport } from '@/ctfTypes'

const mountedApps: App[] = []

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  delete (window as unknown as { go?: unknown }).go
})

function delegatedReport(): CTFTrainingReportExport {
  return {
    jsonPath: '/workspace/.milksu/ctf/reports/job_delegate/report.json',
    markdownPath: '/workspace/.milksu/ctf/reports/job_delegate/report.md',
    report: {
      schemaVersion: 'ctf-training-report/v1alpha1',
      generatedAt: '2026-08-03T00:00:00Z',
      jobId: 'job_delegate',
      title: '代理模式 Pwn 练习',
      trackName: 'Pwn',
      category: 'pwn',
      collaborationMode: 'delegate',
      externalPlatform: 'fixture',
      sourceUri: 'fixture://pwn/delegate',
      status: 'succeeded',
      verified: true,
      outcomeSummary: 'Judge accepted the delegated solver candidate.',
      knowledgePoints: ['stack offset'],
      materials: [],
      toolUsage: {
        bash: 2,
      },
      keyObservations: ['Agent found the offset.'],
      failureBranches: ['First payload crashed before return address control.'],
      judgeReceipts: [{
        platform: 'fixture',
        status: 'accepted',
        correct: true,
        summary: 'correct=true',
        reference: 'judge:fixture:accepted',
        recordedAt: '2026-08-03T00:01:00Z',
      }],
      contribution: {
        primaryActor: 'agent',
        assistance: 'delegated',
        userRecords: 0,
        agentRecords: 4,
        sharedRecords: 0,
        importedRecords: 0,
        userIndependentSteps: 0,
        userAssistedSteps: 0,
      },
      stats: {
        attempts: 1,
        experiments: 2,
        evidence: 3,
        artifacts: 1,
        completedTurns: 3,
        toolCalls: 2,
        toolErrors: 0,
        hints: 0,
        independentSteps: 0,
        reflections: 0,
        candidates: 1,
      },
      markdown: [
        '# 代理模式 Pwn 练习',
        '',
        'Judge accepted, but contribution remains delegated to the Agent.',
      ].join('\n'),
    },
  }
}

describe('CTFTrainingArchive', () => {
  it('does not present delegated Agent success as user-independent training', async () => {
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          GenerateCTFTrainingReport: async (jobId: string) => {
            expect(jobId).toBe('job_delegate')
            return delegatedReport()
          },
        },
      },
    }

    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFTrainingArchive, {
      jobId: 'job_delegate',
      replayAvailable: false,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const generate = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('生成报告'),
    )
    expect(generate).not.toBeUndefined()
    generate?.click()
    await settle()

    const text = host.textContent ?? ''
    expect(text).toContain('平台已验证')
    expect(text).toContain('Agent 代做')
    expect(text).toContain('代理完成')
    expect(text).toContain('用户独立步骤')
    expect(text).toMatch(/用户独立步骤\s*0/)
    expect(text).not.toContain('用户完成')
    expect(text).not.toContain('无协助')
  })
})
