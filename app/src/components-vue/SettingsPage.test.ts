// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsPage from './SettingsPage.vue'
import type { CodingComputerUseStatus } from '@/codingEnvironmentTypes'
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

interface MountSettingsOptions {
  initialCategory?: 'general' | 'apikeys'
  settings?: AppSettings
  appMethods?: Record<string, (...args: unknown[]) => Promise<unknown>>
}

async function mountSettingsPage(
  status: LocalDataStatus,
  options: MountSettingsOptions = {},
) {
  const settings = options.settings ?? withAppSettingsDefaults({} as AppSettings)
  const defaultComputerUseStatus: CodingComputerUseStatus = {
    available: true,
    enabled: false,
    phase: 'disabled',
    permissions: {
      accessibility: true,
      screenRecording: true,
    },
    signing: {
      bundleId: 'com.milksu.app',
      executablePath: '/Applications/MilkSU.app',
      signature: 'signed',
      teamIdentifier: 'MILKSUDEV',
      stableIdentity: true,
    },
  }
  ;(window as unknown as { go?: unknown }).go = {
    main: {
      App: {
        GetLocalDataStatus: async () => status,
        GetStartupRecoveryStatus: async () => ({
          previousExit: 'abnormal',
          previousStartedAt: '2026-08-03T04:00:00Z',
          consecutiveAbnormalExits: 2,
          previousPid: 4242,
          startedAt: '2026-08-03T05:00:00Z',
        }),
        GetCodingComputerUseStatus: async () => defaultComputerUseStatus,
        ...options.appMethods,
      },
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SettingsPage, {
    settings,
    initialCategory: options.initialCategory ?? 'general',
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

  it('renders abnormal-exit recovery status from the desktop runtime', async () => {
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('启动与退出状态')
    expect(text).toContain('异常退出')
    expect(text).toContain('连续 2 次异常退出')
    expect(text).toContain('上次启动于')
    expect(text).toContain('上次进程 4242')
    expect(text).toContain('本次启动')
  })

  it('rechecks Computer Use permissions from Settings without opening system grants', async () => {
    let checks = 0
    let permissionRequests = 0
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      appMethods: {
        GetCodingComputerUseStatus: async () => {
          checks += 1
          return {
            available: true,
            enabled: false,
            phase: 'disabled',
            permissions: {
              accessibility: checks >= 2,
              screenRecording: true,
            },
            signing: {
              bundleId: 'com.milksu.app',
              executablePath: '/Applications/MilkSU.app',
              signature: 'signed',
              teamIdentifier: 'MILKSUDEV',
              stableIdentity: true,
            },
          } satisfies CodingComputerUseStatus
        },
        RequestCodingComputerUsePermissions: async () => {
          permissionRequests += 1
          throw new Error('should not open system settings during readonly refresh')
        },
      },
    })

    expect(checks).toBe(1)
    let text = document.body.textContent ?? ''
    expect(text).toContain('Computer Use')
    expect(text).toContain('辅助功能 未授权')
    expect(text).toContain('屏幕录制 已授权')
    expect(text).toContain('打开系统权限设置')

    const refresh = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('重新检测'))
    expect(refresh).toBeDefined()
    refresh?.click()
    for (let index = 0; index < 4; index += 1) await settle()

    expect(checks).toBe(2)
    expect(permissionRequests).toBe(0)
    text = document.body.textContent ?? ''
    expect(text).toContain('Computer Use 权限状态已重新检测')
    expect(text).toContain('辅助功能 已授权')
    expect(text).toContain('屏幕录制 已授权')
    expect(text).toContain('已授权')
  })

  it('does not encourage repeated Computer Use permission prompts for unstable builds', async () => {
    let permissionRequests = 0
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      appMethods: {
        GetCodingComputerUseStatus: async () => ({
          available: true,
          enabled: false,
          phase: 'disabled',
          permissions: {
            accessibility: false,
            screenRecording: false,
          },
          signing: {
            bundleId: 'com.milksu.app',
            executablePath: '/Applications/MilkSU.app',
            signature: 'adhoc',
            teamIdentifier: 'not set',
            stableIdentity: false,
            problem: '当前构建不是稳定 Developer ID 签名；系统设置里显示已勾选时，TCC 探针仍可能对当前二进制返回未授权。',
          },
        }) satisfies CodingComputerUseStatus,
        RequestCodingComputerUsePermissions: async () => {
          permissionRequests += 1
          throw new Error('should not prompt again for unstable signing')
        },
      },
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('系统权限')
    expect(text).toContain('先稳定签名再复检')
    expect(text).toContain('不要反复授权')
    expect(text).toContain('当前构建身份：ad-hoc · Team 未设置')
    expect(text).toContain('Developer ID')
    expect(text).not.toContain('打开系统权限设置')

    const blocked = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('先稳定签名再复检'))
    expect(blocked?.disabled).toBe(true)
    blocked?.click()
    for (let index = 0; index < 2; index += 1) await settle()
    expect(permissionRequests).toBe(0)
  })

  it('keeps settings saved and explains an offline model verification failure', async () => {
    const settings = withAppSettingsDefaults({} as AppSettings)
    let saved = false
    let probed = false
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      initialCategory: 'apikeys',
      settings,
      appMethods: {
        SaveSettingsCmd: async () => {
          saved = true
        },
        GetSettings: async () => settings,
        TestAgentModel: async () => {
          probed = true
          throw new Error(
            'PI model verification failed: dial tcp 127.0.0.1:65533: connect: connection refused api_key=[REDACTED]',
          )
        },
      },
    })

    const saveButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存并验证'))
    expect(saveButton).toBeDefined()
    saveButton?.click()
    for (let index = 0; index < 6; index += 1) await settle()

    const text = document.body.textContent ?? ''
    expect(saved).toBe(true)
    expect(probed).toBe(true)
    expect(text).toContain('凭据已保存，但 PI 模型验证失败')
    expect(text).toContain('127.0.0.1:65533')
    expect(text).toContain('connection refused')
    expect(text).toContain('[REDACTED]')
    expect(text).not.toContain('synthetic-secret-value')
  })

  it('keeps model settings on one daily model route and includes TokenFlux without Kimi in the normal UI', async () => {
    let savedSettings: unknown = null
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'grok-4.3',
      providers: {},
    } as AppSettings)
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      initialCategory: 'apikeys',
      settings,
      appMethods: {
        SaveSettingsCmd: async (value: unknown) => {
          savedSettings = value as AppSettings
        },
        GetSettings: async () => savedSettings ?? settings,
        TestAgentModel: async () => ({
          provider: 'tokenflux',
          model: 'grok-4.3',
          ready: true,
          latencyMs: 42,
        }),
      },
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('模型与凭据')
    expect(text).toContain('默认模型')
    expect(text).toContain('词元流动')
    expect(text).toContain('grok-4.3')
    expect(text).not.toContain('快速执行')
    expect(text).not.toContain('深度策略')
    expect(text).not.toContain('KouriChat')
    expect(text).not.toContain('kimi-k3')

    const saveButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存并验证'))
    expect(saveButton).toBeDefined()
    saveButton?.click()
    for (let index = 0; index < 6; index += 1) await settle()

    expect(savedSettings).not.toBeNull()
    const persisted = savedSettings as AppSettings
    expect(persisted.active_provider).toBe('tokenflux')
    expect(persisted.active_model).toBe('grok-4.3')
    expect('model_routing' in persisted).toBe(false)
  })
})
