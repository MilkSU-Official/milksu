import { describe, expect, it } from 'vitest'
import {
  computerUseStartArgs,
  computerUseTargetKey,
  describeActiveComputerUseCapability,
  describePendingComputerUseCapability,
  isSelfComputerUseTarget,
  isUserBrowserTarget,
  nextComputerUseTargetKey,
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
  previewCodingCapabilities,
  selectedComputerUseTarget,
} from '@/lib/codingPolicy'

describe('Coding policy presentation', () => {
  it('preserves deliverable legacy defaults', () => {
    expect(normalizeCodingExecutionMode(undefined)).toBe('go')
    expect(normalizeCodingApprovalPolicy(undefined)).toBe('workspace-auto')
  })

  it('shows Plan and Read-only as non-mutating', () => {
    for (const [mode, approval] of [
      ['plan', 'workspace-auto'],
      ['go', 'read-only'],
    ] as const) {
      const capabilities = previewCodingCapabilities(mode, approval)
      expect(capabilities.find(item => item.id === 'command')?.status).toBe('blocked')
      expect(capabilities.find(item => item.id === 'workspace-write')?.status)
        .not.toBe('allowed')
    }
  })

  it('shows Ask as a real per-tool approval mode', () => {
    const capabilities = previewCodingCapabilities('go', 'ask', true)
    for (const id of ['workspace-write', 'command', 'network']) {
      expect(capabilities.find(item => item.id === id)?.status).toBe('approval-required')
    }
    expect(capabilities.find(item => item.id === 'credentials')?.status).toBe('blocked')
    expect(capabilities.find(item => item.id === 'imagegen')?.status)
      .toBe('approval-required')
  })

  it('keeps Project Auto useful without granting local credentials or UI control', () => {
    const capabilities = previewCodingCapabilities('go', 'workspace-auto')
    expect(capabilities.find(item => item.id === 'workspace-write')?.status).toBe('allowed')
    expect(capabilities.find(item => item.id === 'command')?.status).toBe('allowed')
    expect(capabilities.find(item => item.id === 'network')?.status).toBe('allowed')
    for (const id of ['credentials', 'browser', 'computer-use', 'imagegen']) {
      expect(capabilities.find(item => item.id === id)?.status).not.toBe('allowed')
    }
  })

  it('presents Full Access as an explicit higher-authority option', () => {
    expect(normalizeCodingApprovalPolicy('full-auto')).toBe('full-auto')
    const capabilities = previewCodingCapabilities('go', 'full-auto', true)
    for (const id of ['workspace-write', 'command', 'network', 'credentials']) {
      expect(capabilities.find(item => item.id === id)?.status).toBe('allowed')
    }
    expect(capabilities.find(item => item.id === 'browser')?.status).toBe('unavailable')
    expect(capabilities.find(item => item.id === 'computer-use')?.status).toBe('unavailable')
    expect(capabilities.find(item => item.id === 'computer-use')?.detail)
      .toContain('选择可见窗口并启动会话后可用')
    expect(capabilities.find(item => item.id === 'imagegen')?.status).toBe('approval-required')
  })

  it('does not advertise ImageGen when OpenAI is not configured', () => {
    const capabilities = previewCodingCapabilities('go', 'workspace-auto', false)
    expect(capabilities.find(item => item.id === 'imagegen')?.status).toBe('unavailable')
    expect(capabilities.find(item => item.id === 'imagegen')?.detail).toContain('配置 OpenAI')
  })

  it('describes the selected external Computer Use app and immutable window scope', () => {
    const target = {
      name: 'Codex',
      bundleId: 'com.openai.codex',
      pid: 4242,
      windowId: 9001,
      windowTitle: '已暂停的目标',
    }

    const auto = describeActiveComputerUseCapability('go', 'workspace-auto', target)
    expect(auto.status).toBe('allowed')
    expect(auto.detail).toContain('Codex')
    expect(auto.detail).toContain('com.openai.codex')
    expect(auto.detail).toContain('PID 4242')
    expect(auto.detail).toContain('Window 9001')
    expect(auto.detail).not.toContain('当前 MilkSU App')

    const ask = describeActiveComputerUseCapability('go', 'ask', target)
    expect(ask.status).toBe('approval-required')
    expect(ask.detail).toContain('操作前会确认')

    const plan = describeActiveComputerUseCapability('plan', 'workspace-auto', target)
    expect(plan.status).toBe('blocked')
    expect(plan.detail).toContain('需 Go 且非只读')

    const readOnly = describeActiveComputerUseCapability('go', 'read-only', target)
    expect(readOnly.status).toBe('blocked')
    expect(readOnly.detail).toContain('需 Go 且非只读')
  })

  it('describes detected but not-yet-started Computer Use without calling it connected', () => {
    const target = {
      name: 'Codex',
      bundleId: 'com.openai.codex',
      pid: 4242,
      windowId: 9001,
      windowTitle: '已暂停的目标',
    }

    const readyToStart = describePendingComputerUseCapability('go', 'workspace-auto', target, {
      available: true,
      permissionsReady: true,
    })
    expect(readyToStart.status).toBe('approval-required')
    expect(readyToStart.detail).toContain('已检测到 Codex')
    expect(readyToStart.detail).toContain('启动可见会话后锁定')
    expect(readyToStart.detail).not.toContain('已锁定')

    const missingPermissions = describePendingComputerUseCapability('go', 'workspace-auto', target, {
      available: true,
      permissionsReady: false,
    })
    expect(missingPermissions.status).toBe('unavailable')
    expect(missingPermissions.detail).toContain('辅助功能与屏幕录制')

    const noWindow = describePendingComputerUseCapability('go', 'workspace-auto', null, {
      available: true,
      permissionsReady: true,
    })
    expect(noWindow.status).toBe('unavailable')
    expect(noWindow.detail).toContain('请选择一个可见窗口')

    const plan = describePendingComputerUseCapability('plan', 'workspace-auto', target, {
      available: true,
      permissionsReady: true,
    })
    expect(plan.status).toBe('blocked')
    expect(plan.detail).toContain('需 Go 且非只读')
  })

  it('starts Computer Use only for the user-selected PID and window pair', () => {
    const targets = [
      {
        name: 'Codex',
        bundleId: 'com.openai.codex',
        pid: 4242,
        windowId: 9001,
        windowTitle: '目标 A',
      },
      {
        name: 'Codex',
        bundleId: 'com.openai.codex',
        pid: 4242,
        windowId: 9002,
        windowTitle: '目标 B',
      },
      {
        name: 'MilkSU',
        bundleId: 'dev.milksu.app',
        pid: 5252,
        windowId: 9001,
        windowTitle: '同窗口号不同 PID',
      },
    ]

    expect(computerUseTargetKey(targets[1])).toBe('4242:9002')
    const selected = selectedComputerUseTarget(targets, '4242:9002')
    expect(selected?.windowTitle).toBe('目标 B')
    expect(selectedComputerUseTarget(targets, '5252:9002')).toBeNull()

    expect(computerUseStartArgs('conversation-ui', targets[1])).toEqual({
      conversationId: 'conversation-ui',
      targetPid: 4242,
      targetWindowId: 9002,
    })
  })

  it('keeps Computer Use target selection stable across visible-window refreshes', () => {
    const targets = [
      {
        name: 'Codex',
        bundleId: 'com.openai.codex',
        pid: 4242,
        windowId: 9001,
        windowTitle: '目标 A',
      },
      {
        name: 'Codex',
        bundleId: 'com.openai.codex',
        pid: 4242,
        windowId: 9002,
        windowTitle: '目标 B',
      },
      {
        name: 'Preview',
        bundleId: 'com.example.preview',
        pid: 5252,
        windowId: 9001,
        windowTitle: '同 windowId 不同 PID',
      },
    ]

    expect(nextComputerUseTargetKey(targets, '4242:9002')).toBe('4242:9002')
    expect(nextComputerUseTargetKey(targets, '9999:9999', targets[2])).toBe('5252:9001')
    expect(nextComputerUseTargetKey(targets, '9999:9999', {
      name: 'Codex',
      bundleId: 'com.openai.codex',
      pid: 4242,
      windowId: 7777,
      windowTitle: '已关闭窗口',
    })).toBe('4242:9001')
    expect(nextComputerUseTargetKey([], '4242:9002', targets[1])).toBe('')
  })

  it('prefers a non-self window when no visible Computer Use session is active yet', () => {
    const targets = [
      {
        name: 'MilkSU',
        bundleId: 'com.milksu.app',
        pid: 1111,
        windowId: 2222,
        windowTitle: 'Window',
      },
      {
        name: 'TextEdit',
        bundleId: 'com.apple.TextEdit',
        pid: 3333,
        windowId: 4444,
        windowTitle: 'Untitled',
      },
    ]

    expect(nextComputerUseTargetKey(targets, '', null, {
      hostBundleId: 'com.milksu.app',
      hostPid: 1111,
    })).toBe('3333:4444')
  })

  it('does not treat identity-isolated MilkSU Beta as self when host is Stable', () => {
    const stableHost = { hostBundleId: 'com.milksu.app', hostPid: 1111 }
    const beta = {
      name: 'MilkSU Beta',
      bundleId: 'com.milksu.app.beta',
      pid: 2222,
      windowId: 3333,
      windowTitle: 'Beta Window',
    }
    const stableSelf = {
      name: 'MilkSU',
      bundleId: 'com.milksu.app',
      pid: 1111,
      windowId: 4444,
      windowTitle: 'Stable Window',
    }
    const external = {
      name: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      pid: 5555,
      windowId: 6666,
      windowTitle: 'Untitled',
    }

    expect(isSelfComputerUseTarget(stableSelf, stableHost)).toBe(true)
    expect(isSelfComputerUseTarget(beta, stableHost)).toBe(false)
    expect(isSelfComputerUseTarget(external, stableHost)).toBe(false)
    // Fragile name/substring matching must not hide Beta from Stable.
    expect(isSelfComputerUseTarget({
      name: 'MilkSU',
      bundleId: 'com.milksu.app.beta',
      pid: 2222,
    }, stableHost)).toBe(false)

    expect(nextComputerUseTargetKey([stableSelf, beta, external], '', null, stableHost))
      .toBe('2222:3333')
    expect(nextComputerUseTargetKey([beta], '', null, stableHost)).toBe('2222:3333')

    const betaHost = { hostBundleId: 'com.milksu.app.beta', hostPid: 2222 }
    expect(isSelfComputerUseTarget(beta, betaHost)).toBe(true)
    expect(isSelfComputerUseTarget(stableSelf, betaHost)).toBe(false)
  })

  it('separates browser windows from external App scopes without substring guesses', () => {
    expect(isUserBrowserTarget({ name: 'Google Chrome', bundleId: 'com.google.Chrome' })).toBe(true)
    expect(isUserBrowserTarget({ name: 'Arc', bundleId: 'company.thebrowser.Browser' })).toBe(true)
    expect(isUserBrowserTarget({ name: 'Archive Utility', bundleId: 'com.apple.archiveutility' })).toBe(false)
    expect(isUserBrowserTarget({ name: 'Chromium Notes', bundleId: 'com.example.notes' })).toBe(false)
    expect(isUserBrowserTarget({ name: 'chrome', bundleId: 'win32.chrome' })).toBe(true)
    expect(isUserBrowserTarget({ name: 'msedge', bundleId: 'win32.msedge' })).toBe(true)
    expect(isUserBrowserTarget({ name: 'Notepad', bundleId: 'win32.notepad' })).toBe(false)
  })
})
