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
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
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
    expect(text).toContain('可启动')
    expect(text).toContain('权限与窗口已就绪')
    expect(text).toContain('可启动可见会话')
    expect(text).toContain('最近操作')
    expect(text).not.toContain('暂无操作记录')
    expect(text).toContain('Go / 替我审批')
    expect(text).toContain('普通操作自动执行')
    expect(text).not.toContain('此窗口会成为当前任务唯一的 Computer Use Scope')
    expect(text).toContain('com.openai.codex')
    expect(text).toContain('PID 4242')
    expect(text).toContain('Window 9001')
    expect(text).toContain('已暂停的目标')
    expect(text).not.toContain('当前 MilkSU App')
    const details = host.querySelector<HTMLDetailsElement>('details[aria-label="Computer Use 运行详情"], details')
    expect(details?.open).toBe(false)
    expect(host.querySelectorAll('button[aria-label="执行 Computer Use 下一步"]')).toHaveLength(1)

    const start = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('启动可见会话'),
    )
    expect(start?.disabled).toBe(false)
    start?.click()
    await nextTick()
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('does not show the default MilkSU target as a locked scope before the session starts', async () => {
    const { host } = await mountPanel({
      status: status({
        target: {
          name: 'MilkSU',
          bundleId: 'com.milksu.app',
          pid: 1111,
          windowId: 2222,
          windowTitle: 'Window',
        },
        permissions: {
          accessibility: false,
          screenRecording: false,
        },
      }),
      selectedTargetKey: '5252:9002',
    })
    const text = host.textContent ?? ''

    expect(text).toContain('缺系统权限')
    expect(text).toContain('Preview')
    expect(text).toContain('com.example.preview')
    expect(text).toContain('PID 5252')
    expect(text).toContain('Window 9002')
    expect(text).not.toContain('com.milksu.app · PID 1111')
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

  it('distinguishes ready-to-start from missing target selection', async () => {
    const { host } = await mountPanel({
      status: status({ target: undefined }),
      targets: [],
      selectedTargetKey: '',
    })
    const text = host.textContent ?? ''

    expect(text).toContain('待选择窗口')
    expect(text).toContain('没有可选窗口')
    expect(text).toContain('重新检测可见窗口')
    expect(text).not.toContain('未接入')
    const primary = host.querySelector<HTMLButtonElement>('button[aria-label="执行 Computer Use 下一步"]')
    expect(primary?.textContent).toContain('重新检测可见窗口')
    expect(primary?.disabled).toBe(false)
    expect(host.textContent).not.toContain('启动可见会话')
  })

  it('keeps start disabled when another task owns the visible Computer Use session', async () => {
    const { host, onStart } = await mountPanel({
      status: status({
        conversationId: 'other-conversation',
        enabled: true,
      }),
    })

    expect(host.textContent).toContain('可见会话正由另一个任务使用')
    const primary = host.querySelector<HTMLButtonElement>('button[aria-label="执行 Computer Use 下一步"]')
    expect(primary?.textContent).toContain('等待其他任务释放')
    expect(primary?.disabled).toBe(true)
    primary?.click()
    await nextTick()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('explains the current approval mode after Computer Use is locked to this task', async () => {
    const { host } = await mountPanel({
      status: status({
        conversationId: 'current-conversation',
        enabled: true,
      }),
      ownedByCurrentTask: true,
      approvalPolicy: 'full-auto',
    })
    const text = host.textContent ?? ''

    expect(text).toContain('已接入当前任务')
    expect(text).toContain('Go / 完全访问')
    expect(text).toContain('普通操作自动执行')
    expect(text).toContain('越界仍会停下')
    expect(text).not.toContain('正式接入/验收需要')
  })

  it('blocks Computer Use when the active session belongs to a browser scope', async () => {
    const { host, onStop } = await mountPanel({
      status: status({
        conversationId: 'current-conversation',
        enabled: true,
      }),
      ownedByCurrentTask: true,
      activeTargetMatchesScope: false,
    })
    const text = host.textContent ?? ''

    expect(text).toContain('已接入其他 Scope')
    expect(text).toContain('请停止后重选')
    expect(text).not.toContain('已接入当前任务')
    const stop = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('停止当前其他 Scope'),
    )
    expect(stop?.disabled).toBe(false)
    stop?.click()
    await nextTick()
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('shows matching Computer Use operation evidence as real external app validation', async () => {
    const { host } = await mountPanel({
      status: status({
        conversationId: 'current-conversation',
        enabled: true,
        target: targets[1],
      }),
      selectedTargetKey: '5252:9002',
      ownedByCurrentTask: true,
      operationEvidence: {
        action: 'click',
        targetName: 'Preview',
        bundleId: 'com.example.preview',
        pid: 5252,
        windowId: 9002,
        windowTitle: '视觉回归',
        durationMs: 54,
        summary: 'click · Preview · com.example.preview · PID 5252 · Window 9002 · 视觉回归',
      },
    })
    const text = host.textContent ?? ''

    expect(text).toContain('最近操作')
    expect(text).toContain('click · Preview · com.example.preview · PID 5252 · Window 9002 · 视觉回归')
    expect(text).toContain('已记录真实操作')
    expect(text).toContain('已记录')
    expect(text).not.toContain('等待真实操作')
    expect(text).not.toContain('正式接入/验收需要')
  })

  it('does not count Computer Use operation evidence from a different window scope', async () => {
    const { host } = await mountPanel({
      status: status({
        conversationId: 'current-conversation',
        enabled: true,
        target: targets[0],
      }),
      ownedByCurrentTask: true,
      operationEvidence: {
        action: 'click',
        targetName: 'Preview',
        bundleId: 'com.example.preview',
        pid: 5252,
        windowId: 9002,
        windowTitle: '视觉回归',
        durationMs: 54,
        summary: 'click · Preview · com.example.preview · PID 5252 · Window 9002 · 视觉回归',
      },
    })
    const text = host.textContent ?? ''

    expect(text).toContain('最近操作来自其他窗口')
    expect(text).toContain('不匹配')
    expect(text).not.toContain('已记录真实操作')
    expect(text).not.toContain('正式接入/验收需要')
  })

  it('keeps Plan or read-only visible sessions non-operating', async () => {
    const { host } = await mountPanel({
      status: status({
        conversationId: 'current-conversation',
        enabled: true,
      }),
      ownedByCurrentTask: true,
      executionMode: 'plan',
      approvalPolicy: 'workspace-auto',
    })
    const text = host.textContent ?? ''

    expect(text).toContain('Plan / 替我审批')
    expect(text).toContain('当前模式不能操作外部 App')
    expect(text).not.toContain('正式接入/验收需要')
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
    expect(missing.host.textContent).toContain('缺系统权限')
    expect(missing.host.textContent).toContain('辅助功能设置')
    expect(missing.host.textContent).toContain('屏幕录制设置')
    expect(missing.host.textContent).toContain('重新检测')
    const missingStart = [...missing.host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('启动可见会话'),
    )
    expect(missingStart).toBeUndefined()
    const request = [...missing.host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.getAttribute('aria-label') === '打开辅助功能设置',
    )
    expect(request?.disabled).toBe(false)
    request?.click()
    await nextTick()
    expect(missing.onRequestPermissions).toHaveBeenCalledWith('accessibility')

    const permissionBadge = [...missing.host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.getAttribute('aria-label') === '请求辅助功能权限',
    )
    expect(permissionBadge?.disabled).toBe(false)
    permissionBadge?.click()
    await nextTick()
    expect(missing.onRequestPermissions).toHaveBeenNthCalledWith(2, 'accessibility')

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
    expect(unavailable.host.textContent).toContain('重新检测 Computer Use')
    const unavailableRequest = unavailable.host.querySelector<HTMLButtonElement>('[aria-label="打开辅助功能设置"]')
    expect(unavailableRequest).toBeNull()
    expect(unavailable.onRequestPermissions).not.toHaveBeenCalled()
  })

  it('shows signing diagnostics when macOS permission probes disagree with Settings', async () => {
    const { host } = await mountPanel({
      status: status({
        permissions: {
          accessibility: false,
          screenRecording: true,
        },
        signing: {
          bundleId: 'com.milksu.app',
          executablePath: '/Applications/MilkSU.app',
          signature: 'adhoc',
          teamIdentifier: 'not set',
          stableIdentity: false,
          problem: '当前构建不是稳定 Developer ID 签名；系统设置里显示已勾选时，TCC 探针仍可能对当前二进制返回未授权。',
        },
      }),
    })
    const text = host.textContent ?? ''

    expect(text).toContain('当前构建身份：ad-hoc · Team 未设置')
    expect(text).toContain('Developer ID')
    expect(text).toContain('TCC 探针')
    expect(text).toContain('系统设置里显示已勾选')
  })

  it('keeps explicit permission authorization available on unstable ad-hoc builds without inventing grants', async () => {
    const { host, onRefresh, onRequestPermissions, onStart } = await mountPanel({
      status: status({
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
      }),
    })
    const text = host.textContent ?? ''

    // Unstable signing must remain visible, but must not stage-lock pre-release self-bootstrap.
    expect(text).toContain('当前构建身份：ad-hoc · Team 未设置')
    expect(text).toContain('辅助功能设置')
    expect(text).toContain('屏幕录制设置')
    expect(text).toContain('重新检测')
    expect(text).toContain('授权后请重新检测')
    expect(text).not.toContain('待稳定签名复检')
    expect(text).not.toContain('先稳定签名再复检')

    const primary = host.querySelector<HTMLButtonElement>('button[aria-label="执行 Computer Use 下一步"]')
    expect(primary?.textContent).toContain('重新检测授权')
    expect(primary?.disabled).toBe(false)
    const accessibility = host.querySelector<HTMLButtonElement>('[aria-label="打开辅助功能设置"]')
    const screenRecording = host.querySelector<HTMLButtonElement>('[aria-label="打开屏幕录制设置"]')
    accessibility?.click()
    screenRecording?.click()
    await nextTick()
    expect(onRequestPermissions).toHaveBeenNthCalledWith(1, 'accessibility')
    expect(onRequestPermissions).toHaveBeenNthCalledWith(2, 'screen-recording')
    expect(onStart).not.toHaveBeenCalled()

    const start = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('启动可见会话'),
    )
    expect(start).toBeUndefined()
    await nextTick()
    expect(onStart).not.toHaveBeenCalled()

    // Secondary refresh remains available after the user returns from System Settings.
    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('重新检测'),
    )
    refresh?.click()
    await nextTick()
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
