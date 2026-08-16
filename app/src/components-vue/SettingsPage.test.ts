// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsPage from './SettingsPage.vue'
import type { CodingComputerUseStatus } from '@/codingEnvironmentTypes'
import { installCustomProviderSettings, installModelCatalog } from '@/modelCatalog'
import {
  withAppSettingsDefaults,
  type AccountStatus,
  type AppSettings,
  type LocalDataStatus,
} from '@/types'

// jsdom does not implement ResizeObserver; @felinic/ui components (e.g. the
// settings-category SegmentedControl) call it on mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
HTMLElement.prototype.hasPointerCapture = () => false
HTMLElement.prototype.setPointerCapture = () => undefined
HTMLElement.prototype.releasePointerCapture = () => undefined
HTMLElement.prototype.scrollIntoView = () => undefined

const mountedApps: App[] = []

installModelCatalog({
  provider: 'tokenflux',
  source: 'remote',
  credential_source: 'account',
  refreshed_at: '2026-08-13T12:30:00Z',
  models: [
    { id: 'grok-4.5', name: 'Grok 4.5', context_window: 500000, max_tokens: 32768, input: ['text', 'image'] },
    { id: 'grok-4.3', name: 'Grok 4.3', context_window: 1000000, max_tokens: 32768, input: ['text'] },
  ],
})

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'go')
  Reflect.deleteProperty(window, 'milksu')
  installCustomProviderSettings({})
})

interface MountSettingsOptions {
  initialCategory?: 'general' | 'apikeys' | 'ctf' | 'cve' | 'coding' | 'browser' | 'security-tools'
  settings?: AppSettings
  accountStatus?: AccountStatus
  appMethods?: Record<string, (...args: unknown[]) => Promise<unknown>>
}

