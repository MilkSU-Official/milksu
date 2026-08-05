// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodingArtifactPreviewWebViewSmoke } from './codingArtifactWebViewSmoke'
import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'

const hasDesktopRuntime = vi.fn(() => true)
const completedReports: unknown[] = []
const invokeCommand = vi.fn(async (command: string, args?: unknown) => {
  if (command === 'get_coding_artifact_preview_webview_smoke_request') {
    return {
      enabled: true,
      workspace: '/tmp/milksu-artifact-smoke',
      relativePath: 'reports/dangerous.html',
    }
  }
  if (command === 'get_coding_artifact_preview') {
    expect(args).toEqual({
      workspacePath: '/tmp/milksu-artifact-smoke',
      relativePath: 'reports/dangerous.html',
    })
    return {
      relativePath: 'reports/dangerous.html',
      kind: 'html',
      mediaType: 'text/html',
      content: [
        '<!doctype html>',
        '<html><head>',
        '<meta http-equiv="refresh" content="0;url=https://artifact-preview-leak.invalid/redirect">',
        '<link rel="stylesheet" href="https://artifact-preview-leak.invalid/style.css">',
        '<script>fetch("https://artifact-preview-leak.invalid")</script>',
        '</head><body onload="window.top.__milksuArtifactPreviewWebViewSmokeMutated=true">',
        '<h1>Dangerous HTML WebView Smoke</h1>',
        '<p>Authorization: Bearer sk-artifact-webview-secret123456789</p>',
        '<a href="https://artifact-preview-leak.invalid/path">external link</a>',
        '<img src="https://artifact-preview-leak.invalid/pixel.png">',
        '<form action="https://artifact-preview-leak.invalid/submit"><input name="secret"></form>',
        '</body></html>',
      ].join(''),
      sizeBytes: 256,
    } satisfies CodingArtifactPreview
  }
  if (command === 'complete_coding_artifact_preview_webview_smoke') {
    completedReports.push(args)
    return undefined
  }
  throw new Error(`unexpected command: ${command}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => hasDesktopRuntime(),
  invokeCommand: (...args: unknown[]) => invokeCommand(...args as [string, unknown?]),
}))

afterEach(() => {
  document.body.innerHTML = ''
  completedReports.length = 0
  invokeCommand.mockClear()
  hasDesktopRuntime.mockReturnValue(true)
})

describe('runCodingArtifactPreviewWebViewSmoke', () => {
  it('uses the real artifact preview command and reports sandbox/CSP sanitizer gates', async () => {
    await runCodingArtifactPreviewWebViewSmoke()

    expect(invokeCommand).toHaveBeenNthCalledWith(
      1,
      'get_coding_artifact_preview_webview_smoke_request',
    )
    expect(invokeCommand).toHaveBeenNthCalledWith(
      2,
      'get_coding_artifact_preview',
      {
        workspacePath: '/tmp/milksu-artifact-smoke',
        relativePath: 'reports/dangerous.html',
      },
    )
    expect(invokeCommand).toHaveBeenNthCalledWith(
      3,
      'complete_coding_artifact_preview_webview_smoke',
      expect.objectContaining({ report: expect.any(Object) }),
    )
    const report = (
      invokeCommand.mock.calls[2][1] as { report: Record<string, unknown> }
    ).report
    expect(report).toMatchObject({
      workspace: '/tmp/milksu-artifact-smoke',
      relativePath: 'reports/dangerous.html',
      kind: 'html',
      mediaType: 'text/html',
      sandboxAttribute: '',
      gates: {
        backendHTMLRead: true,
        iframeSandboxPresent: true,
        iframeSandboxDoesNotAllowScripts: true,
        sanitizerRemovedExecutableElements: true,
        sanitizerRemovedExternalResources: true,
        cspBlocksNetworkAndScripts: true,
        credentialRedacted: true,
        parentNotMutated: true,
      },
    })
    expect(report).not.toHaveProperty('error')
    const serialized = JSON.stringify(completedReports)
    expect(serialized).toContain('[credential redacted]')
    expect(serialized).not.toContain('sk-artifact-webview-secret')
    expect(serialized).not.toContain('artifact-preview-leak.invalid')
    expect(document.querySelector('iframe[title="Coding HTML 产物预览 smoke"]')).toBeNull()
  })

  it('does not run in browser preview mode', async () => {
    hasDesktopRuntime.mockReturnValue(false)
    await runCodingArtifactPreviewWebViewSmoke()
    expect(invokeCommand).not.toHaveBeenCalled()
  })

  it('skips when the packaged smoke request is disabled', async () => {
    invokeCommand.mockImplementationOnce(async () => ({ enabled: false }))
    await runCodingArtifactPreviewWebViewSmoke()
    expect(invokeCommand).toHaveBeenCalledTimes(1)
    expect(completedReports).toHaveLength(0)
  })
})
