import { describe, expect, it } from 'vitest'
import { ctfManualStatusFromJobStatus, ctfManualStatusLabel } from './ctfManualStatus'

describe('CTF manual status', () => {
  it('keeps runtime failure separate from the user-owned completion state', () => {
    expect(ctfManualStatusFromJobStatus('failed')).toBe('paused')
    expect(ctfManualStatusLabel('paused')).toBe('稍后继续')
  })

  it('uses clear defaults for untouched work', () => {
    expect(ctfManualStatusFromJobStatus('queued')).toBe('not_started')
    expect(ctfManualStatusFromJobStatus('running')).toBe('in_progress')
    expect(ctfManualStatusFromJobStatus('succeeded')).toBe('completed')
  })
})
