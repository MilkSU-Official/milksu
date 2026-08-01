import { describe, expect, it } from 'vitest'
import {
  codingProductAction,
  codingProductActions,
} from '@/lib/codingProductActions'

describe('Coding product actions', () => {
  it('exposes the five daily Coding actions without asking for workflow parameters', () => {
    expect(codingProductActions().map(action => action.kind)).toEqual([
      'understand',
      'test',
      'review',
      'fix',
      'summary',
    ])
    for (const action of codingProductActions()) {
      expect(action.prompt).toContain('Do not ask about internal strategy')
      expect(action.prompt).toContain('direct tool evidence')
      expect(action.visibleText).toBe(action.label)
    }
  })

  it('keeps read-only actions in Plan and mutations in Project Auto', () => {
    for (const kind of ['understand', 'review', 'summary'] as const) {
      expect(codingProductAction(kind).executionMode).toBe('plan')
    }
    for (const kind of ['test', 'fix'] as const) {
      expect(codingProductAction(kind)).toMatchObject({
        executionMode: 'go',
        approvalPolicy: 'workspace-auto',
      })
    }
  })

  it('requires review findings to be source-backed and fix to reproduce first', () => {
    expect(codingProductAction('review').prompt)
      .toContain('workspace-relative file')
    expect(codingProductAction('review').prompt)
      .toContain('Do not manufacture findings')
    expect(codingProductAction('fix').prompt)
      .toContain('Re-run the smallest')
    expect(codingProductAction('fix').prompt)
      .toContain('no reproducible failure was found')
  })
})
