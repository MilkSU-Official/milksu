import { describe, expect, it } from 'vitest'
import {
  conversationKernelLocked,
  defaultAgentKernel,
  defaultBusySend,
  FACTORY_DEFAULT_BUSY_SEND,
  FACTORY_DEFAULT_KERNEL,
  normalizeAgentKernel,
  normalizeBusySend,
} from './agentKernel'

describe('agentKernel', () => {
  it('defaults unknown conversation kernels to Pi', () => {
    expect(normalizeAgentKernel(undefined)).toBe('pi')
    expect(normalizeAgentKernel('')).toBe('pi')
    expect(normalizeAgentKernel('other')).toBe('pi')
  })

  it('uses Pi as the factory Settings default for new conversations', () => {
    expect(FACTORY_DEFAULT_KERNEL).toBe('pi')
    expect(defaultAgentKernel(undefined)).toBe('pi')
    expect(defaultAgentKernel('')).toBe('pi')
    expect(defaultAgentKernel('pi')).toBe('pi')
    expect(defaultAgentKernel('deepseek-harness')).toBe('dsh')
  })

  it('accepts DeepSeek aliases', () => {
    expect(normalizeAgentKernel('dsh')).toBe('dsh')
    expect(normalizeAgentKernel('DeepSeek-Harness')).toBe('dsh')
  })

  it('defaults busy-send to interrupt and accepts queue', () => {
    expect(FACTORY_DEFAULT_BUSY_SEND).toBe('interrupt')
    expect(defaultBusySend()).toBe('interrupt')
    expect(normalizeBusySend('queue')).toBe('queue')
    expect(normalizeBusySend('排队')).toBe('queue')
    expect(normalizeBusySend('插话')).toBe('interrupt')
  })

  it('locks after a real user message', () => {
    expect(conversationKernelLocked([])).toBe(false)
    expect(conversationKernelLocked([{ role: 'user', status: 'queued' }])).toBe(false)
    expect(conversationKernelLocked([{ role: 'user' }])).toBe(true)
  })
})
