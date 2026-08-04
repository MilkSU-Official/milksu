import { describe, expect, it } from 'vitest'
import { redactProviderCredentials } from './redaction'

describe('redactProviderCredentials', () => {
  it('redacts common provider credential shapes without dropping useful context', () => {
    const message = redactProviderCredentials(
      [
        'provider failed',
        'OPENAI_API_KEY=sk-env-secret-123456789',
        'Authorization: Bearer sk-bearer-secret-123456789',
        'https://provider.example.test/v1?api_key=sk-query-secret-123456789&model=x',
        'https://provider.example.test/v1?x-api-key=sk-x-query-secret-123456789&model=x',
        'api-key=sk-report-secret-123456789',
        'x-api-key: sk-header-secret-123456789',
        'session sess-runtime-secret-123456789',
      ].join(' '),
    )

    expect(message).toContain('provider failed')
    expect(message).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(message).toContain('Bearer [credential redacted]')
    expect(message).toContain('?api_key=[credential redacted]&model=x')
    expect(message).toContain('?x-api-key=[credential redacted]&model=x')
    expect(message).toContain('api_key=[credential redacted]')
    expect(message).toContain('x-api-key=[credential redacted]')
    expect(message).not.toContain('sk-env-secret')
    expect(message).not.toContain('sk-bearer-secret')
    expect(message).not.toContain('sk-query-secret')
    expect(message).not.toContain('sk-x-query-secret')
    expect(message).not.toContain('sk-report-secret')
    expect(message).not.toContain('sk-header-secret')
    expect(message).not.toContain('sess-runtime-secret')
  })

  it('is idempotent when already-redacted values pass through another UI layer', () => {
    const once = [
      'OPENAI_API_KEY=[credential redacted]',
      'Authorization: Bearer [credential redacted]',
      'https://provider.example.test/v1?api_key=[credential redacted]&model=x',
      'https://provider.example.test/v1?x-api-key=[credential redacted]&model=x',
      'api-key=[credential redacted]',
      'x-api-key: [credential redacted]',
    ].join(' ')

    const redacted = redactProviderCredentials(once)
    expect(redactProviderCredentials(redacted)).toBe(redacted)
    expect(redacted).not.toContain('redacted] redacted]')
    expect(redacted).not.toContain('redacted]&model=x redacted]')
  })

  it('collapses previously-expanded redaction markers from historical snippets', () => {
    const polluted = [
      'OPENAI_API_KEY=[credential redacted] redacted] redacted]',
      'https://provider.example.test/v1?api_key=[credential redacted]&model=x redacted]',
    ].join(' ')

    const redacted = redactProviderCredentials(polluted)
    expect(redacted).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(redacted).toContain('?api_key=[credential redacted]&model=x')
    expect(redacted).not.toContain('redacted] redacted]')
    expect(redacted).not.toContain('redacted]&model=x redacted]')
    expect(redactProviderCredentials(redacted)).toBe(redacted)
  })
})
