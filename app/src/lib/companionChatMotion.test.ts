import { describe, expect, it } from 'vitest'
import { aliasCompanionChatKeys, companionChatRowFingerprint } from '@/lib/companionChatMotion'

describe('companionChatMotion', () => {
  it('keeps process, typing, and older rows on a stable fingerprint', () => {
    expect(companionChatRowFingerprint({ kind: 'live-process' })).toBe('process')
    expect(companionChatRowFingerprint({ kind: 'live-settled' })).toBe('process')
    expect(companionChatRowFingerprint({ kind: 'entry', processOnly: true, role: 'assistant' })).toBe('process')
    expect(companionChatRowFingerprint({ kind: 'live-typing' })).toBe('live-typing')
    expect(companionChatRowFingerprint({ kind: 'older' })).toBe('older')
  })

  it('aliases a pending user bubble onto the durable transcript id', () => {
    const previous = [{
      key: 'pending:1',
      fingerprint: companionChatRowFingerprint({ kind: 'entry', role: 'user', text: '你好' }),
    }]
    const next = [{
      key: 'msg-server',
      fingerprint: companionChatRowFingerprint({ kind: 'entry', role: 'user', text: '你好' }),
    }]
    expect(aliasCompanionChatKeys(previous, next).get('pending:1')).toBe('msg-server')
  })

  it('aliases a live stream onto the settled assistant row', () => {
    const previous = [{
      key: 'live:stream',
      fingerprint: companionChatRowFingerprint({ kind: 'live-stream', role: 'assistant', text: '写好了' }),
    }]
    const next = [{
      key: 'asst-1',
      fingerprint: companionChatRowFingerprint({ kind: 'entry', role: 'assistant', text: '写好了' }),
    }]
    expect(aliasCompanionChatKeys(previous, next).get('live:stream')).toBe('asst-1')
  })

  it('aliases a live stream onto a new assistant row even if the text grew', () => {
    const previous = [{
      key: 'live:stream',
      fingerprint: companionChatRowFingerprint({ kind: 'live-stream', role: 'assistant', text: '写' }),
    }]
    const next = [{
      key: 'asst-2',
      fingerprint: companionChatRowFingerprint({ kind: 'entry', role: 'assistant', text: '写好了' }),
    }]
    expect(aliasCompanionChatKeys(previous, next).get('live:stream')).toBe('asst-2')
  })

  it('does not alias rows that already share an id', () => {
    const items = [{
      key: 'same',
      fingerprint: companionChatRowFingerprint({ kind: 'entry', role: 'user', text: 'x' }),
    }]
    expect(aliasCompanionChatKeys(items, items).size).toBe(0)
  })
})
