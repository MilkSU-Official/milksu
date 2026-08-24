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
    expect(host.textContent).toContain('新作业')
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

    const newJob = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('新作业'))
    newJob?.click()
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

    const newJob = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('新作业'))
    newJob?.click()
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

    const input = host.querySelector<HTMLInputElement>('[aria-label="编辑作业标题"]')
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

  it('exposes a practice-package catalog beside jobs', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage)
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.textContent).toContain('作业')
    expect(host.textContent).toContain('练习包')
    const packagesTab = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '练习包')
    packagesTab?.click()
    await nextTick()
    expect(host.textContent).toContain('类型')
    expect(host.textContent).toContain('说明')
  })

  it('starts InjuredAndroid with the challenge list and no Computer Use CTA', async () => {
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            ListLabPackages: () => [{
              id: 'android-lab',
              name: 'InjuredAndroid',
              kindLabel: '安卓题',
              detail: '本机 AVD · 12 道 Flag · 受限 adb',
              provider: 'android-avd',
              surface: 'emulator',
              address: 'emulator-5554',
              challenges: ['Flag 1 登录绕过', 'Flag 2 导出 Activity'],
              brief: 'InjuredAndroid（Apache-2.0）',
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
          },
        },
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage)
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    await Promise.resolve()
    await nextTick()

    const packagesTab = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '练习包')
    packagesTab?.click()
    await nextTick()
    expect(host.textContent).toContain('InjuredAndroid')
    expect(host.textContent).toContain('2 题')

    const start = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '启动')
    start?.click()
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(host.querySelector('[data-testid="lab-challenges"]')?.textContent).toContain('Flag 1 登录绕过')
    expect(host.textContent).not.toContain('Computer Use')
    expect(host.querySelector('[data-testid="attach-computer-use"]')).toBeNull()
  })
})
