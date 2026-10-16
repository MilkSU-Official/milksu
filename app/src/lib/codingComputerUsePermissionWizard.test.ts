// R4 交付 3：Computer Use 权限向导三态判别（CU v2 §3.8，audit D6——用户已授权但 TCC
// 没注册上，驱动守卫分不清「没授权」与「授权没注册上」，跨 20 小时四轮被拦）。
import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_GUARD_DEBOUNCE_MS,
  COMPUTER_USE_GUARD_FRESH_MS,
  PERMISSION_DRIFT_HINT_MS,
  computerUseGuardSignalFresh,
  isComputerUsePermissionGuardError,
  permissionDriftGuidance,
  permissionWizardState,
  projectComputerUsePermissionGuardSignal,
} from '@/lib/codingComputerUsePermissionWizard'

describe('permissionWizardState 三态判别', () => {
  const openedAt = 1_000_000
  const now = openedAt + PERMISSION_DRIFT_HINT_MS

  it('③ 布尔为真 ⇒ 已生效（granted），其余信号一律不打扰', () => {
    expect(permissionWizardState({ granted: true, settingsOpenedAt: null, now })).toBe('granted')
    expect(permissionWizardState({ granted: true, settingsOpenedAt: openedAt, now, userConfirmedNotEffective: true })).toBe('granted')
  })

  it('① 没授权且没打开过设置 ⇒ ungranted', () => {
    expect(permissionWizardState({ granted: false, settingsOpenedAt: null, now })).toBe('ungranted')
  })

  it('① 打开过设置但等待未到阈值 ⇒ 仍是 ungranted（给授权生效留时间）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + PERMISSION_DRIFT_HINT_MS - 1,
    })).toBe('ungranted')
  })

  it('② 打开设置后等待到阈值仍未生效 ⇒ drift（时间侧兜底）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + PERMISSION_DRIFT_HINT_MS,
    })).toBe('drift')
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + PERMISSION_DRIFT_HINT_MS + 5_000,
    })).toBe('drift')
  })

  it('② 用户确认「我已开启但没生效」⇒ 立即 drift（问答式，§3.8-4：TCC 查询受限）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: null, now, userConfirmedNotEffective: true,
    })).toBe('drift')
  })

  it('driftHintMs 可覆盖（其它平台传 Infinity 关掉时间侧判别）', () => {
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + 1e9, driftHintMs: Number.POSITIVE_INFINITY,
    })).toBe('ungranted')
    expect(permissionWizardState({
      granted: false, settingsOpenedAt: openedAt, now: openedAt + 1_000, driftHintMs: 500,
    })).toBe('drift')
  })
})

describe('permissionDriftGuidance 漂移指引文案', () => {
  it('屏幕录制：写明手动添加步骤、签名身份对号入座与重启', () => {
    const text = permissionDriftGuidance('screen-recording', {
      bundleId: 'com.milksu.app', stableIdentity: false,
    })
    expect(text).toContain('屏幕录制')
    expect(text).toContain('仍未生效')
    expect(text).toContain('临时签名')
    expect(text).toContain('手动添加 MilkSU')
    expect(text).toContain('com.milksu.app')
    expect(text).toContain('重启 MilkSU')
  })

  it('辅助功能：pane 名跟着权限走；没有签名身份时不硬编', () => {
    const text = permissionDriftGuidance('accessibility', null)
    expect(text).toContain('辅助功能')
    expect(text).not.toContain('com.milksu.app')
  })
})

describe('isComputerUsePermissionGuardError 权限守卫识别', () => {
  it('manager.Start 前置校验文案命中（锁窗失败的权限守卫路径）', () => {
    expect(isComputerUsePermissionGuardError(
      new Error('请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话'),
    )).toBe(true)
  })

  it('驱动 canary 的英文文案也命中（大小写不敏感）', () => {
    expect(isComputerUsePermissionGuardError('Accessibility permission required')).toBe(true)
    expect(isComputerUsePermissionGuardError('Screen Recording not granted')).toBe(true)
    expect(isComputerUsePermissionGuardError('screen capture access denied')).toBe(true)
  })

  it('其它启动失败（目标无效、服务不可用等）不误命中', () => {
    expect(isComputerUsePermissionGuardError('选择的窗口无效')).toBe(false)
    expect(isComputerUsePermissionGuardError('Computer Use service is unavailable')).toBe(false)
    expect(isComputerUsePermissionGuardError(new Error('新目标无效，旧锁保留'))).toBe(false)
    expect(isComputerUsePermissionGuardError(null)).toBe(false)
  })
})

