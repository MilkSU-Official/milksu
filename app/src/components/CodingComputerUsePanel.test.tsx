// @vitest-environment jsdom
// R4 交付 2：控窗面板的「解除锁定 / 切换目标」入口（CU v2 §3.1-2，audit D3——锁错目标
// 38 分钟无解锁入口）。锁定态主按钮必须是解锁，且**回合进行中也可点**（死锁场景恰恰
// 发生在回合挂着的时候）；解锁成功后（status 回未锁态）面板回到「启动可见会话」。
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CodingComputerUsePanel from '@/components/CodingComputerUsePanel'
import { computerUseTargetKey } from '@/lib/codingPolicy'
import type { CodingComputerUseStatus } from '@/codingEnvironmentTypes'

const target = {
  name: 'TextEdit',
  bundleId: 'com.apple.TextEdit',
  pid: 4321,
  windowId: 9012,
  windowTitle: 'Untitled.txt',
}

const baseStatus: CodingComputerUseStatus = {
  available: true,
  enabled: true,
  authorized: true,
  conversationId: 'conversation-1',
  sessionId: 'cu-session-1',
  phase: 'ready',
  target,
  permissions: { accessibility: true, screenRecording: true },
}

const unlockedStatus: CodingComputerUseStatus = {
  ...baseStatus,
  enabled: false,
  authorized: false,
  conversationId: undefined,
  sessionId: undefined,
  phase: 'stopped',
  target: undefined,
}

async function setLocale(value: 'zh' | 'en') {
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale(value)
}

describe('CodingComputerUsePanel 解除锁定入口', () => {
  beforeEach(async () => {
    await setLocale('zh')
  })

  afterEach(cleanup)

  function renderPanel(props: Partial<Parameters<typeof CodingComputerUsePanel>[0]> = {}) {
    const onStop = vi.fn()
    const utils = render(
      <CodingComputerUsePanel
        standalone
        status={baseStatus}
        targets={[target]}
        selectedTargetKey=""
        loading={false}
        running={false}
        ownedByCurrentTask
        executionMode="go"
        approvalPolicy="ask"
        onStop={onStop}
        {...props}
      />,
    )
    return { ...utils, onStop }
  }

  /** 主操作按钮（锁定态=解除锁定，未锁态=启动）。aria-label 是通用的「执行下一步」。 */
  function primaryButton() {
    return screen.getByRole('button', { name: '执行 Computer Use 下一步' }) as HTMLButtonElement
  }

  it('锁定态主入口是「解除锁定 / 切换目标」，并说明回合会被中断', () => {
    renderPanel()
    const button = primaryButton()
    expect(button.textContent).toContain('解除锁定 / 切换目标')
    expect(screen.getByText(/已锁定 TextEdit/)).not.toBeNull()
    expect(screen.getByText(/中断正在运行的回合/)).not.toBeNull()
  })

  it('回合进行中仍可点（audit D3 的死锁逃生口：disabled 只看 loading）', () => {
    const { onStop } = renderPanel({ running: true })
    const button = primaryButton()
    expect(button.textContent).toContain('解除锁定 / 切换目标')
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('loading 时禁用（防连点）', () => {
    const { onStop } = renderPanel({ loading: true })
    const button = primaryButton()
    expect(button.textContent).toContain('解除锁定 / 切换目标')
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onStop).not.toHaveBeenCalled()
  })

  it('解锁成功（status 回未锁态）⇒ 面板回到「启动可见会话」', () => {
    const { rerender } = renderPanel()
    expect(primaryButton().textContent).toContain('解除锁定 / 切换目标')
    rerender(
      <CodingComputerUsePanel
        standalone
        status={unlockedStatus}
        targets={[target]}
        selectedTargetKey={computerUseTargetKey(target)}
        loading={false}
        running={false}
        ownedByCurrentTask={false}
        executionMode="go"
        approvalPolicy="ask"
      />,
    )
    expect(primaryButton().textContent).toContain('启动可见会话')
  })

  it('非本任务的锁不显示解锁入口（单机独占语义保留：等待其他任务释放）', () => {
    renderPanel({ ownedByCurrentTask: false, running: false })
    expect(screen.queryByText('解除锁定 / 切换目标')).toBeNull()
    expect(screen.getByText('其他任务正在使用')).not.toBeNull()
  })
})
