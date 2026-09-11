import { describe, expect, it } from 'vitest'
import { applyUiLocale } from './uiLocale'
import { explainModelVerificationFailure, explainTokenFluxError } from './tokenFluxError'

describe('explainTokenFluxError', () => {
  it.each([
    [
      'PI model verification failed: 403 status code (no body)',
      '请到 TokenFlux 查看额度',
      '403',
    ],
    [
      '403 status code (no body)',
      '余额不足',
      'status code',
    ],
    [
      '401 status code (no body)',
      '模型凭据无效或无权访问',
      '401',
    ],
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
    const message = explainTokenFluxError('PI model verification failed: 403 status code (no body)')
    expect(message).toContain('Check quota and key status on TokenFlux')
    expect(message).not.toContain('403')
    applyUiLocale('zh')
  })

  it('does not claim a TokenFlux status for unrelated local failures', () => {
    applyUiLocale('zh')
    expect(explainTokenFluxError('dial tcp 127.0.0.1:65533: connect: connection refused')).toBeNull()
    expect(explainTokenFluxError('PI session not found')).toBeNull()
  })
})

describe('explainModelVerificationFailure', () => {
  it('keeps save-and-verify copy free of raw Pi status text', () => {
    applyUiLocale('zh')
    const message = explainModelVerificationFailure(
      "Error invoking remote method 'milksu:invoke': Error: PI model verification failed: 403 status code (no body)",
    )
    expect(message).toContain('TokenFlux')
    expect(message).toContain('额度')
    expect(message).not.toContain('PI')
    expect(message).not.toContain('403')
    expect(message).not.toContain('milksu:invoke')
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