describe('projectComputerUsePermissionGuardSignal 锁窗守卫信号投影', () => {
  const guardText = '请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话'
  const base = {
    type: 'tool.completed',
    toolName: 'milksu_workspace',
    conversationId: 'conversation-1',
    previous: null,
    now: 1_000_000,
  }

  it('milksu_workspace 的 tool.completed 守卫失败 ⇒ 信号（β.191 的撞墙现场）', () => {
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      text: guardText,
    })).toEqual({
      conversationId: 'conversation-1',
      notice: guardText,
      at: 1_000_000,
    })
  })

  it('error 缺失时回落 text（同一载荷的两个字段，别漏了只有 text 的路径）', () => {
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      text: guardText,
    })?.notice).toBe(guardText)
  })

  it('驱动 canary 的英文守卫文案同样命中', () => {
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: 'Screen Recording permission not granted',
    })).not.toBeNull()
  })

  it('非权限类失败不触发（目标无效 / 别的会话占用 / 超时）', () => {
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: '选择的窗口无效',
    })).toBeNull()
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: 'Computer Use is already attached to another visible Coding task',
    })).toBeNull()
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: 'Coding workspace action timed out',
    })).toBeNull()
  })

  it('别的事件阶段不触发：tool.started / tool.progress', () => {
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      type: 'tool.started',
      text: guardText,
    })).toBeNull()
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      type: 'tool.progress',
      text: guardText,
    })).toBeNull()
  })

  it('别的工具不触发：milksu_workspace 之外不碰（事件不带 action 名，宁可窄）', () => {
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      toolName: 'bash',
      error: guardText,
    })).toBeNull()
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      toolName: 'prepare_computer_use_driver',
      error: guardText,
    })).toBeNull()
  })

  it('同会话去抖：窗口内再次撞墙返回 null，出窗后重新记', () => {
    const first = projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      now: 1_000_000,
    })
    expect(first).not.toBeNull()
    // 窗口内：同会话压住。
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      previous: first,
      now: 1_000_000 + COMPUTER_USE_GUARD_DEBOUNCE_MS - 1,
    })).toBeNull()
    // 出窗：重新记。
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      previous: first,
      now: 1_000_000 + COMPUTER_USE_GUARD_DEBOUNCE_MS,
    })?.at).toBe(1_000_000 + COMPUTER_USE_GUARD_DEBOUNCE_MS)
  })

  it('不同会话不受彼此去抖影响（另一个对话撞墙仍是新事件）', () => {
    const first = projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      now: 1_000_000,
    })
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      conversationId: 'conversation-2',
      error: guardText,
      previous: first,
      now: 1_000_000 + 1,
    })).not.toBeNull()
  })

  it('debounceMs 可覆盖（测试注入用）', () => {
    const first = projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      now: 1_000_000,
    })
    expect(projectComputerUsePermissionGuardSignal({
      ...base,
      error: guardText,
      previous: first,
      now: 1_000_000 + 500,
      debounceMs: 1_000,
    })).toBeNull()
  })
})

describe('computerUseGuardSignalFresh 信号保鲜', () => {
  it('窗口内新鲜、窗口外过期（重挂载不翻旧账）', () => {
    const signal = { conversationId: 'c', notice: 'n', at: 1_000_000 }
    expect(computerUseGuardSignalFresh(signal, 1_000_000 + COMPUTER_USE_GUARD_FRESH_MS)).toBe(true)
    expect(computerUseGuardSignalFresh(signal, 1_000_000 + COMPUTER_USE_GUARD_FRESH_MS + 1)).toBe(false)
    expect(computerUseGuardSignalFresh(null, 1_000_000)).toBe(false)
  })
})
