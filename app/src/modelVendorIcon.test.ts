import { describe, expect, it } from 'vitest'
import {
  modelVendorLabel,
  modelVendorLobeIcon,
  resolveModelVendor,
} from './modelVendorIcon'

describe('resolveModelVendor', () => {
  it('matches common TokenFlux / catalog ids by keyword', () => {
    expect(resolveModelVendor('x-ai/grok-4.6')).toBe('xai')
    expect(resolveModelVendor('grok-4.5')).toBe('xai')
    expect(resolveModelVendor('openai/gpt-5.6-sol')).toBe('openai')
    expect(resolveModelVendor('openai/gpt-4o')).toBe('openai')
    expect(resolveModelVendor('anthropic/claude-sonnet-4.6')).toBe('anthropic')
    expect(resolveModelVendor('claude-opus-4-6')).toBe('anthropic')
    expect(resolveModelVendor('deepseek/deepseek-v4-flash')).toBe('deepseek')
    expect(resolveModelVendor('google/gemini-3.1-pro-preview')).toBe('google')
    expect(resolveModelVendor('qwen/qwen3.6-27b')).toBe('qwen')
    expect(resolveModelVendor('meta-llama/Llama-3.3-70B')).toBe('meta')
    expect(resolveModelVendor('moonshotai/kimi-k2')).toBe('moonshot')
    expect(resolveModelVendor('mistralai/mistral-large')).toBe('mistral')
  })

  it('uses the display label when the id is opaque', () => {
    expect(resolveModelVendor('acct-model-01', 'Claude Sonnet 4.6')).toBe('anthropic')
    expect(resolveModelVendor('relay/custom-1', 'Grok 4.5')).toBe('xai')
    expect(resolveModelVendor('team/a', 'GPT-4.1 mini')).toBe('openai')
  })

  it('does not treat service names alone as model vendors', () => {
    // TokenFlux is a relay, not a model brand — only model text counts.
    expect(resolveModelVendor('', 'TokenFlux 中转站')).toBe('unknown')
    expect(resolveModelVendor('tokenflux-route-a')).toBe('unknown')
  })

  it('returns unknown for empty or unmatched text', () => {
    expect(resolveModelVendor('')).toBe('unknown')
    expect(resolveModelVendor('local/phi-3-mini')).toBe('unknown')
  })

  it('maps vendors to LobeHub static-svg stems', () => {
    expect(modelVendorLobeIcon('openai')).toBe('openai')
    expect(modelVendorLobeIcon('anthropic')).toBe('claude')
    expect(modelVendorLobeIcon('google')).toBe('gemini')
    expect(modelVendorLobeIcon('xai')).toBe('grok')
    expect(modelVendorLobeIcon('moonshot')).toBe('kimi')
    expect(modelVendorLobeIcon('unknown')).toBeNull()
  })

  it('exposes human labels for aria/title', () => {
    expect(modelVendorLabel('openai')).toBe('OpenAI')
    expect(modelVendorLabel('xai')).toBe('xAI')
    expect(modelVendorLabel('unknown')).toBe('未知厂商')
  })
})
