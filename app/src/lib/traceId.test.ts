import { describe, expect, it } from 'vitest'
import { generateTraceId, isTraceId, normalizeTraceId } from './traceId'

describe('traceId', () => {
  it('generates a trc_ uuid that validates', () => {
    const id = generateTraceId()
    expect(id.startsWith('trc_')).toBe(true)
    expect(isTraceId(id)).toBe(true)
    expect(normalizeTraceId(id)).toBe(id)
  })

  it('rejects conversation ids and empty values', () => {
    expect(isTraceId('')).toBe(false)
    expect(isTraceId('conversation-1')).toBe(false)
    expect(isTraceId('trc_not-a-uuid')).toBe(false)
    expect(normalizeTraceId('  ')).toBe('')
  })
})
