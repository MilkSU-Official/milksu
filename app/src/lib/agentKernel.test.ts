import { describe, expect, it } from 'vitest'
import { conversationKernelLocked, normalizeAgentKernel } from './agentKernel'

describe('agentKernel', () => {
  it('defaults unknown values to Pi', () => {
    expect(normalizeAgentKernel(undefined)).toBe('pi')
    expect(normalizeAgentKernel('')).toBe('pi')
    expect(normalizeAgentKernel('other')).toBe('pi')
  })

  it('accepts DeepSeek aliases', () => {
    expect(normalizeAgentKernel('dsh')).toBe('dsh')
    expect(normalizeAgentKernel('DeepSeek-Harness')).toBe('dsh')
  })

  it('locks after a real user message', () => {
    expect(conversationKernelLocked([])).toBe(false)
    expect(conversationKernelLocked([{ role: 'user', status: 'queued' }])).toBe(false)
    expect(conversationKernelLocked([{ role: 'user' }])).toBe(true)
  })
})
