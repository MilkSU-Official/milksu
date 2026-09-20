import { describe, expect, it } from 'vitest'
import { companionPetSprite, resolveCompanionPetMotion } from '@/lib/companionPetMotion'

describe('companionPetMotion', () => {
  it('picks decide over talk, think, and complete', () => {
    expect(resolveCompanionPetMotion({
      confirm: true,
      error: false,
      streaming: true,
      busy: true,
      complete: true,
    })).toBe('decide')
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: true,
      streaming: false,
      busy: false,
      complete: true,
    })).toBe('decide')
  })

  it('uses closed mouth for think, smile for talk and complete', () => {
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: false,
      streaming: false,
      busy: true,
      complete: false,
    })).toBe('think')
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: false,
      streaming: true,
      busy: true,
      complete: false,
    })).toBe('talk')
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: false,
      streaming: false,
      busy: false,
      complete: true,
    })).toBe('complete')
    expect(companionPetSprite('think')).toBe('idle')
    expect(companionPetSprite('think', { think: true })).toBe('think')
    expect(companionPetSprite('decide')).toBe('decide')
    expect(companionPetSprite('complete')).toBe('talk')
    expect(companionPetSprite('complete', { complete: true })).toBe('complete')
    expect(companionPetSprite('talk')).toBe('talk')
    expect(companionPetSprite('idle')).toBe('idle')
  })
})
