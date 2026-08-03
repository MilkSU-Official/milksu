// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingComputerUsePanel from './CodingComputerUsePanel.vue'
import type {
  CodingComputerUseStatus,
  CodingComputerUseTarget,
} from '@/codingEnvironmentTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

const targets: CodingComputerUseTarget[] = [
  {
    name: 'Codex',
    bundleId: 'com.openai.codex',
    pid: 4242,
    windowId: 9001,
    windowTitle: '已暂停的目标',
  },
  {
    name: 'Preview',
    bundleId: 'com.example.preview',
    pid: 5252,
    windowId: 9002,
    windowTitle: '视觉回归',
  },
]

function status(overrides: Partial<CodingComputerUseStatus> = {}): CodingComputerUseStatus {
  return {
    available: true,
    enabled: false,
    phase: 'disabled',
    target: targets[0],
    permissions: {
      accessibility: true,
      screenRecording: true,
    },
    ...overrides,
  }
}

async function mountPanel(props: Partial<InstanceType<typeof CodingComputerUsePanel>['$props']> = {}) {
  const onStart = vi.fn()
  const onStop = vi.fn()
  const onRequestPermissions = vi.fn()
  const onRefresh = vi.fn()
  const onUpdateSelectedTargetKey = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingComputerUsePanel, {
    status: status(),
    targets,
    selectedTargetKey: '4242:9001',
    loading: false,
    running: false,
    ownedByCurrentTask: false,
    onStart,
    onStop,
    onRequestPermissions,
    onRefresh,
    'onUpdate:selectedTargetKey': onUpdateSelectedTargetKey,
    ...props,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return {
    host,
    onStart,
    onStop,
    onRequestPermissions,
    onRefresh,
    onUpdateSelectedTargetKey,
  }
}

describe('CodingComputerUsePanel', () => {
  it('shows the selected external app/window scope and starts only after permissions are ready', async () => {
    const { host, onStart } = await mountPanel()
    const text = host.textContent ?? ''

    expect(text).toContain('Codex')
    expect(text).toContain('未接入')
    expect(text).toContain('权限和窗口都已就绪')
    expect(text).toContain('才算正式接入当前 Coding 任务')
    expect(text).toContain('com.openai.codex')
    expect(text).toContain('PID 4242')
    expect(text).toContain('Window 9001')
    expect(text).toContain('已暂停的目标')
    expect(text).not.toContain('当前 MilkSU App')

    const start = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('启动可见会话'),
    )
    expect(start?.disabled).toBe(false)
    start?.click()
    await nextTick()
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('lets users refresh detection when Computer Use is not connected yet', async () => {
    const { host, onRefresh } = await mountPanel()
    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('重新检测'),
    )

    expect(refresh?.disabled).toBe(false)
    refresh?.click()
    await nextTick()
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('keeps start disabled when another task owns the visible Computer Use session', async () => {
    const { host, onStart } = await mountPanel({
      status: status({
        conversationId: 'other-conversation',
        enabled: true,
      }),
    })

    expect(host.textContent).toContain('可见会话正由另一个 Coding 任务使用')
    expect(host.textContent).toContain('其他任务正在使用')
    const start = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('启动可见会话'),
    )
    expect(start?.disabled).toBe(true)
    start?.click()
    await nextTick()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('distinguishes missing macOS permissions from unavailable Computer Use', async () => {
    const missing = await mountPanel({
      status: status({
        permissions: {
          accessibility: false,
          screenRecording: true,
        },
      }),
    })

    expect(missing.host.textContent).toContain('辅助功能 未授权')
    expect(missing.host.textContent).toContain('App 管理')
    expect(missing.host.textContent).toContain('勾选 MilkSU')
    expect(missing.host.textContent).toContain('重新检测')
    const missingStart = [...missing.host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('启动可见会话'),
    )
    expect(missingStart?.disabled).toBe(true)
    const request = [...missing.host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('请求系统权限'),
    )
    expect(request?.disabled).toBe(false)
    request?.click()
    await nextTick()
    expect(missing.onRequestPermissions).toHaveBeenCalledOnce()

    const unavailable = await mountPanel({
      status: status({
        available: false,
        problem: 'Computer Use 当前仅支持 macOS。',
        permissions: {
          accessibility: false,
          screenRecording: false,
        },
      }),
    })
    expect(unavailable.host.textContent).toContain('Computer Use 当前仅支持 macOS。')
    const unavailableRequest = [...unavailable.host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('请求系统权限'),
    )
    expect(unavailableRequest?.disabled).toBe(true)
    unavailableRequest?.click()
    await nextTick()
    expect(unavailable.onRequestPermissions).not.toHaveBeenCalled()
  })
})
