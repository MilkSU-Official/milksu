import { describe, expect, it } from 'vitest'
import { applyUiLocale } from './uiLocale'
import {
  explainModelCallFailure,
  explainModelServiceError,
  explainModelVerificationFailure,
  explainTokenFluxError,
} from './tokenFluxError'

describe('explainTokenFluxError', () => {
  it('does not treat a bare HTTP status as TokenFlux', () => {
    applyUiLocale('zh')
    expect(explainTokenFluxError('PI model verification failed: 403 status code (no body)')).toBeNull()
    expect(explainTokenFluxError('403 status code (no body)')).toBeNull()
    expect(explainTokenFluxError('401 status code (no body)')).toBeNull()
  })

  it.each([
    [
      '403: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
      '账户余额不足',
      'INSUFFICIENT_BALANCE',
    ],
    [
      '403: {"code":"API_KEY_QUOTA_EXHAUSTED","message":"API key 额度已用完"}',
      '额度已用完',
      'API_KEY_QUOTA_EXHAUSTED',
    ],
    [
      'error: code=403 reason="SUBSCRIPTION_EXPIRED" message="subscription has expired" metadata=map[]',
      '订阅已过期',
      'SUBSCRIPTION_EXPIRED',
    ],
    [
      'error: code=403 reason="DAILY_LIMIT_EXCEEDED" message="daily limit exceeded"',
      '额度已用完',
      'DAILY_LIMIT_EXCEEDED',
    ],
    [
      '403: {"message":"This group is restricted to Claude Code clients (/v1/messages only)","type":"permission_error"}',
      '仅支持 Claude Code 客户端',
      '/v1/messages only',
    ],
    [
      '403: {"message":"model group rate limited for this key","type":"permission_error"}',
      '请求过于频繁',
      'rate limited',
    ],
    [
      '400: {"code":"COMPOSITE_KEY_MODEL_PREFIX_REQUIRED","message":"composite api key model must use prefix/model_id"}',
      '厂商前缀',
      'COMPOSITE_KEY_MODEL_PREFIX_REQUIRED',
    ],
    [
      '404: {"error":{"message":"Model \\"grok-4.5\\" is not supported by any configured account in this group"}}',
      '不支持这个模型',
      'not supported by any configured account',
    ],
    [
      '503: {"message":"No available accounts"}',
      '没有可用账号',
      'No available accounts',
    ],
    [
      '401: {"code":"API_KEY_DISABLED","message":"API key is disabled"}',
      '已停用',
      'API_KEY_DISABLED',
    ],
  ])('maps %s', (raw, expected, hidden) => {
    applyUiLocale('zh')
    const message = explainTokenFluxError(raw)
    expect(message).toBeTruthy()
    expect(message).toContain(expected)
    expect(message).not.toContain(hidden)
    expect(message).not.toMatch(/\b(?:400|401|403|404|429|502|503)\b/)
    expect(message).not.toContain('no body')
    expect(message).not.toContain('status code')
  })

  it('keeps English copy when the UI locale is English', () => {
    applyUiLocale('en')
    const message = explainTokenFluxError(
      '403: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
    )
    expect(message).toContain('Top up on TokenFlux')
    expect(message).not.toContain('403')
    applyUiLocale('zh')
  })

  it('does not claim a TokenFlux status for unrelated local failures', () => {
    applyUiLocale('zh')
    expect(explainTokenFluxError('dial tcp 127.0.0.1:65533: connect: connection refused')).toBeNull()
    expect(explainTokenFluxError('PI session not found')).toBeNull()
  })
})

describe('explainModelCallFailure', () => {
  // The incident: the reader saw a generic sentence, the picker said deepseek-flash, and the engine
  // was really on the account source with a different model id. The final string is locked, so the
  // route cannot silently lose the source or gain a second arrow.
  it('names the source, provider, model and upstream status in one sentence', () => {
    expect(explainModelCallFailure('502 status code (no body)', {
      provider: 'milksu-account',
      model: 'deepseek/deepseek-flash',
      source: 'account',
    })).toBe(
      '模型调用失败：账号来源 / milksu-account / deepseek/deepseek-flash'
        + '（502 status code (no body)） → TokenFlux 上游暂时不可用，请稍后重试或换一个模型。',
    )
  })

  it('names the personal source when that is what ran', () => {
    const text = explainModelCallFailure('502 status code (no body)', {
      provider: 'custom-relay-deepseek',
      model: 'deepseek-flash',
      source: 'personal',
    })
    expect(text).toBe(
      '模型调用失败：自有来源 / custom-relay-deepseek / deepseek-flash'
        + '（502 status code (no body)） → 模型服务暂时不可用，请稍后重试或换一个模型。',
    )
    // A personal relay failure must not borrow the TokenFlux wording.
    expect(text).not.toContain('TokenFlux')
  })

  // Exactly one arrow: the route used to carry its own "→ status", which produced
  // "route → HTTP 502 → explanation".
  it('uses a single arrow', () => {
    for (const context of [
      { provider: 'milksu-account', model: 'deepseek/deepseek-flash', source: 'account' },
      { provider: 'custom-relay-deepseek', model: 'deepseek-flash', source: 'personal' },
    ]) {
      const text = explainModelCallFailure('502 status code (no body)', context) ?? ''
      expect(text.split('→')).toHaveLength(2)
    }
  })

  it('stays unchanged when no context is available', () => {
    expect(explainModelCallFailure('502 status code (no body)'))
      .toBe(explainModelServiceError('502 status code (no body)'))
  })
})

describe('explainModelVerificationFailure', () => {
  it('keeps save-and-verify copy free of raw Pi status text', () => {
    applyUiLocale('zh')
    const message = explainModelVerificationFailure(
      "Error invoking remote method 'milksu:invoke': Error: PI model verification failed: 403 status code (no body)",
      'custom-relay-deepseek',
    )
    expect(message).toContain('模型服务拒绝了这次请求')
    expect(message).toContain('额度')
    expect(message).not.toContain('TokenFlux')
    expect(message).not.toContain('PI')
    expect(message).not.toContain('403')
    expect(message).not.toContain('milksu:invoke')
  })

  it('still names TokenFlux when verifying a TokenFlux key', () => {
    applyUiLocale('zh')
    const message = explainModelVerificationFailure(
      'PI model verification failed: 403 status code (no body)',
      'tokenflux',
    )
    expect(message).toContain('TokenFlux')
    expect(message).toContain('额度')
  })

  it('explains an offline probe without dumping the dial target', () => {
    applyUiLocale('zh')
    const message = explainModelVerificationFailure(
      'PI model verification failed: dial tcp 127.0.0.1:65533: connect: connection refused api_key=[REDACTED]',
    )
    expect(message).toContain('无法连上模型服务')
    expect(message).not.toContain('127.0.0.1')
    expect(message).not.toContain('[REDACTED]')
  })
})
