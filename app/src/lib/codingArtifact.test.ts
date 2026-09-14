// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  buildArtifactHTMLDocument,
  isArtifactPathSafe,
  suggestedArtifactPaths,
} from '@/lib/codingArtifact'
import type { CodingEnvironmentSnapshot } from '@/codingEnvironmentTypes'

function snapshotWithArtifacts(artifacts: string[]): CodingEnvironmentSnapshot {
  return {
    workspace: '/tmp/project',
    workspaceName: 'project',
    capturedAt: '2026-08-02T00:00:00Z',
    git: {
      available: true,
      isRepository: true,
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      staged: 0,
      modified: 0,
      untracked: 0,
      conflicts: 0,
      additions: 0,
      deletions: 0,
      dirty: false,
      changes: [],
    },
    artifacts,
  }
}

describe('Coding artifact previews', () => {
  // Which paths are worth offering is the desktop runtime's answer, because only
  // it can see ignored output directories and workspaces outside Git.
  it('offers the deliverables the desktop runtime discovered', () => {
    const environment = snapshotWithArtifacts([
      'report.md',
      'out/site/index.HTML',
      'capture.png',
      'report.md',
    ])
    expect(suggestedArtifactPaths(environment)).toEqual([
      'report.md',
      'out/site/index.HTML',
      'capture.png',
    ])
    expect(suggestedArtifactPaths(null)).toEqual([])
  })

  it('does not suggest unsafe artifact paths even when the runtime listed them', () => {
    const environment = snapshotWithArtifacts([
      '../outside.md',
      '/tmp/outside.html',
      'nested/../../outside.png',
      'nested\\..\\outside.jpg',
      'safe/result.webp',
    ])

    expect(suggestedArtifactPaths(environment)).toEqual(['safe/result.webp'])
    expect(isArtifactPathSafe('../outside.md')).toBe(false)
    expect(isArtifactPathSafe('/tmp/outside.html')).toBe(false)
    expect(isArtifactPathSafe('nested\\..\\outside.jpg')).toBe(false)
    expect(isArtifactPathSafe('nested/../../outside.png')).toBe(false)
    // The preview gate is path safety only: the desktop runtime decides what it
    // can render, so a source file is previewable even if it is never a chip.
    expect(isArtifactPathSafe('src/main.go')).toBe(true)
    expect(isArtifactPathSafe('diagram.svg')).toBe(true)
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
