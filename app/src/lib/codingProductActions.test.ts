import { describe, expect, it } from 'vitest'
import {
  codingProductAction,
  codingProductActions,
  codingReviewPrompt,
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
    expect(codingProductAction('understand').prompt)
      .toContain('exactly three numbered items')
    expect(codingProductAction('review').prompt)
      .toContain('workspace-relative file')
    expect(codingProductAction('review').prompt)
      .toContain('Do not manufacture findings')
    expect(codingProductAction('fix').prompt)
      .toContain('Re-run the smallest')
    expect(codingProductAction('fix').prompt)
      .toContain('no reproducible failure was found')
  })

  it('injects the desktop Git snapshot and diff into review actions', () => {
    const prompt = codingReviewPrompt(
      codingProductAction('review').prompt,
      {
        workspace: '/tmp/project',
        workspaceName: 'project',
        capturedAt: '2026-08-01T10:00:00Z',
        git: {
          available: true,
          isRepository: true,
          branch: 'main',
          head: 'abc123',
          ahead: 0,
          behind: 0,
          changedFiles: 1,
          staged: 0,
          modified: 1,
          untracked: 0,
          conflicts: 0,
          additions: 1,
          deletions: 1,
          dirty: true,
          changes: [{
            path: 'src/metrics.js',
            indexStatus: ' ',
            worktreeStatus: 'M',
            staged: false,
            modified: true,
            untracked: false,
            conflict: false,
          }],
        },
      },
      [{
        workspace: '/tmp/project',
        path: 'src/metrics.js',
        workingTree: '@@ -1 +1 @@\n-old\n+new',
      }],
    )
    expect(prompt).toContain('[MilkSU trusted Git evidence]')
    expect(prompt).toContain('changed=1')
    expect(prompt).toContain(' M src/metrics.js')
    expect(prompt).toContain('@@ -1 +1 @@')
    expect(prompt).toContain('Do not run shell Git commands')
  })
})
