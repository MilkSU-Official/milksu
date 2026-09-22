import { describe, expect, it } from 'vitest'
import {
  BUILTIN_IMAGEGEN_MODELS,
  isImageGenModelID,
  imageGenModelLabel,
} from '@/lib/imageGenCatalog'

describe('imageGenCatalog', () => {
  it('keeps chat models out of the ImageGen list', () => {
    expect(BUILTIN_IMAGEGEN_MODELS.length).toBeGreaterThanOrEqual(3)
    expect(isImageGenModelID('openai/gpt-image-2')).toBe(true)
    expect(isImageGenModelID('xai/grok-imagine-image')).toBe(true)
    expect(isImageGenModelID('google/imagen-4.0-generate-001')).toBe(true)
    expect(isImageGenModelID('deepseek/deepseek-flash')).toBe(false)
    expect(isImageGenModelID('gpt-5.6')).toBe(false)
    expect(imageGenModelLabel('openai/gpt-image-2')).toContain('GPT Image 2')
  })
})
