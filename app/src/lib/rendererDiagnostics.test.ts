// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyRendererError,
  recordRendererDiagnostic,
  recordRendererError,
  recordRendererRpc,
  recordRendererSection,
  rendererDiagnosticSnapshot,
  resetRendererDiagnostics,
} from './rendererDiagnostics'

beforeEach(() => {
  resetRendererDiagnostics()
})

describe('renderer diagnostics', () => {
  it('always records without consulting localStorage', () => {
    recordRendererSection('settings')

    expect(rendererDiagnosticSnapshot()).toHaveLength(1)
    expect(rendererDiagnosticSnapshot()[0]?.message).toBe('section-change section=settings')
  })

  it('keeps a bounded ring and evicts the oldest events', () => {
    for (let index = 0; index < 201; index += 1) {
      recordRendererDiagnostic('catalog-load', { page: index, status: 'ok' })
    }

    const snapshot = rendererDiagnosticSnapshot()
    expect(snapshot).toHaveLength(200)
    expect(snapshot[0]?.message).toBe('catalog-load page=1 status=ok')
    expect(snapshot.at(-1)?.message).toBe('catalog-load page=200 status=ok')
  })

  it('returns an immutable metadata-only snapshot', () => {
    recordRendererDiagnostic('catalog-load', {
      status: 'ok',
      method: 'list_nssctf_catalog',
      count: 3,
      page: 1,
      userInput: 'session body',
      url: 'https://example.test/private?token=secret',
      api_key: 'secret',
    } as never, 12)

    const snapshot = rendererDiagnosticSnapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot[0])).toBe(true)
    expect(snapshot[0]).toMatchObject({
      category: 'nssctf',
      level: 'info',
      message: 'catalog-load status=ok method=list_nssctf_catalog count=3 page=1 durationMs=12',
    })
    expect(JSON.stringify(snapshot)).not.toContain('session body')
    expect(JSON.stringify(snapshot)).not.toContain('example.test')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('records RPC, errors, and normalized error categories', () => {
    recordRendererRpc('get_settings')
    recordRendererError('catalog-search', new Error('request timed out while fetching catalog'))
    recordRendererError('dashboard-load', new Error('permission denied'))
    recordRendererError('full-catalog-load', new Error('unexpected response'))

    expect(rendererDiagnosticSnapshot().map(event => event.message)).toEqual([
      'rpc method=get_settings',
      'catalog-search status=error errorKind=timeout',
      'dashboard-load status=error errorKind=permission',
      'full-catalog-load status=error errorKind=unknown',
    ])
    expect(classifyRendererError(new Error('invalid response'))).toBe('invalid')
    expect(classifyRendererError(new Error('runtime unavailable'))).toBe('unavailable')
  })

  it('drops unsafe method and field values instead of recording their contents', () => {
    recordRendererRpc('get_settings?token=secret')
    recordRendererDiagnostic('catalog-search', {
      status: 'ok',
      method: 'bad method with session body',
      section: 'not-a-section',
      count: 'session-body',
      durationMs: 'https://example.test/token=secret',
    } as never)

    const snapshot = rendererDiagnosticSnapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot[0]?.message).toBe('rpc')
    expect(snapshot[1]?.message).toBe('catalog-search status=ok')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(JSON.stringify(snapshot)).not.toContain('session body')
  })
})
