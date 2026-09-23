import { describe, expect, it } from 'vitest'
import { shouldShowMultitaskCapsule } from './composerMultitask'

describe('shouldShowMultitaskCapsule', () => {
  it('shows only when DSH Multitask is on', () => {
    expect(shouldShowMultitaskCapsule({ kernel: 'dsh', multitask: true })).toBe(true)
    expect(shouldShowMultitaskCapsule({ kernel: 'deepseek-harness', multitask: true })).toBe(true)
  })

  it('hides on Pi, off, or missing flag', () => {
    expect(shouldShowMultitaskCapsule({ kernel: 'dsh', multitask: false })).toBe(false)
    expect(shouldShowMultitaskCapsule({ kernel: 'dsh' })).toBe(false)
    expect(shouldShowMultitaskCapsule({ kernel: 'pi', multitask: true })).toBe(true)
    expect(shouldShowMultitaskCapsule({ kernel: '', multitask: true })).toBe(false)
  })
})
