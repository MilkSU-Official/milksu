// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import CTFChallengeDesk from './CTFChallengeDesk.vue'
import { createItemCollectionStore } from '@/lib/itemCollections'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type { NSSCTFCatalogProblem } from '@/nssctfTrainingTypes'

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
    collectionStore: createItemCollectionStore('test.ctf.collections'),
    onStartNssctf,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  const action = Array.from(host.querySelectorAll('button')).find(button => (
    button.textContent?.includes('交给 Coding')
  )) as HTMLButtonElement | undefined
  return { action, onStartNssctf }
}

function dailyProblem(): NSSCTFCatalogProblem {
  return {
    platformId: 3347,
    sourceUrl: 'https://www.nssctf.cn/problem/3347',
    title: 'RSA 训练题',
    category: 'Crypto',
    points: 100,
    difficulty: 1.5,
    tags: ['RSA'],
    hasWriteup: false,
    solvedCount: 1,
    wrongAnswerCount: 0,
    noAnswerCount: 0,
    open: true,
    syncedAt: '2026-08-10T00:00:00Z',
  }
}

describe('CTFChallengeDesk primary action', () => {
  it('explains how to populate an empty CTFshow catalog', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(CTFChallengeDesk, {
      activeBank: 'ctfshow',
      nssctfProblems: [],
      ctfshowProblems: [],
      selectedNssctf: null,
      selectedCtfshow: null,
      page: 1,
      pageCount: 1,
      total: 0,
      loading: false,
      actionLoading: false,
      collaborationMode: 'copilot',
      selectedBrowserReady: false,
      ctfshowBridgeReady: false,
      attachmentError: '',
      localMaterials: [],
      catalogError: '',
      modelVerified: false,
      catalogReady: false,
      judgeReady: false,
      hasActiveTraining: false,
      collectionStore: createItemCollectionStore('test.ctf.empty.collections'),
      emptyTitle: '尚未同步 CTFshow 题库',
      emptyDetail: '请在 CTFshow 题库页面点击 MilkSU 浏览器扩展并选择“同步到 MilkSU”。',
    })

    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.textContent).toContain('尚未同步 CTFshow 题库')
    expect(host.textContent).toContain('同步到 MilkSU')
    expect(host.textContent).toContain('打开 CTFshow')

  })

  it('renders an actionable catalog loading explanation instead of an unlabeled spinner', async () => {
    const onOpenCtfshow = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFChallengeDesk, {
      activeBank: 'ctfshow',
      nssctfProblems: [],
      ctfshowProblems: [],
      selectedNssctf: null,
      selectedCtfshow: null,
      page: 1,
      pageCount: 1,
      total: 0,
      loading: true,
      loadingTitle: '正在检查 CTFshow 连接',
      loadingDetail: '请在 CTFshow 题库页面点击 MilkSU 浏览器扩展。',
      actionLoading: false,
      collaborationMode: 'copilot',
      selectedBrowserReady: false,
      ctfshowBridgeReady: false,
      attachmentError: '',
      localMaterials: [],
      catalogError: '',
      modelVerified: false,
      catalogReady: false,
      judgeReady: false,
      hasActiveTraining: false,
      collectionStore: createItemCollectionStore('test.ctf.loading.collections'),
      onOpenCtfshow,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const state = host.querySelector('[data-testid="ctf-catalog-loading-state"]')
    expect(state?.textContent).toContain('正在检查 CTFshow 连接')
    expect(state?.textContent).toContain('点击 MilkSU 浏览器扩展')
    const open = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('打开 CTFshow'))
    open?.click()
    await nextTick()
    expect(onOpenCtfshow).toHaveBeenCalledOnce()
  })

  it('only labels the explicitly selected daily challenge and allows changing it', async () => {
    const onChangeDaily = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFChallengeDesk, {
      activeBank: 'nssctf',
      nssctfProblems: [dailyProblem()],
      ctfshowProblems: [],
      selectedNssctf: selectedChallenge(),
      dailyProblem: dailyProblem(),
      page: 1,
      pageCount: 1,
      total: 1,
      loading: false,
      actionLoading: false,
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
      collectionStore: createItemCollectionStore('test.ctf.daily.collections'),
      onChangeDaily,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.textContent).toContain('Daily')
    expect(host.textContent).toContain('每日挑战')
    const change = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('换一道'))
    change?.click()
    await nextTick()
    expect(onChangeDaily).toHaveBeenCalledTimes(1)
  })

  it('lets the user collapse the selected challenge', async () => {
    const onClearSelection = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFChallengeDesk, {
      activeBank: 'nssctf',
      nssctfProblems: [],
      ctfshowProblems: [],
      selectedNssctf: selectedChallenge(),
      selectedCtfshow: null,
      dashboard: null,
      nssctfAttemptedIds: [],
      nssctfCompletedIds: [],
      ctfshowAttemptedIds: [],
      ctfshowCompletedIds: [],
      page: 1,
      pageCount: 1,
      total: 1,
      loading: false,
      actionLoading: false,
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
      collectionStore: createItemCollectionStore('test.ctf.clear.collections'),
      onClearSelection,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    const clear = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('取消选中'))
    expect(clear).toBeTruthy()
    clear?.click()
    await nextTick()
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

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