async function mountSettingsPage(
  status: LocalDataStatus,
  options: MountSettingsOptions = {},
) {
  const settings = options.settings ?? withAppSettingsDefaults({} as AppSettings)
  installCustomProviderSettings(settings.providers)
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
  const appMethods = {
    GetLocalDataStatus: async () => status,
    GetUserArtifactDirectoryStatus: async () => ({
      directory: '/Users/test/Documents/MilkSU',
    }),
    GetBuildTracking: async () => ({
      schema: 'milksu.build-tracking/v1',
      packaged: true,
      development: false,
      provenanceSource: 'packaged/sealed',
      channel: 'stable',
      productName: 'MilkSU',
      appId: 'com.milksu.app',
      gitBranch: 'main',
      gitCommit: '1add25ec965ac1f7cd2fcd1993ee2507bd5855b7',
      dirty: false,
      sourceFingerprint: '',
      buildTime: '2026-08-10T00:00:00.000Z',
      trackingId: 'ab'.repeat(32),
      missing: false,
    }),
    GetStartupRecoveryStatus: async () => ({
      previousExit: 'abnormal',
      previousStartedAt: '2026-08-03T04:00:00Z',
      consecutiveAbnormalExits: 2,
      previousPid: 4242,
      startedAt: '2026-08-03T05:00:00Z',
    }),
    GetCodingComputerUseStatus: async () => defaultComputerUseStatus,
    GetNSSCTFWebBridgeStatus: async () => ({
      bridge: {
        endpoint: 'ws://127.0.0.1:43123',
        pairingCode: 'copy-only-test-code',
        extensionPath: '/Applications/MilkSU.app/Contents/Resources/browserextension',
        active: true,
        connected: false,
      },
      pages: [],
    }),
    ...options.appMethods,
  }
  const milksuApi = {
    invoke(method: string, args: unknown[]) {
      const fn = (appMethods as Record<string, (...callArgs: unknown[]) => Promise<unknown>>)[method]
      if (!fn) throw new Error(`unexpected method ${method}`)
      return fn(...(args ?? []))
    },
    onEvent() {
      return () => {}
    },
  }
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: milksuApi,
  })
  Object.defineProperty(window, 'go', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: {
      main: {
        App: appMethods,
      },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SettingsPage, {
    settings,
    initialCategory: options.initialCategory ?? 'general',
    accountStatus: options.accountStatus,
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

describe('SettingsPage build tracking', () => {
  it('renders sealed provenance after the save control with full copyable fields', async () => {
    await mountSettingsPage(fiveDatabases)
    const panel = document.querySelector('[data-testid="build-tracking"]') as HTMLElement | null
    expect(panel).not.toBeNull()
    const saveButton = Array.from(document.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('保存设置'),
    )
    expect(saveButton).toBeTruthy()
    const position = saveButton!.compareDocumentPosition(panel!)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const text = panel?.textContent ?? ''
    expect(text).toContain('channel: stable')
    expect(text).toContain('gitBranch: main')
    expect(text).toContain('gitCommit: 1add25ec965ac1f7cd2fcd1993ee2507bd5855b7')
    expect(text).toContain('tree: clean')
    expect(text).toContain('buildTime: 2026-08-10T00:00:00.000Z')
    expect(text).toContain(`trackingId: ${'ab'.repeat(32)}`)
    expect(text).toContain('integrity digest, not a package authenticity signature')
    expect(text).not.toContain('development/unpackaged')

    const copyButton = Array.from(document.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('复制完整追踪'),
    )
    expect(copyButton).toBeTruthy()
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          writes.push(value)
        },
      },
    })
    copyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    await settle()
    expect(writes.length).toBe(1)
    expect(writes[0]).toContain('gitCommit: 1add25ec965ac1f7cd2fcd1993ee2507bd5855b7')
    expect(writes[0]).toContain('buildTime: 2026-08-10T00:00:00.000Z')
    expect(writes[0]).toContain(`trackingId: ${'ab'.repeat(32)}`)
    expect(writes[0]).toContain('integrity digest, not a package authenticity signature')
  })

  it('renders explicit development/unpackaged provenance without forged commit', async () => {
    await mountSettingsPage(fiveDatabases, {
      appMethods: {
        GetBuildTracking: async () => ({
          schema: 'milksu.build-tracking/v1',
          packaged: false,
          development: true,
          provenanceSource: 'development/unpackaged',
          channel: 'stable',
          productName: 'MilkSU',
          appId: 'com.milksu.app',
          gitBranch: 'development/unpackaged',
          gitCommit: '',
          dirty: false,
          sourceFingerprint: '',
          buildTime: '',
          trackingId: '',
          missing: true,
        }),
      },
    })
    const panel = document.querySelector('[data-testid="build-tracking"]')
    expect(panel).not.toBeNull()
    const text = panel?.textContent ?? ''
    expect(text).toContain('development/unpackaged')
    expect(text).toContain('gitCommit: (unavailable)')
    expect(text).toContain('trackingId: (unavailable)')
    expect(text).not.toMatch(/gitCommit: [0-9a-f]{40}/)
  })

  it('shows packaged/missing with empty branch fields, not development labels', async () => {
    await mountSettingsPage(fiveDatabases, {
      appMethods: {
        GetBuildTracking: async () => ({
          schema: 'milksu.build-tracking/v1',
          packaged: true,
          development: false,
          provenanceSource: 'packaged/missing',
          channel: 'stable',
          productName: 'MilkSU',
          appId: 'com.milksu.app',
          gitBranch: '',
          gitCommit: '',
          dirty: false,
          sourceFingerprint: '',
          buildTime: '',
          trackingId: '',
          missing: true,
        }),
      },
    })
    const text = document.querySelector('[data-testid="build-tracking"]')?.textContent ?? ''
    expect(text).toContain('provenanceSource: packaged/missing')
    expect(text).toContain('gitBranch: (unavailable)')
    expect(text).toContain('gitCommit: (unavailable)')
    expect(text).not.toContain('gitBranch: development/unpackaged')
  })
})

