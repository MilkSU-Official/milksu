// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  buildArtifactHTMLDocument,
  isPreviewableArtifactPath,
  suggestedArtifactPaths,
} from '@/lib/codingArtifact'
import type { CodingEnvironmentSnapshot } from '@/codingEnvironmentTypes'

describe('Coding artifact previews', () => {
  it('only suggests supported changed artifacts', () => {
    const environment = {
      workspace: '/tmp/project',
      workspaceName: 'project',
      capturedAt: '2026-08-02T00:00:00Z',
      git: {
        available: true,
        isRepository: true,
        ahead: 0,
        behind: 0,
        changedFiles: 4,
        staged: 0,
        modified: 4,
        untracked: 0,
        conflicts: 0,
        additions: 0,
        deletions: 0,
        dirty: true,
        changes: [
          { path: 'report.md', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: 'site/index.HTML', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: 'src/main.go', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: 'capture.png', originalPath: 'old.png', indexStatus: 'R', worktreeStatus: ' ', staged: true, modified: false, untracked: false, conflict: false },
        ],
      },
    } satisfies CodingEnvironmentSnapshot
    expect(suggestedArtifactPaths(environment)).toEqual([
      'report.md',
      'site/index.HTML',
      'capture.png',
    ])
    expect(isPreviewableArtifactPath('diagram.svg')).toBe(false)
  })

  it('does not suggest unsafe artifact paths even when the extension is supported', () => {
    const environment = {
      workspace: '/tmp/project',
      workspaceName: 'project',
      capturedAt: '2026-08-02T00:00:00Z',
      git: {
        available: true,
        isRepository: true,
        ahead: 0,
        behind: 0,
        changedFiles: 5,
        staged: 0,
        modified: 5,
        untracked: 0,
        conflicts: 0,
        additions: 0,
        deletions: 0,
        dirty: true,
        changes: [
          { path: '../outside.md', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: '/tmp/outside.html', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: 'nested/../../outside.png', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: 'nested\\..\\outside.jpg', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
          { path: 'safe/result.webp', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
        ],
      },
    } satisfies CodingEnvironmentSnapshot

    expect(suggestedArtifactPaths(environment)).toEqual(['safe/result.webp'])
    expect(isPreviewableArtifactPath('../outside.md')).toBe(false)
    expect(isPreviewableArtifactPath('/tmp/outside.html')).toBe(false)
    expect(isPreviewableArtifactPath('nested\\..\\outside.jpg')).toBe(false)
  })

  it('removes active content and all external resource attributes from HTML', () => {
    const output = buildArtifactHTMLDocument(`
      <!doctype html>
      <html>
        <head>
          <meta http-equiv="refresh" content="0;url=https://leak.invalid">
          <script>fetch('https://leak.invalid')</script>
          <link rel="stylesheet" href="https://leak.invalid/style.css">
        </head>
        <body onload="alert(1)">
          <a href="https://leak.invalid/path">link</a>
          <img src="https://leak.invalid/image.png">
          <img id="inline" src="data:image/png;base64,iVBORw0KGgo=">
          <iframe src="https://leak.invalid/frame"></iframe>
        </body>
      </html>
    `)
    const document = new DOMParser().parseFromString(output, 'text/html')
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    expect(csp?.getAttribute('content')).toContain("default-src 'none'")
    expect(csp?.getAttribute('content')).toContain("connect-src 'none'")
    expect(document.querySelector('script, iframe, link, meta[http-equiv="refresh"]')).toBeNull()
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(document.querySelector('img:not(#inline)')?.hasAttribute('src')).toBe(false)
    expect(document.querySelector('#inline')?.getAttribute('src')).toMatch(/^data:image\/png/)
    expect(document.body.hasAttribute('onload')).toBe(false)
  })
})
