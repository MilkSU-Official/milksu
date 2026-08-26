// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetLabJobsForTests } from '@/composables/useLabJobs'
import LabPage from './LabPage.vue'

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

const mountedApps: App[] = []
const storage = new Map<string, string>()

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  configurable: true,
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  storage.clear()
  resetLabJobsForTests()
})

describe('LabPage', () => {
  it('uses the laboratory name and a new-job entry without authorization copy', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage)
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.textContent).toContain('实验室')
    expect(host.textContent).toContain('自定义任务')
    expect(host.querySelector('[aria-label="题目包"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="workspace-create"]')?.textContent).toContain('创建')
    expect(host.querySelector('[data-testid="workspace-history"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="workspace-import"]')).toBeNull()
    expect(host.textContent).not.toContain('导入')
    expect(host.textContent).not.toContain('自带靶')
    expect(host.textContent).not.toContain('授权测试')
    expect(host.textContent).not.toContain('授权靶')
  })

  it('starts a local job from a request instead of protocol and address fields', async () => {
    const runs: unknown[][] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage, {
      onRun: (...args: unknown[]) => runs.push(args),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    host.querySelector<HTMLButtonElement>('[data-testid="workspace-create"]')?.click()
    await nextTick()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.querySelector('[aria-label="地址"]')).toBeNull()
    expect(dialog!.querySelector('[aria-label="范围"]')).not.toBeNull()
    const request = dialog!.querySelector<HTMLTextAreaElement>('[aria-label="要求"]')!
    request.value = '扫一下本机进程'
    request.dispatchEvent(new Event('input', { bubbles: true }))
    dialog!.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(runs).toHaveLength(1)
    expect((runs[0][0] as { scope: string; request: string }).scope).toBe('local')
    expect((runs[0][0] as { request: string }).request).toBe('扫一下本机进程')
    expect(host.textContent).toContain('扫一下本机进程')
    expect(host.textContent).toContain('本地')
    expect(host.querySelector('[data-testid="environment-strip"]')?.textContent).toContain('用户自带靶')
    expect(host.querySelector('[data-testid="research-report"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="conversation-dock"]')).not.toBeNull()
  })

  it('renames a lab job from the list without a separate backend tool', async () => {
    const renamed: unknown[][] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage, {
      onRename: (...args: unknown[]) => renamed.push(args),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    host.querySelector<HTMLButtonElement>('[data-testid="workspace-create"]')?.click()
    await nextTick()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const request = dialog.querySelector<HTMLTextAreaElement>('[aria-label="要求"]')!
    request.value = '测试'
    request.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()

    const back = host.querySelector<HTMLButtonElement>('[aria-label="返回实验室"]')
    back?.click()
    await nextTick()

    const title = host.querySelector<HTMLElement>('[data-testid="lab-job-title"]')
    expect(title?.textContent).toContain('测试')
    title?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await nextTick()

    const input = host.querySelector<HTMLInputElement>('[aria-label="编辑任务标题"]')
    expect(input).not.toBeNull()
    input!.value = '本地进程反病毒测试'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input!.dispatchEvent(new Event('blur', { bubbles: true }))
    await nextTick()

    expect(renamed).toEqual([[expect.any(String), '本地进程反病毒测试']])
    expect(host.textContent).toContain('本地进程反病毒测试')
    expect(host.textContent).not.toContain('复现成功')
    expect(host.textContent).not.toContain('HTTP')
  })

  it('lands on challenge-pack cards and keeps jobs as a resume list', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage)
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.querySelector('[aria-label="题目包"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="自定义任务"]')).toBeNull()
    const jobsTab = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '自定义任务')
    jobsTab?.click()
    await nextTick()
    expect(host.querySelector('[aria-label="自定义任务"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="workspace-create"]')).not.toBeNull()
    expect(host.textContent).toContain('还没有自定义任务')
  })

  it('groups package cards by connectivity, web, linux, and android', async () => {
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            ListLabPackages: () => [
              {
                id: 'juice-shop',
                name: 'OWASP Juice Shop',
                category: 'web',
                kindLabel: 'Web',
                detail: '一家店',
                difficulty: '入门',
                purpose: '练 Web',
                provider: 'docker',
                surface: 'browser',
                address: '127.0.0.1:3000',
              },
              {
                id: 'whoami',
                name: 'Whoami HTTP',
                category: 'probe',
                kindLabel: '连通性',
                detail: '探活',
                difficulty: '探活',
                purpose: '确认本机靶能通',
                provider: 'docker',
                surface: 'shell',
                address: '127.0.0.1:18080',
              },
              {
                id: 'android-lab',
                name: 'InjuredAndroid',
                category: 'android',
                kindLabel: '安卓',
                detail: '一台模拟器',
                difficulty: '初中级',
                purpose: '12 面 Flag',
                provider: 'android-avd',
                surface: 'emulator',
                address: 'emulator-5554',
              },
              {
                id: 'struts2-s2-045',
                name: 'Struts2 S2-045',
                category: 'cve',
                kindLabel: 'CVE',
                detail: '公开复现',
                difficulty: '初中级',
                purpose: 'S2-045',
                provider: 'docker',
                surface: 'browser',
                address: '127.0.0.1:18045',
              },
            ],
            GetEnvLease: () => ({ ownerKind: 'lab', ownerId: '', provider: 'none', state: 'none' }),
            ListEnvLeases: () => [],
          },
        },
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage)
    app.mount(host)
    mountedApps.push(app)
    for (let i = 0; i < 8 && host.querySelectorAll('[data-testid="lab-pack-group"]').length < 4; i++) {
      await Promise.resolve()
      await nextTick()
    }
    const groups = [...host.querySelectorAll('[data-testid="lab-pack-group"]')]
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['连通性', 'Web', '安卓', 'CVE'])
    expect(groups[0]?.textContent).toContain('Whoami HTTP')
    expect(groups[1]?.textContent).toContain('OWASP Juice Shop')
    expect(groups[2]?.textContent).toContain('InjuredAndroid')
    expect(groups[3]?.textContent).toContain('Struts2 S2-045')
    expect(host.querySelectorAll('[data-testid="lab-pack-card"]').length).toBe(4)
  })

  it('opens an InjuredAndroid target card with guidance and no Computer Use CTA', async () => {
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            ListLabPackages: () => [{
              id: 'android-lab',
              name: 'InjuredAndroid',
              kindLabel: '安卓',
              detail: '一台模拟器 · 12 面 Flag',
              source: 'B3nac InjuredAndroid（Apache-2.0）',
              purpose: '练安卓组件、存储、Deep Link 等 12 面 Flag',
              difficulty: '初中级',
              provider: 'android-avd',
              surface: 'emulator',
              address: 'emulator-5554',
              challenges: [
                { id: 'flag-1', title: '登录绕过', kind: '认证', guidance: '看登录页怎么判成功。' },
                { id: 'flag-2', title: '导出 Activity', kind: '导出组件', guidance: '用 am start 打开未露出的 Activity。' },
              ],
              brief: 'InjuredAndroid 是一台模拟器上的练习 App，不是 12 台设备。',
            }],
            GetEnvLease: () => ({
              ownerKind: 'lab',
              ownerId: 'job-1',
              provider: 'android-avd',
              state: 'none',
              packageName: 'InjuredAndroid',
            }),
            StartEnvLease: () => ({
              ownerKind: 'lab',
              ownerId: 'job-1',
              packageId: 'android-lab',
              packageName: 'InjuredAndroid',
              provider: 'android-avd',
              surface: 'emulator',
              state: 'ready',
              address: 'emulator-5554',
            }),
            ListEnvLeases: () => [],
          },
        },
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const expanded: unknown[][] = []
    const app = createApp(LabPage, {
      onExpand: (...args: unknown[]) => expanded.push(args),
    })
    app.mount(host)
    mountedApps.push(app)
    for (let i = 0; i < 8 && !host.textContent?.includes('InjuredAndroid'); i++) {
      await Promise.resolve()
      await nextTick()
    }

    expect(host.textContent).toContain('InjuredAndroid')
    expect(host.textContent).toContain('初中级')
    expect(host.textContent).toContain('12 面 Flag')

    host.querySelector<HTMLButtonElement>('[data-testid="lab-pack-card"]')?.click()
    await nextTick()
    const intro = host.querySelector('[data-testid="lab-pack-intro"]')?.textContent ?? ''
    expect(intro).toContain('B3nac InjuredAndroid')
    expect(intro).toContain('初中级')
    expect(intro).toContain('不是 12 台设备')
    expect(host.querySelectorAll('[data-testid="lab-machine-card"]').length).toBe(1)
    expect(host.querySelectorAll('[data-testid="lab-flag-row"]').length).toBe(2)
    expect(host.textContent).toContain('看登录页怎么判成功。')

    host.querySelector<HTMLButtonElement>('[data-testid="lab-flag-row"] button')?.click()
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(host.querySelector('[data-testid="lab-challenges"]')?.textContent).toContain('看登录页怎么判成功。')
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '最大化对话')).toBe(true)
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '开始' && button.closest('[role="dialog"]') == null)).toBe(false)
    ;[...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '最大化对话')?.click()
    await nextTick()
    expect(expanded).toHaveLength(1)
    expect(host.querySelector('[data-testid="conversation-dock"]')?.className).not.toContain('is-column')
    expect(host.querySelector('[aria-label="最大化对话"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="左上角缩放"]')).not.toBeNull()
    for (let i = 0; i < 12 && !host.querySelector('[data-testid="target-surface"]'); i++) {
      await Promise.resolve()
      await nextTick()
    }
    if (host.querySelector('[data-testid="target-surface"]')) {
      expect(host.querySelector('[data-testid="dossier-split"]')).not.toBeNull()
      expect(host.querySelector('[aria-label="调节题面宽度"]')).not.toBeNull()
    }
    const flagRows = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="lab-flag-row"] button')]
    flagRows[1]?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="lab-challenges"]')?.textContent).toContain('用 am start 打开未露出的 Activity。')

    host.querySelector<HTMLButtonElement>('[aria-label="返回实验室"]')?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="lab-pack-intro"]')).not.toBeNull()
    host.querySelectorAll<HTMLButtonElement>('[data-testid="lab-flag-row"] button')[1]?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[aria-label="返回实验室"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[aria-label="返回题目包"]')?.click()
    await nextTick()
    ;[...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '自定义任务')?.click()
    await nextTick()
    expect(host.querySelectorAll('[data-testid="catalog-row"]').length).toBe(0)
    expect(host.textContent).not.toContain('Computer Use')
    expect(host.querySelector('[data-testid="attach-computer-use"]')).toBeNull()
  })
})