describe('SettingsPage user artifacts', () => {
  it('separates visible work products from internal app data', async () => {
    let revealed = false
    await mountSettingsPage(fiveDatabases, {
      appMethods: {
        RevealUserArtifactDirectory: async () => { revealed = true },
      },
    })

    const path = document.querySelector('[data-testid="user-artifact-directory"]')
    expect(path?.textContent).toContain('/Users/test/Documents/MilkSU')
    expect(document.body.textContent).toContain('Coding、CTF 和 CVE 生成的文件放在这里')
    expect(document.body.textContent).toContain('会话、凭据和运行日志仍保存在应用数据目录')

    const button = [...document.querySelectorAll('button')]
      .find(value => value.textContent?.includes('打开产物目录'))
    button?.click()
    await settle()
    expect(revealed).toBe(true)
  })
})

describe('SettingsPage Coding Agent Skills', () => {
  it('shows the reviewed catalog and persists disabled Skills without probing a model', async () => {
    let savedSettings: AppSettings | null = null
    const settings = withAppSettingsDefaults({
      active_provider: 'deepseek',
      active_model: 'deepseek-v4-flash',
      model_routing: {
        source_order: ['account', 'personal'],
        auto_fallback: true,
      },
      disabled_skills: ['product-design'],
      providers: {},
    })
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      initialCategory: 'coding',
      settings,
      appMethods: {
        SaveSettingsCmd: async (value: unknown) => {
          savedSettings = value as AppSettings
        },
        GetSettings: async () => savedSettings ?? settings,
      },
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('产品设计')
    expect(text).toContain('API 集成')
    expect(text).toContain('MilkSU 发布')

    const productDesign = document.querySelector('[aria-label="启用产品设计"]')
    const securityReview = document.querySelector('[aria-label="启用安全审查"]')
    expect(productDesign?.getAttribute('data-state')).toBe('unchecked')
    expect(securityReview?.getAttribute('data-state')).toBe('checked')
    securityReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    const saveButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存设置'))
    saveButton?.click()
    for (let index = 0; index < 4; index += 1) await settle()

    expect((savedSettings as AppSettings | null)?.disabled_skills).toEqual([
      'product-design',
      'review-security',
    ])
    expect(document.body.textContent).toContain('Skills 设置已保存')
  })
})

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
      initialCategory: 'browser',
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
    expect(text).toContain('打开辅助功能设置')

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

  it('keeps explicit Computer Use permission authorization available on unstable builds', async () => {
    const permissionRequests: string[] = []
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      initialCategory: 'browser',
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
        RequestCodingComputerUsePermissions: async (permission: unknown) => {
          permissionRequests.push(String(permission))
          return {
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
          } satisfies CodingComputerUseStatus
        },
      },
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('外部 App 权限')
    expect(text).toContain('打开辅助功能设置')
    expect(text).toContain('打开屏幕录制设置')
    expect(text).toContain('选择 /Applications/MilkSU.app')
    expect(text).toContain('当前构建身份：ad-hoc · Team 未设置')
    expect(text).toContain('Developer ID')
    expect(text).toContain('真实 TCC 探针')
    expect(text).not.toContain('先稳定签名再复检')

    const accessibility = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('打开辅助功能设置'))
    expect(accessibility?.disabled).toBe(false)
    accessibility?.click()
    for (let index = 0; index < 2; index += 1) await settle()
    const screenRecording = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('打开屏幕录制设置'))
    expect(screenRecording?.disabled).toBe(false)
    screenRecording?.click()
    for (let index = 0; index < 2; index += 1) await settle()
    expect(permissionRequests).toEqual(['accessibility', 'screen-recording'])
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

  it('uses the approved settings order and keeps account and CTF credentials in their own categories', async () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'grok-4.5',
      providers: {},
    } as AppSettings)
    const accountStatus: AccountStatus = {
      configured: true,
      authenticated: true,
      state: 'active',
      tokenFluxLinked: true,
      user: {
        githubLogin: 'milksuofficial',
        displayName: 'MilkSU',
        avatarUrl: '',
      },
    }
    await mountSettingsPage({ directory: 'MilkSU 用户数据目录', fileCount: 0, bytes: 0 }, {
      initialCategory: 'general',
      settings,
      accountStatus,
    })

    const labels = [...document.querySelectorAll<HTMLElement>('.settings-nav-item')]
      .map(item => item.textContent?.trim())
    expect(labels).toEqual(['通用', '模型', 'CTF', 'CVE', 'Coding', '浏览器控制', '安全工具'])
    expect(document.body.textContent).toContain('@milksuofficial · 内测用户')

    const ctfButton = [...document.querySelectorAll<HTMLButtonElement>('.settings-nav-item')]
      .find(item => item.textContent?.trim() === 'CTF')
    ctfButton?.click()
    await settle()
    expect(document.body.textContent).toContain('Arena Token')
    expect(document.body.textContent).not.toContain('@milksuofficial · 内测用户')
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
    expect(text).toContain('模型')
    expect(text).not.toContain('模型与额度')
    expect(text).toContain('默认模型')
    expect(text).toContain('模型服务')
    expect(text).toContain('TokenFlux 个人')
    expect(text).toContain('Grok 4.3')
    expect(text).toContain('Groq 官方')
    expect(text).not.toContain('视觉模型')
    expect(text).not.toContain('Arena Token')
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
    expect(persisted.model_routing).toEqual({
      source_order: ['account', 'personal'],
      auto_fallback: true,
    })
  })

  it('uses the same available provider groups as Coding and updates provider with the default model', async () => {
    let savedSettings: unknown = null
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'grok-4.3',
      providers: {
        deepseek: {
          api_key: '',
          has_api_key: true,
          enabled: true,
          base_url: 'https://api.deepseek.com',
        },
      },
    } as unknown as AppSettings)
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      initialCategory: 'apikeys',
      settings,
      appMethods: {
        SaveSettingsCmd: async (value: unknown) => {
          savedSettings = value
        },
        GetSettings: async () => savedSettings ?? settings,
        TestAgentModel: async () => ({
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          ready: true,
          latencyMs: 30,
        }),
      },
    })

    const trigger = document.querySelector<HTMLElement>('[aria-label="默认模型"]')
    expect(trigger).not.toBeNull()
    trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await settle()

    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.some(option => option.textContent?.includes('TokenFlux · Grok 4.5'))).toBe(true)
    const deepSeek = options.find(option => option.textContent?.includes('DeepSeek · deepseek-v4-pro'))
    expect(deepSeek).toBeDefined()
    deepSeek?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    await settle()

    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('保存并验证'))
    saveButton?.click()
    for (let index = 0; index < 6; index += 1) await settle()

    const persisted = savedSettings as AppSettings
    expect(persisted.active_provider).toBe('deepseek')
    expect(persisted.active_model).toBe('deepseek-v4-pro')
    expect(persisted.model_routing.source_order).toEqual(['account', 'personal'])
  })

  it('adds and verifies a simple custom OpenAI-compatible relay', async () => {
    let savedSettings: unknown = null
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'grok-4.5',
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
          provider: (savedSettings as AppSettings | null)?.active_provider,
          model: (savedSettings as AppSettings | null)?.active_model,
          ready: true,
          latencyMs: 37,
        }),
      },
    })

    const addRelay = document.querySelector<HTMLButtonElement>('button[aria-label="新增模型服务"]')
    addRelay?.click()
    await settle()

    function typeInto(input: HTMLInputElement | null, value: string) {
      expect(input).not.toBeNull()
      input!.value = value
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    }

    typeInto(document.querySelector('input[aria-label="中转站名称"]'), '我的 Grok 中转站')
    typeInto(document.querySelector('input[aria-label="自定义模型 ID"]'), 'x-ai/grok-4.6:fast')
    const addModel = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '添加')
    addModel?.click()
    await settle()
    typeInto(document.querySelector('input[type="url"]'), 'https://relay.example/v1')
    typeInto(document.querySelector('input[type="password"]'), 'custom-test-secret')

    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('保存并验证'))
    saveButton?.click()
    for (let index = 0; index < 6; index += 1) await settle()

    const persisted = savedSettings as AppSettings
    expect(persisted.active_provider).toMatch(/^custom-relay-/)
    expect(persisted.active_model).toBe('x-ai/grok-4.6:fast')
    const savedProvider = persisted.providers[persisted.active_provider]
    expect(savedProvider).toMatchObject({
      custom: true,
      name: '我的 Grok 中转站',
      base_url: 'https://relay.example/v1',
      models: ['x-ai/grok-4.6:fast'],
      api_key: 'custom-test-secret',
    })
    expect(document.body.textContent).toContain('已保存并验证')
  })

  it('edits a provider without silently replacing the default model service', async () => {
    let savedSettings: AppSettings | null = null
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'grok-4.5',
      providers: {},
    } as AppSettings)
    await mountSettingsPage({ directory: 'MilkSU 用户数据目录', fileCount: 0, bytes: 0 }, {
      initialCategory: 'apikeys',
      settings,
      appMethods: {
        SaveSettingsCmd: async (value: unknown) => {
          savedSettings = value as AppSettings
        },
        GetSettings: async () => savedSettings ?? settings,
        TestAgentModel: async () => ({
          provider: 'tokenflux',
          model: 'grok-4.5',
          ready: true,
          latencyMs: 30,
        }),
      },
    })

    const deepSeekRow = [...document.querySelectorAll<HTMLElement>('.model-service-row')]
      .find(row => row.textContent?.includes('DeepSeek 官方'))
    expect(deepSeekRow).toBeDefined()
    const edit = [...deepSeekRow!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '编辑')
    edit?.click()
    await settle()

    const dialog = document.querySelector<HTMLElement>('.provider-editor-dialog')
    expect(dialog?.textContent).toContain('编辑 DeepSeek 官方')
    const save = [...dialog!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '保存')
    save?.click()
    for (let index = 0; index < 6; index += 1) await settle()

    const persistedSettings = savedSettings as unknown as AppSettings
    expect(persistedSettings.active_provider).toBe('tokenflux')
    expect(persistedSettings.active_model).toBe('grok-4.5')
  })

  it('uses the signed-in account-assigned Key without exposing it and allows personal fallback order', async () => {
    let savedSettings: unknown = null
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'grok-4.5',
      model_routing: {
        source_order: ['account', 'personal'],
        auto_fallback: true,
      },
      relay: {
        enabled: true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: false,
      },
      providers: {
        tokenflux: {
          api_key: '',
          has_api_key: true,
          enabled: true,
          base_url: 'https://tokenflux.dev/v1',
        },
      },
    } as AppSettings)
    await mountSettingsPage({
      directory: 'MilkSU 用户数据目录',
      fileCount: 0,
      bytes: 0,
    }, {
      initialCategory: 'apikeys',
      settings,
      accountStatus: {
        configured: true,
        authenticated: true,
        state: 'active',
        tokenFluxLinked: true,
        user: {
          githubLogin: 'milksuofficial',
          displayName: 'MilkSU',
          avatarUrl: '',
        },
      },
      appMethods: {
        SaveSettingsCmd: async (value: unknown) => {
          savedSettings = value
        },
        GetSettings: async () => savedSettings ?? settings,
        TestAgentModel: async () => ({
          provider: 'tokenflux',
          model: 'grok-4.5',
          ready: true,
          latencyMs: 25,
        }),
      },
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('MilkSU 账户')
    expect(text).toContain('TokenFlux 个人')
    expect(text).toContain('已连接')
    expect(document.querySelector('input[aria-label="TokenFlux 团队 API Key"]')).toBeNull()

    const personalRow = [...document.querySelectorAll<HTMLElement>('.model-service-row')]
      .find(row => row.textContent?.includes('TokenFlux 个人'))
    const personalDefaultButton = [...(personalRow?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => button.textContent?.trim() === '备用')
    expect(personalDefaultButton).toBeDefined()
    personalDefaultButton?.click()
    await settle()

    const saveButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('保存并验证'))
    saveButton?.click()
    for (let index = 0; index < 6; index += 1) await settle()

    expect((savedSettings as AppSettings).model_routing.source_order)
      .toEqual(['personal', 'account'])
  })
})
