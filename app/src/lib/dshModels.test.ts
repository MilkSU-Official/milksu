import { describe, expect, it } from 'vitest'
import { dshAcpSupportsModel } from './dshModels'

describe('dshAcpSupportsModel', () => {
  it('accepts the DeepSeek Harness ACP catalog and vendor-prefixed twins', () => {
    expect(dshAcpSupportsModel('deepseek-v4-flash')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-flash')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-v4-pro')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-v4-flash-vision-exp')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-ai/deepseek-v4-flash')).toBe(true)
  })

  it('rejects models outside the ACP catalog', () => {
    expect(dshAcpSupportsModel('')).toBe(false)
    expect(dshAcpSupportsModel('grok-4.5')).toBe(false)
    expect(dshAcpSupportsModel('x-ai/grok-4.6')).toBe(false)
    expect(dshAcpSupportsModel('claude-sonnet')).toBe(false)
    expect(dshAcpSupportsModel('deepseek-')).toBe(false)
    expect(dshAcpSupportsModel('deepseek-chat')).toBe(false)
  })
})
