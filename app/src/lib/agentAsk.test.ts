import { describe, expect, it } from 'vitest'
import {
  askApprovalChoice,
  askOtherChoiceId,
  encodeAskOtherChoice,
  isAskMessage,
  parseAskOptions,
  pendingAskMessage,
} from './agentAsk'

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

  it('reserves other for the freeform row and encodes that answer', () => {
    expect(parseAskOptions(JSON.stringify({
      options: [
        { id: 'other', label: 'Keep the current plan' },
        { id: 'rewrite', label: 'Rewrite it' },
      ],
    })).map(option => option.id)).toEqual(['option-1', 'rewrite'])
    expect(askApprovalChoice(encodeAskOtherChoice('按任务交接'))).toEqual({
      id: askOtherChoiceId,
      otherText: '按任务交接',
    })
    expect(pendingAskMessage([
      { toolName: 'milksu_ask', approvalRequestId: 'ask-1', approvalState: 'pending' },
    ])?.approvalRequestId).toBe('ask-1')
    expect(pendingAskMessage([
      { toolName: 'milksu_ask', approvalRequestId: 'ask-1', approvalState: 'approved' },
    ])).toBeUndefined()
  })
})
