import { describe, expect, it } from 'vitest'
import { dshAcpModelLeaf, dshAcpSupportsModel } from './dshModels'

describe('dshAcpSupportsModel', () => {
  it('keeps the official DeepSeek catalog for the DeepSeek presets', () => {
    expect(dshAcpSupportsModel('deepseek-v4-flash', 'deepseek')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-flash', 'custom-relay-deepseek')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-v4-pro', 'deepseek')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-v4-flash-vision-exp', 'custom-relay-deepseek')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-ai/deepseek-v4-flash', 'deepseek')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-chat', 'deepseek')).toBe(false)
    expect(dshAcpSupportsModel('x-ai/grok-4.6', 'deepseek')).toBe(false)
    expect(dshAcpSupportsModel('grok-4.5', 'deepseek')).toBe(false)
  })

  it('routes TokenFlux and official providers by provider id', () => {
    expect(dshAcpSupportsModel('deepseek/deepseek-flash', 'tokenflux')).toBe(true)
    expect(dshAcpSupportsModel('x-ai/grok-4.6', 'tokenflux')).toBe(true)
    expect(dshAcpSupportsModel('gpt-5.4', 'openai')).toBe(true)
    expect(dshAcpSupportsModel('claude-sonnet-5', 'anthropic')).toBe(true)
  })

  it('keeps custom relays and unknown providers off the DSH kernel', () => {
    expect(dshAcpSupportsModel('model-one', 'relay-one')).toBe(false)
    expect(dshAcpSupportsModel('anything', 'custom-relay-other')).toBe(false)
    expect(dshAcpSupportsModel('anything', 'some-unknown-provider')).toBe(false)
  })

  it('falls back to the DeepSeek-name check without a provider', () => {
    expect(dshAcpSupportsModel('deepseek-v4-flash')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-flash')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-v4-pro')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-v4-flash-vision-exp')).toBe(true)
    expect(dshAcpSupportsModel('deepseek-ai/deepseek-v4-flash')).toBe(true)
    expect(dshAcpSupportsModel('')).toBe(false)
    expect(dshAcpSupportsModel('grok-4.5')).toBe(false)
    expect(dshAcpSupportsModel('x-ai/grok-4.6')).toBe(false)
    expect(dshAcpSupportsModel('claude-sonnet')).toBe(false)
    expect(dshAcpSupportsModel('deepseek-')).toBe(false)
    expect(dshAcpSupportsModel('deepseek-chat')).toBe(false)
  })

  it('extracts the leaf id', () => {
    expect(dshAcpModelLeaf('deepseek/deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(dshAcpModelLeaf('DeepSeek-Flash')).toBe('deepseek-flash')
    expect(dshAcpModelLeaf('')).toBe('')
  })
})
