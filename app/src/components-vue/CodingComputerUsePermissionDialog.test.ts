// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingComputerUsePermissionDialog from './CodingComputerUsePermissionDialog.vue'
import type {
  CodingComputerUsePermission,
  CodingComputerUseStatus,
} from '@/codingEnvironmentTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function computerUseStatus(
  permissions: CodingComputerUseStatus['permissions'] = {
    accessibility: false,
    screenRecording: false,
  },
): CodingComputerUseStatus {
  return {
    available: true,
    enabled: false,
    phase: 'disabled',
    permissions,
  }
}

async function mountDialog() {
  const requested: CodingComputerUsePermission[] = []
  const polling = vi.fn()
  const completed = vi.fn()
  const openUpdates = vi.fn()
  const props = reactive({
    open: true,
    status: computerUseStatus(),
    requesting: null as CodingComputerUsePermission | null,
  })
  const Root = defineComponent({
    setup() {
      return () => h(CodingComputerUsePermissionDialog, {
        ...props,
        pollIntervalMs: 1000,
        'onUpdate:open': openUpdates,
        onRequestPermissions: (permission: CodingComputerUsePermission) => requested.push(permission),
        onPoll: polling,
        onComplete: completed,
      })
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(Root)
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return {
    props,
    requested,
    polling,
    completed,
    openUpdates,
  }
}

describe('CodingComputerUsePermissionDialog', () => {
  it('shows both independent permissions together without a step-by-step wizard', async () => {
    vi.useFakeTimers()
    const { requested, polling } = await mountDialog()

    expect(document.body.textContent).toContain('开启 Computer Use')
    expect(document.body.textContent).toContain('辅助功能')
    expect(document.body.textContent).toContain('屏幕录制')
    expect(document.body.textContent).toContain('Computer Use 组件')
    expect(document.body.textContent).toContain('持续检测中')
    expect(document.body.textContent).toContain('0 / 2')
    expect(document.body.textContent).not.toContain('下一步')
    expect(polling).toHaveBeenCalledTimes(1)

    const accessibility = document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开辅助功能系统设置"]',
    )
    const screenRecording = document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开屏幕录制系统设置"]',
    )
    expect(accessibility?.disabled).toBe(false)
    expect(screenRecording?.disabled).toBe(false)

    accessibility?.click()
    screenRecording?.click()
    await nextTick()
    expect(requested).toEqual(['accessibility', 'screen-recording'])

    vi.advanceTimersByTime(2000)
    expect(polling).toHaveBeenCalledTimes(3)
  })

  it('updates live permission state and completes once both grants are detected', async () => {
    vi.useFakeTimers()
    const { props, completed } = await mountDialog()

    props.status = computerUseStatus({
      accessibility: true,
      screenRecording: false,
    })
    await nextTick()
    expect(document.body.textContent).toContain('1 / 2')
    expect(document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开辅助功能系统设置"]',
    )?.disabled).toBe(true)
    expect(completed).not.toHaveBeenCalled()

    props.status = computerUseStatus({
      accessibility: true,
      screenRecording: true,
    })
    await nextTick()
    expect(document.body.textContent).toContain('授权已完成')
    expect(document.body.textContent).toContain('2 / 2')
    expect(completed).toHaveBeenCalledOnce()

    props.status = computerUseStatus({
      accessibility: true,
      screenRecording: true,
    })
    await nextTick()
    expect(completed).toHaveBeenCalledOnce()
  })

  it('allows postponing without turning either permission into a prerequisite', async () => {
    vi.useFakeTimers()
    const { openUpdates } = await mountDialog()
    const postpone = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('稍后处理'))
    postpone?.click()
    await nextTick()
    expect(openUpdates).toHaveBeenCalledWith(false)
  })
})
