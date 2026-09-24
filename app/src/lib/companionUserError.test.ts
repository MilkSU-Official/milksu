import { describe, expect, it } from 'vitest'
import {
  companionAccountModelAlignedNotice,
  companionChatAttachmentsFromText,
  companionChatImageFile,
  companionChatIsVisibleEntry,
  companionChatNeedsNewConversation,
  companionChatPlainText,
  companionChatVisibleText,
  companionHostToolFailure,
  companionLooksLikeDebugPayload,
  companionCredentialMissing,
  companionMissingApiKey,
  companionSidecarDown,
  companionTurnCancelled,
  explainCompanionError,
} from './companionUserError'
import { applyUiLocale } from './uiLocale'

describe('explainCompanionError', () => {
  it('maps sidecar-down internals to product copy', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('companion sidecar stopped')).toBe('看板娘暂时连不上。')
    expect(explainCompanionError('companion sidecar is not running')).toBe('看板娘暂时连不上。')
    expect(explainCompanionError('write EPIPE')).toBe('看板娘暂时连不上。')
    expect(explainCompanionError('no companion transcript to archive')).toBe('没有可归档的抄本。')
    applyUiLocale('en')
    expect(explainCompanionError('Error: companion sidecar did not become ready')).toBe(
      'The Companion could not start.',
    )
    expect(explainCompanionError('companion sidecar is not running')).toBe(
      'The Companion could not start.',
    )
    expect(explainCompanionError('no companion transcript to archive')).toBe(
      'There is no Companion transcript to archive.',
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

  it('maps a broken tool history to start-over copy', () => {
    applyUiLocale('zh')
    expect(explainCompanionError(
      "400: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
      { provider: 'tokenflux', model: 'google/gemini-3.8-flash-tiered' },
    )).toBe('这段对话没法继续了。')
    expect(companionChatNeedsNewConversation(
      "400: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
    )).toBe(true)
    expect(companionChatNeedsNewConversation('这段对话没法继续了。')).toBe(true)
    expect(companionChatNeedsNewConversation('当前服务找不到这个模型。')).toBe(false)
    // Historical transcript rows must not by themselves force 「开新对话」.
    expect(companionChatNeedsNewConversation('')).toBe(false)
    expect(companionChatNeedsNewConversation(null)).toBe(false)
  })

  it('maps connection and host timeout failures to product copy', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('Connection error.')).toBe('连不上模型服务，请稍后重试。')
    expect(explainCompanionError('Request timed out.')).toBe('连不上模型服务，请稍后重试。')
    // Host board/dispatch timeout is not a model outage — model may still be fine.
    expect(explainCompanionError('companion host request timed out')).toBe(
      '看板娘操作已取消或超时，请再试一次。',
    )
    expect(explainCompanionError('companion host request timed out (board)')).toBe(
      '看板娘操作已取消或超时，请再试一次。',
    )
    expect(explainCompanionError('turn aborted')).toBe(
      '看板娘操作已取消或超时，请再试一次。',
    )
    applyUiLocale('en')
    expect(explainCompanionError('Connection error.')).toBe(
      'Could not reach the model service. Try again later.',
    )
    expect(explainCompanionError('companion host request timed out')).toBe(
      'The Companion action was cancelled or timed out. Try again.',
    )
    applyUiLocale('zh')
  })

  it('exposes host tool failures for loop-continuity guards', () => {
    expect(companionHostToolFailure('companion host request timed out (board)')).toBe(true)
    expect(companionHostToolFailure('Connection error.')).toBe(false)
    expect(companionHostToolFailure('tool history is broken')).toBe(false)
  })

  it('maps unknown host request ids to product copy without leaking internals', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('unknown companion host request: companion-host-1')).toBe(
      '看板娘操作已取消或超时，请再试一次。',
    )
    expect(explainCompanionError('Error: unknown companion host request: companion-host-12')).not.toMatch(
      /companion-host/,
    )
    applyUiLocale('en')
    expect(explainCompanionError('unknown companion host request: companion-host-1')).toBe(
      'The Companion action was cancelled or timed out. Try again.',
    )
    applyUiLocale('zh')
  })

  it('maps request abort to cancelled copy without harness English', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('Request aborted')).toBe('这一轮已取消。')
    expect(explainCompanionError('Request was aborted')).toBe('这一轮已取消。')
    expect(explainCompanionError('AbortError: The operation was aborted')).toBe('这一轮已取消。')
    expect(explainCompanionError('Error: request aborted')).toBe('这一轮已取消。')
    expect(explainCompanionError('Request aborted')).not.toMatch(/Request aborted|AbortError/i)
    applyUiLocale('en')
    expect(explainCompanionError('Request aborted')).toBe('This turn was cancelled.')
    applyUiLocale('zh')
    expect(companionTurnCancelled('Request aborted')).toBe(true)
    expect(companionTurnCancelled('turn aborted')).toBe(false)
    expect(companionHostToolFailure('Request aborted')).toBe(false)
  })

  it('maps missing API key without provider or model ids', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('No API key for tokenflux/deepseek/deepseek-flash')).toBe(
      '当前模型没有可用的 API Key。',
    )
    expect(explainCompanionError('Error: No API key for tokenflux/deepseek/deepseek-flash')).not.toMatch(
      /tokenflux|deepseek\//i,
    )
    applyUiLocale('en')
    expect(explainCompanionError('No API key for tokenflux/deepseek/deepseek-flash')).toBe(
      'No API key is available for the current model.',
    )
    expect(explainCompanionError('No API key for tokenflux/deepseek/deepseek-flash')).not.toMatch(
      /tokenflux\/deepseek/i,
    )
    applyUiLocale('zh')
    expect(companionMissingApiKey('No API key for tokenflux/deepseek/deepseek-flash')).toBe(true)
    expect(companionMissingApiKey('当前模型没有可用的 API Key。')).toBe(true)
    expect(companionMissingApiKey('No API key is available for the current model.')).toBe(true)
    expect(companionMissingApiKey('companion session is not ready')).toBe(false)
    expect(companionSidecarDown('companion sidecar is not running')).toBe(true)
    expect(companionSidecarDown('write EPIPE')).toBe(true)
    expect(companionSidecarDown('看板娘暂时连不上。')).toBe(true)
    expect(companionSidecarDown('这一轮已取消。')).toBe(false)
  })

  it('maps withdrawn and missing companion credentials without internals', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('companion credential withdrawn')).toBe(
      '账户已退出或密钥已移除，看板娘没法继续。请重新登录，或改选一个已有密钥的模型。',
    )
    expect(explainCompanionError('companion credential missing')).toBe(
      '看板娘这个来源还没有密钥。请重新登录，或改选一个已有密钥的模型。',
    )
    expect(companionCredentialMissing('companion credential missing')).toBe(true)
    expect(companionCredentialMissing('No API key for tokenflux/deepseek/deepseek-flash')).toBe(false)
    expect(explainCompanionError('companion credential withdrawn')).not.toMatch(
      /sidecar is not running|tokenflux|https?:\/\//i,
    )
    applyUiLocale('en')
    expect(explainCompanionError('companion credential withdrawn')).toBe(
      'The Companion cannot continue because the account signed out or the key was removed. Sign in again, or pick a model that has a key.',
    )
    expect(explainCompanionError('companion credential missing')).toBe(
      'This Companion source has no key. Sign in again, or pick a model that has a key.',
    )
    expect(companionAccountModelAlignedNotice()).toBe(
      'The account model for the companion left the catalog, so it was switched to one that is still available.',
    )
    applyUiLocale('zh')
    expect(companionAccountModelAlignedNotice()).toBe(
      '看板娘的账户模型已不在目录里，已换成还能用的模型。',
    )
    expect(companionSidecarDown('companion credential withdrawn')).toBe(false)
  })

  it('maps session-not-ready internals to product copy', () => {
    applyUiLocale('zh')
    expect(explainCompanionError('companion session is not ready')).toBe(
      '看板娘还没准备好，请稍后再试。',
    )
    expect(explainCompanionError('Error: companion session is not ready')).not.toMatch(
      /session is not ready/i,
    )
    expect(explainCompanionError('companion prompt is required')).toBe('还没有可发送的内容。')
    expect(explainCompanionError('companion model not found: tokenflux/deepseek/deepseek-flash')).toBe(
      '看板娘还没有可用的模型。',
    )
    expect(explainCompanionError('companion model not found: tokenflux/deepseek/deepseek-flash')).not.toMatch(
      /tokenflux|deepseek\//i,
    )
    applyUiLocale('en')
    expect(explainCompanionError('companion session is not ready')).toBe(
      'The Companion is not ready yet. Try again.',
    )
    applyUiLocale('zh')
  })
})

