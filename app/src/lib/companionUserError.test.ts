import { describe, expect, it } from 'vitest'
import { explainCompanionError } from './companionUserError'
import { applyUiLocale } from './uiLocale'

describe('explainCompanionError', () => {
  it('maps sidecar-down internals to product copy', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('companion sidecar stopped')).toBe('桌宠暂时连不上。')
    applyUiLocale('en')
    expect(explainCompanionError('Error: companion sidecar did not become ready')).toBe(
      'The companion could not start.',
    )
    applyUiLocale('zh')
  })

  it('leaves unrelated errors alone', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('companion model not found: tokenflux/missing')).toBe(
      'companion model not found: tokenflux/missing',
    )
  })
})
