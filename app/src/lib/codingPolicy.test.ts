import { describe, expect, it } from 'vitest'
import {
  computerUseStartArgs,
  computerUseTargetKey,
  describeActiveComputerUseCapability,
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
      .toMatch(/可见 App \/ 窗口/)
    expect(capabilities.find(item => item.id === 'computer-use')?.detail)
      .toMatch(/不能用 Shell、截图目录、SQLite、IPC 或私有协议绕过/)
    expect(capabilities.find(item => item.id === 'imagegen')?.status).toBe('approval-required')
  })

  it('does not advertise ImageGen when OpenAI is not configured', () => {
    const capabilities = previewCodingCapabilities('go', 'workspace-auto', false)
    expect(capabilities.find(item => item.id === 'imagegen')?.status).toBe('unavailable')
    expect(capabilities.find(item => item.id === 'imagegen')?.detail).toMatch(/配置并启用 OpenAI/)
  })

  it('describes the selected external Computer Use app and immutable window scope', () => {
    const target = {
      name: 'Codex',
      bundleId: 'com.openai.codex',
      pid: 4242,
      windowId: 9001,
      windowTitle: '已暂停的目标',
    }

    const auto = describeActiveComputerUseCapability('workspace-auto', target)
    expect(auto.status).toBe('allowed')
    expect(auto.detail).toContain('Codex')
    expect(auto.detail).toContain('com.openai.codex')
    expect(auto.detail).toContain('PID 4242')
    expect(auto.detail).toContain('Window 9001')
    expect(auto.detail).not.toContain('当前 MilkSU App')

    const ask = describeActiveComputerUseCapability('ask', target)
    expect(ask.status).toBe('approval-required')
    expect(ask.detail).toContain('逐次确认观察和操作')
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
})
