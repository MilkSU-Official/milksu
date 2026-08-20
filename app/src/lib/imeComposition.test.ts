// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { isComposingKey } from './imeComposition'

describe('isComposingKey', () => {
  it('recognizes the Enter an IME sends while confirming a candidate', () => {
    expect(isComposingKey(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(true)
  })

  it('recognizes the composition keydown that only reports keyCode 229', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(event, 'keyCode', { value: 229 })
    expect(isComposingKey(event)).toBe(true)
  })

  it('lets a plain Enter through', () => {
    expect(isComposingKey(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
  })
})
