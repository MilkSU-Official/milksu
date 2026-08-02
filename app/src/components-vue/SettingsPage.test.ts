// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsPage from './SettingsPage.vue'
import { withAppSettingsDefaults, type AppSettings, type LocalDataStatus } from '@/types'

// jsdom does not implement ResizeObserver; @felinic/ui components (e.g. the
// settings-category SegmentedControl) call it on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

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

async function mountSettingsPage(status: LocalDataStatus) {
  ;(window as unknown as { go?: unknown }).go = {
    main: {
      App: {
        GetLocalDataStatus: async () => status,
      },
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SettingsPage, {
    settings: withAppSettingsDefaults({} as AppSettings),
    initialCategory: 'general',
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  await settle()
}

const fiveDatabases: LocalDataStatus = {
  directory: '/home/user/.milksu',
  fileCount: 42,
  bytes: 4096,
  databases: [
    {
      logicalName: 'EventStore',
      relativePath: 'runtime/events.sqlite3',
      current: 1,
      supported: 1,
      state: 'compatible',
    },
    {
      logicalName: 'CTF Memory',
      relativePath: 'ctf/memory.sqlite3',
      state: 'remaining',
    },
    {
      logicalName: 'NSSCTF Catalog',
      relativePath: 'nssctf/catalog.sqlite3',
      state: 'missing',
      supported: 1,
    },
    {
      logicalName: 'CTFshow Catalog',
      relativePath: 'ctfshow/catalog.sqlite3',
      current: 2,
      supported: 1,
      state: 'newer',
    },
    {
      logicalName: 'Corrupted DB',
      relativePath: 'runtime/corrupt.sqlite3',
      state: 'corrupt',
      supported: 1,
      error: 'corrupt migration history: <data> schema_migrations',
    },
  ],
}

describe('SettingsPage database compatibility', () => {
  it('renders all five database compatibility states', async () => {
    await mountSettingsPage(fiveDatabases)
    const text = document.body.textContent ?? ''

    for (const label of ['兼容', '尚未创建', '数据库较新', '损坏或不可读', '尚未纳入迁移']) {
      expect(text).toContain(label)
    }
    for (const name of ['EventStore', 'CTF Memory', 'NSSCTF Catalog', 'CTFshow Catalog', 'Corrupted DB']) {
      expect(text).toContain(name)
    }
    for (const path of [
      'runtime/events.sqlite3',
      'ctf/memory.sqlite3',
      'nssctf/catalog.sqlite3',
      'ctfshow/catalog.sqlite3',
      'runtime/corrupt.sqlite3',
    ]) {
      expect(text).toContain(path)
    }
    expect(text).toContain('当前 v1 · 支持 v1')
    expect(text).toContain('当前 v2 · 支持 v1')
    expect(text).toContain('支持 v1')
    expect(text).not.toContain('v1 / v1')
    expect(text).not.toContain('当前 v1 / 支持 v1')
    expect(text).toContain('corrupt migration history: <data> schema_migrations')
    expect(text).not.toContain('credentials.db')

    const relativePaths = [
      'runtime/events.sqlite3',
      'ctf/memory.sqlite3',
      'nssctf/catalog.sqlite3',
      'ctfshow/catalog.sqlite3',
      'runtime/corrupt.sqlite3',
    ]
    const compatItems = [...document.querySelectorAll('li')].filter(li =>
      relativePaths.some(path => li.textContent?.includes(path)),
    )
    expect(compatItems.length).toBeGreaterThanOrEqual(5)
    const compatMarkup = compatItems.map(item => item.outerHTML).join('')
    expect(compatMarkup).not.toContain('凭据库')

    for (const item of compatItems) {
      expect(item.className).toContain('min-w-0')

      const header = item.querySelector('div.flex-col')
      expect(header).not.toBeNull()
      expect((header as HTMLElement).className).toContain('flex-col')
      expect((header as HTMLElement).className).toContain('sm:flex-row')

      const pathParagraph = item.querySelector('p.break-all')
      expect(pathParagraph).not.toBeNull()
      expect((pathParagraph as HTMLElement).className).toContain('break-all')
    }

    const corruptItem = compatItems.find(item =>
      item.textContent?.includes('runtime/corrupt.sqlite3'),
    )
    expect(corruptItem).toBeDefined()
    const errorParagraph = corruptItem?.querySelector('p.break-words')
    expect(errorParagraph).not.toBeNull()
    expect((errorParagraph as HTMLElement).className).toContain('break-words')
  })

  it('databases omitted renders no compat list and keeps existing UI', async () => {
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    })
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('数据库兼容性')
    for (const label of ['兼容', '尚未创建', '数据库较新', '损坏或不可读', '尚未纳入迁移']) {
      expect(text).not.toContain(label)
    }
    for (const existing of ['数据与备份', '打开数据目录', '导出安全备份', '从备份恢复', '导出诊断包']) {
      expect(text).toContain(existing)
    }
  })
})
