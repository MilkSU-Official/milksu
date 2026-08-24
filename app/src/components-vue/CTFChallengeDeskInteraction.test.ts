// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import CTFChallengeDesk from './CTFChallengeDesk.vue'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
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
  const onSelectNssctf = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CTFChallengeDesk, {
    activeBank: 'nssctf',
    nssctfProblems: [dailyProblem()],
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
    onSelectNssctf,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  const action = host.querySelector<HTMLButtonElement>('[data-testid="open-item"]')
  return { action, onSelectNssctf, host }
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

function catalogProblem(platformId: number, difficulty: number): NSSCTFCatalogProblem {
  return {
    ...dailyProblem(),
    platformId,
    title: `难度 ${difficulty}`,
    difficulty,
  }
}

describe('CTFChallengeDesk primary action', () => {
  it('uses theme-aware tag surfaces and keeps the category and difficulty signals distinct', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const problems = [
      catalogProblem(1, 1.5),
      catalogProblem(2, 2.8),
      catalogProblem(3, 4),
    ]
    const app = createApp(CTFChallengeDesk, {
      activeBank: 'nssctf',
      nssctfProblems: problems,
      ctfshowProblems: [],
      selectedNssctf: null,
      selectedCtfshow: null,
      dailyProblem: problems[0],
      page: 1,
      pageCount: 1,
      total: problems.length,
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
      collectionStore: createItemCollectionStore('test.ctf.tags.collections'),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.querySelector('.ctf-challenge-list')).toBeTruthy()
    expect(host.querySelector('.ctf-catalog-tag--category')).toBeTruthy()
    expect(host.querySelector('.ctf-catalog-tag--daily.ak-tag--advanced')).toBeTruthy()
    const difficultyTags = [...host.querySelectorAll('.ctf-catalog-tag--difficulty')]
    expect(difficultyTags).toHaveLength(3)
    expect(difficultyTags[0]?.classList.contains('ak-tag--neutral')).toBe(true)
    expect(difficultyTags[1]?.classList.contains('ak-tag--advanced')).toBe(true)
    expect(difficultyTags[2]?.classList.contains('ak-tag--danger')).toBe(true)

    expect(ctfChallengeDeskSource).toContain('--ak-tag-surface: var(--surface-raised)')
    expect(ctfChallengeDeskSource).toContain('--ak-tag-text: var(--foreground)')
    expect(ctfChallengeDeskSource).toContain('--ak-tag-signal: var(--brand)')
    expect(ctfChallengeDeskSource).toContain('--ak-tag-signal: var(--signal-gold)')
    expect(ctfChallengeDeskSource).toContain('--ak-tag-signal: var(--destructive)')
    expect(ctfChallengeDeskSource).not.toContain('--ak-tag-surface: rgba(')
  })

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
      emptyTitle: '',
      emptyDetail: '',
    })

    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.textContent).not.toContain('尚未同步 CTFshow 题库')
    expect(host.textContent).not.toContain('同步到 MilkSU')
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
    expect(host.textContent).not.toContain('换一道')
    expect(host.textContent).not.toContain('取消选中')
  })

  it('opens a catalog row into a detail selection instead of expanding it', async () => {
    const { action, onSelectNssctf, host } = await mountDesk({
      catalogLoading: false,
      actionLoading: false,
    })
    expect(host.querySelector('[data-testid="catalog-row"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="catalog-row"]')?.tagName).toBe('ARTICLE')
    expect(action).toBeTruthy()
    action?.click()
    await nextTick()
    expect(onSelectNssctf).toHaveBeenCalledWith(3347)
  })

  it('does not enter detail when the title is selected', async () => {
    const { onSelectNssctf, host } = await mountDesk({
      catalogLoading: false,
      actionLoading: false,
    })
    const title = [...host.querySelectorAll('span')].find(node => node.textContent?.includes('RSA 训练题'))
    title?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(onSelectNssctf).not.toHaveBeenCalled()
  })

  it('keeps catalog rows clickable while the catalog refreshes in background', async () => {
    const { action, onSelectNssctf } = await mountDesk({
      catalogLoading: true,
      actionLoading: false,
    })

    expect(action).toBeTruthy()
    expect(action?.disabled).toBe(false)
    action?.click()
    await nextTick()
    expect(onSelectNssctf).toHaveBeenCalledWith(3347)
  })
})
