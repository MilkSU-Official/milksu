import { describe, expect, it } from 'vitest'
import {
  imageGenModelLabel,
  imageGenSupportsEdit,
  imageGenTransport,
  isImageGenModelID,
} from '@/lib/imageGenCatalog'

describe('imageGenCatalog', () => {
  it('classifies image routes by the -image prefix', () => {
    expect(isImageGenModelID('openai-image/gpt-image-2')).toBe(true)
    expect(isImageGenModelID('openai-image/gpt-image-2.5-sunburst')).toBe(true)
    expect(isImageGenModelID('google-image/nano-banana-2')).toBe(true)
    expect(isImageGenModelID('x-ai-image/grok-imagine-image-2.0')).toBe(true)
    expect(isImageGenModelID('future-lab-image/new-model')).toBe(true)

    expect(isImageGenModelID('openai/gpt-5.6')).toBe(false)
    expect(isImageGenModelID('openai/gpt-image-2')).toBe(false)
    expect(isImageGenModelID('google/gemini-3.8-flash-tiered')).toBe(false)
    expect(isImageGenModelID('x-ai/grok-4.7')).toBe(false)
    expect(isImageGenModelID('deepseek/deepseek-flash')).toBe(false)
    expect(isImageGenModelID('grok-imagine-image-2.0')).toBe(false)

    expect(imageGenTransport('openai-image/gpt-image-2')).toBe('gpt-image')
    expect(imageGenTransport('x-ai-image/grok-imagine-image-2.0')).toBe('images-minimal')
    expect(imageGenTransport('google-image/nano-banana-2')).toBe('gemini')
    expect(imageGenTransport('google-image/gemini-3.1-flash-image')).toBe('gemini')
    expect(imageGenTransport('openai/gpt-image-2')).toBe('')

    expect(imageGenSupportsEdit('openai-image/gpt-image-2')).toBe(true)
    expect(imageGenSupportsEdit('x-ai-image/grok-imagine-image-2.0')).toBe(true)
    expect(imageGenSupportsEdit('google-image/nano-banana-2')).toBe(false)
    expect(imageGenModelLabel('openai-image/gpt-image-2', 'GPT Image 2')).toBe('GPT Image 2')
    expect(imageGenModelLabel('google-image/nano-banana-2')).toBe('google-image/nano-banana-2')
  })
})