describe('companion debug payload', () => {
  it('hides get_settings dumps and host envelopes', () => {
    applyUiLocale('zh')
    expect(companionLooksLikeDebugPayload(
      '{"ok":true,"settings":{"companion_float_enabled":true,"relay":{"url":"https://tokenflux.dev/v1"}}}',
    )).toBe(true)
    expect(companionLooksLikeDebugPayload(
      '{enabled:true,url:"https://tokenflux.dev/v1",companion_float_enabled:true,ui_font:""}',
    )).toBe(true)
    expect(companionLooksLikeDebugPayload('看板列一下当前会话标题')).toBe(false)
    expect(companionLooksLikeDebugPayload('读一下不含密钥的设置摘要')).toBe(false)
    expect(companionChatIsVisibleEntry({
      role: 'user',
      text: '{"ok":true,"settings":{"companion_float_enabled":true}}',
    })).toBe(false)
    expect(companionChatIsVisibleEntry({
      role: 'toolResult',
      text: '{"ok":true,"settings":{"locale":"zh"}}',
    })).toBe(false)
    expect(companionChatPlainText({
      text: '{"ok":true,"settings":{"companion_float_enabled":true}}',
    })).toBe('')
    expect(companionChatVisibleText({
      role: 'assistant',
      text: 'Request aborted',
    })).toBe('这一轮已取消。')
  })
})

