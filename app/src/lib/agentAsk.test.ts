import { describe, expect, it } from 'vitest'
import { isAskMessage, parseAskOptions } from './agentAsk'

describe('agentAsk', () => {
  it('parses 2-6 options from the approval payload', () => {
    const options = parseAskOptions(JSON.stringify({
      options: [
        { label: 'Three (core line)', detail: 'Keep the line small' },
        { id: 'five', label: 'Five (full case)' },
        { label: 'Just one hero' },
      ],
    }))
    expect(options).toEqual([
      { id: 'option-1', label: 'Three (core line)', detail: 'Keep the line small' },
      { id: 'five', label: 'Five (full case)' },
      { id: 'option-3', label: 'Just one hero' },
    ])
    expect(isAskMessage({ toolName: 'milksu_ask', approvalRequestId: 'ask-1' })).toBe(true)
    expect(isAskMessage({ toolName: 'bash', approvalRequestId: 'a' })).toBe(false)
  })
})
