// @vitest-environment jsdom
// R4 交付 3：权限向导引导卡的三态呈现（CU v2 §3.8）。audit D6 的实况：用户已在系统
// 设置授权，但 TCC 没注册上，向导只会永远说「待授权/持续检测中」——读者无从自救。
// 现在未授权态给「我已在系统设置开启，但仍未生效」的问答入口，确认后给手动添加指引。
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CodingComputerUsePermissionDialog from '@/components/CodingComputerUsePermissionDialog'
import type { CodingComputerUseStatus } from '@/codingEnvironmentTypes'

const ungrantedStatus: CodingComputerUseStatus = {
  available: true,
  enabled: false,
  phase: 'disabled',
  permissions: { accessibility: false, screenRecording: false },
  signing: { bundleId: 'com.milksu.app', signature: 'adhoc', teamIdentifier: 'not set', stableIdentity: false },
}

async function setLocale(value: 'zh' | 'en') {
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale(value)
}

function renderDialog(status: CodingComputerUseStatus = ungrantedStatus) {
  return render(
    <CodingComputerUsePermissionDialog
      open
      status={status}
      onRequestPermissions={() => undefined}
      onPoll={() => undefined}
      onComplete={() => undefined}
    />,
  )
}

describe('CodingComputerUsePermissionDialog 三态引导', () => {
  beforeEach(async () => {
    await setLocale('zh')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('① 未授权：待授权 + 问答入口；不出漂移指引', () => {
    renderDialog()
    expect(screen.getAllByText('待授权').length).toBeGreaterThan(0)
    expect(screen.getAllByText('我已在系统设置开启，但仍未生效').length).toBe(2)
    expect(screen.queryByTestId('permission-drift-screen-recording')).toBeNull()
  })

  it('② 用户确认「已开启仍未生效」⇒ 疑似未注册 + 手动添加指引（含签名身份对号入座）', () => {
    renderDialog()
    // 问答只确认屏幕录制那一项（D6 的实测场景）。
    fireEvent.click(screen.getAllByText('我已在系统设置开启，但仍未生效')[1])
    const driftCard = screen.getByTestId('permission-drift-screen-recording')
    expect(driftCard.textContent).toContain('仍未生效')
    expect(driftCard.textContent).toContain('临时签名')
    expect(driftCard.textContent).toContain('手动添加 MilkSU')
    expect(driftCard.textContent).toContain('com.milksu.app')
    expect(driftCard.textContent).toContain('重启 MilkSU')
    expect(screen.getByText('疑似未注册')).not.toBeNull()
    // 辅助功能那项没确认 ⇒ 不出漂移指引。
    expect(screen.queryByTestId('permission-drift-accessibility')).toBeNull()
  })

  it('② 时间侧兜底：打开设置后等待 90s 仍未生效 ⇒ 自动进入漂移指引', () => {
    const view = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '打开屏幕录制系统设置' }))
    expect(screen.queryByTestId('permission-drift-screen-recording')).toBeNull()
    // 轮询周期内界面会重渲染；这里直接推时间到阈值之后。
    vi.setSystemTime(new Date('2026-10-12T12:02:00Z'))
    // 同实例重渲染一帧（真实场景由 1.2s 轮询驱动）。不能用 cleanup+重挂——
    // settingsOpenedAt 是组件内 state，重挂即清零，90s 兜底永远判不出来。
    view.rerender(
      <CodingComputerUsePermissionDialog
        open
        status={ungrantedStatus}
        onRequestPermissions={() => undefined}
        onPoll={() => undefined}
        onComplete={() => undefined}
      />,
    )
    expect(screen.getByTestId('permission-drift-screen-recording')).not.toBeNull()
  })

  it('③ 已生效：不打扰（不出现问答入口与漂移指引），自动继续任务', () => {
    const onComplete = vi.fn()
    render(
      <CodingComputerUsePermissionDialog
        open
        status={{ ...ungrantedStatus, permissions: { accessibility: true, screenRecording: true } }}
        onRequestPermissions={() => undefined}
        onPoll={() => undefined}
        onComplete={onComplete}
      />,
    )
    expect(screen.queryByText('我已在系统设置开启，但仍未生效')).toBeNull()
    expect(screen.queryByTestId('permission-drift-screen-recording')).toBeNull()
    expect(screen.getByText('授权完成，正在恢复当前任务。')).not.toBeNull()
  })

  it('Linux 桌面共享场景：不提供 macOS 的手动添加问答与漂移指引', () => {
    renderDialog({
      ...ungrantedStatus,
      signing: { bundleId: '', signature: 'linux-portal', teamIdentifier: '', stableIdentity: true },
    })
    expect(screen.queryByText('我已在系统设置开启，但仍未生效')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开屏幕录制系统设置' }))
    vi.setSystemTime(new Date('2026-10-12T12:05:00Z'))
    cleanup()
    renderDialog({
      ...ungrantedStatus,
      signing: { bundleId: '', signature: 'linux-portal', teamIdentifier: '', stableIdentity: true },
    })
    expect(screen.queryByTestId('permission-drift-screen-recording')).toBeNull()
  })
})
