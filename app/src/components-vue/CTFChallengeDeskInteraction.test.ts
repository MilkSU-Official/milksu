// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import CTFChallengeDesk from './CTFChallengeDesk.vue'
import type { NSSCTFChallenge } from '@/nssctfTypes'

const mountedApps: VueApp[] = []

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function selectedChallenge(hasAttachment = false): NSSCTFChallenge {
  return {
    platform: 'NSSCTF',
    platformId: 3347,
    sourceUrl: 'https://www.nssctf.cn/problem/3347',
    title: 'RSA 训练题',
    statement: '公开题面',
    category: 'Crypto',
    points: 100,
    difficulty: 1.5,
    tags: ['RSA'],
    hasAttachment,
    hasEnvironment: false,
    writeupCount: 0,
    solvedCount: 1,
    wrongAnswerCount: 0,
    importedAt: '2026-08-10T00:00:00Z',
  }
}

async function mountDesk(options: { catalogLoading: boolean; actionLoading: boolean; hasAttachment?: boolean }) {
  const onStartNssctf = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CTFChallengeDesk, {
    activeBank: 'nssctf',
    nssctfProblems: [],
    ctfshowProblems: [],
    selectedNssctf: selectedChallenge(options.hasAttachment),
    selectedCtfshow: null,
    dashboard: null,
    nssctfAttemptedIds: [],
    nssctfCompletedIds: [],
    ctfshowAttemptedIds: [],
    ctfshowCompletedIds: [],
    page: 1,
    pageCount: 1,
    total: 1,
    loading: options.catalogLoading,
    actionLoading: options.actionLoading,
    collaborationMode: 'copilot',
    selectedBrowserReady: false,
    ctfshowBridgeReady: false,
    attachmentError: '',
    localMaterials: [],
    catalogError: '',
    modelVerified: false,
    catalogReady: true,
    judgeReady: false,
    hasActiveTraining: false,
    onStartNssctf,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  const action = Array.from(host.querySelectorAll('button')).find(button => (
    button.textContent?.includes('在 Coding 中打开')
  )) as HTMLButtonElement | undefined
  return { action, onStartNssctf }
}

describe('CTFChallengeDesk primary action', () => {
  it('keeps open-Coding enabled while the catalog refreshes in background', async () => {
    const { action, onStartNssctf } = await mountDesk({
      catalogLoading: true,
      actionLoading: false,
    })

    expect(action).toBeTruthy()
    expect(action?.disabled).toBe(false)
    action?.click()
    await nextTick()
    expect(onStartNssctf).toHaveBeenCalledTimes(1)
  })

  it('keeps missing NSSCTF attachments from blocking the Coding handoff', async () => {
    const { action, onStartNssctf } = await mountDesk({
      catalogLoading: false,
      actionLoading: false,
      hasAttachment: true,
    })

    expect(action).toBeTruthy()
    expect(action?.disabled).toBe(false)
    action?.click()
    await nextTick()
    expect(onStartNssctf).toHaveBeenCalledTimes(1)
  })

  it('blocks duplicate clicks only while the handoff itself is running', async () => {
    const { action, onStartNssctf } = await mountDesk({
      catalogLoading: false,
      actionLoading: true,
    })

    expect(action?.disabled).toBe(true)
    action?.click()
    await nextTick()
    expect(onStartNssctf).not.toHaveBeenCalled()
  })
})