describe('companionChatVisibleText', () => {
  it('does not invent empty-reply copy for blank assistant rows', () => {
    expect(companionChatVisibleText({ type: 'message', text: '' })).toBe('')
    expect(companionChatVisibleText({ type: 'message', text: 'message' })).toBe('')
    expect(companionChatVisibleText({
      type: 'message',
      role: 'assistant',
      error: '403: group does not support the requested model',
    })).toContain('当前 TokenFlux 分组不支持这个模型')
    expect(companionChatVisibleText({
      type: 'message',
      role: 'assistant',
      error: 'unknown companion host request: companion-host-1',
    })).toBe('看板娘操作已取消或超时，请再试一次。')
    expect(companionChatVisibleText({ type: 'message', role: 'assistant', text: '' })).toBe('')
    expect(companionChatVisibleText({
      type: 'message',
      role: 'assistant',
      text: '',
      thinking: '先看板。',
    })).toBe('')
    expect(companionChatVisibleText({ type: 'message', text: '你好' })).toBe('你好')
    expect(companionChatVisibleText({
      type: 'message',
      text: '看这张图\n\n[MilkSU attachments]\n- notes.md (text/plain, 12 B, sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, 只读路径: /x)\n不要编造没给出的内容。',
    })).toBe('看这张图')
    expect(companionChatVisibleText({
      type: 'message',
      role: 'assistant',
      text: '[MilkSU attachments]\n- bounty-hunter-hacker-girl.png (image/png, 2.6 MiB, sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, 只读路径: /tmp/bounty-hunter-hacker-girl.png)\n这些是用户提供的证据。用 read 或其他合适的工具查看，不要编造内容。',
    })).toBe('')
    expect(companionChatImageFile(
      '[MilkSU attachments]\n- bounty-hunter-hacker-girl.png (image/png, 2.6 MiB, sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, 只读路径: /Users/milksu/Library/Application Support/pics/bounty-hunter-hacker-girl.png)\n',
      {
        id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        name: 'bounty-hunter-hacker-girl.png',
        mediaType: 'image/png',
        size: 0,
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    )).toEqual({
      workspacePath: '/Users/milksu/Library/Application Support/pics',
      relativePath: 'bounty-hunter-hacker-girl.png',
    })
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
