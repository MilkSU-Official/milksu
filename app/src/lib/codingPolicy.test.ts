import { describe, expect, it } from 'vitest'
import {
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
  previewCodingCapabilities,
} from '@/lib/codingPolicy'

describe('Coding policy presentation', () => {
  it('preserves deliverable legacy defaults', () => {
    expect(normalizeCodingExecutionMode(undefined)).toBe('go')
    expect(normalizeCodingApprovalPolicy(undefined)).toBe('workspace-auto')
  })

  it('shows Plan and Ask as non-mutating', () => {
    for (const [mode, approval] of [
      ['plan', 'workspace-auto'],
      ['go', 'ask'],
      ['go', 'read-only'],
    ] as const) {
      const capabilities = previewCodingCapabilities(mode, approval)
      expect(capabilities.find(item => item.id === 'command')?.status).toBe('blocked')
      expect(capabilities.find(item => item.id === 'workspace-write')?.status)
        .not.toBe('allowed')
    }
  })

  it('keeps Project Auto useful without granting local credentials or UI control', () => {
    const capabilities = previewCodingCapabilities('go', 'workspace-auto')
    expect(capabilities.find(item => item.id === 'workspace-write')?.status).toBe('allowed')
    expect(capabilities.find(item => item.id === 'command')?.status).toBe('allowed')
    expect(capabilities.find(item => item.id === 'network')?.status).toBe('allowed')
    for (const id of ['credentials', 'browser', 'computer-use']) {
      expect(capabilities.find(item => item.id === id)?.status).not.toBe('allowed')
    }
  })

  it('presents Full Access as an explicit higher-authority option', () => {
    expect(normalizeCodingApprovalPolicy('full-auto')).toBe('full-auto')
    const capabilities = previewCodingCapabilities('go', 'full-auto')
    for (const id of ['workspace-write', 'command', 'network', 'credentials']) {
      expect(capabilities.find(item => item.id === id)?.status).toBe('allowed')
    }
    expect(capabilities.find(item => item.id === 'browser')?.status).toBe('unavailable')
    expect(capabilities.find(item => item.id === 'computer-use')?.status).toBe('unavailable')
  })
})
