import { describe, expect, it } from 'vitest'
import {
  companionChatAttachmentsFromText,
  companionChatVisibleText,
  explainCompanionError,
} from './companionUserError'
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

  it('maps TokenFlux group model rejection to product copy', () => {
    applyUiLocale('zh')
    const text = explainCompanionError(
      '403: {"message":"The current group does not support the requested model \\"gemini-3.8-flash\\"","type":"permission_error"}',
      { provider: 'tokenflux', model: 'google/gemini-3.8-flash' },
    )
    expect(text).toContain('当前 TokenFlux 分组不支持这个模型')
    expect(text).not.toBe('message')
  })

  it('leaves unrelated errors alone', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('companion session is not ready')).toBe(
      'companion session is not ready',
    )
  })
})

describe('companionChatVisibleText', () => {
  it('does not fall back to the JSONL type name', () => {
    expect(companionChatVisibleText({ type: 'message', text: '' })).toBe('')
    expect(companionChatVisibleText({ type: 'message', text: 'message' })).toBe('')
    expect(companionChatVisibleText({
      type: 'message',
      role: 'assistant',
      error: '403: group does not support the requested model',
    })).toBe('403: group does not support the requested model')
    expect(companionChatVisibleText({ type: 'message', role: 'assistant', text: '' })).toBe('这一轮没有回复。')
    expect(companionChatVisibleText({ type: 'message', text: '你好' })).toBe('你好')
    expect(companionChatVisibleText({
      type: 'message',
      text: '看这张图\n\n[MilkSU attachments]\n- notes.md (text/plain, 12 B, sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 只读路径: /x)\n不要编造没给出的内容。',
    })).toBe('看这张图')
    expect(companionChatVisibleText({
      type: 'message',
      text: '附件：image.png\n\n[MilkSU attachments]\n- image.png (image/png, 1.0 KiB, sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, 只读路径: /x)',
    })).toBe('')
    expect(companionChatAttachmentsFromText(
      '请看这些附件。\n\n[MilkSU attachments]\n- image.png (image/png, 1.0 KiB, sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, 只读路径: /x)',
    )).toEqual([{
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      name: 'image.png',
      mediaType: 'image/png',
      size: 0,
      sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }])
  })
})
