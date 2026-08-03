// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingArtifactPreviewPanel from './CodingArtifactPreviewPanel.vue'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const htmlPreview: CodingArtifactPreview = {
  relativePath: 'site/index.html',
  kind: 'html',
  mediaType: 'text/html; charset=utf-8',
  content: '<main><h1>Agent report</h1><script>fetch("https://leak.invalid")</script></main>',
  sizeBytes: 2048,
}

const invokeCommand = vi.fn(async (command: string, args?: unknown) => {
  if (command === 'get_coding_artifact_preview') return htmlPreview
  throw new Error(`unexpected command ${command}: ${JSON.stringify(args)}`)
})

vi.mock('@/desktop', () => ({
  invokeCommand: (...args: unknown[]) => invokeCommand(...args as [string, unknown?]),
}))

const mountedApps: App[] = []

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  invokeCommand.mockClear()
})

const environment: CodingEnvironmentSnapshot = {
  workspace: '/Users/milksu/code/milksu',
  workspaceName: 'milksu',
  capturedAt: '2026-08-03T12:00:00Z',
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
      { path: 'docs/report.md', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
      { path: 'site/index.html', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
      { path: 'assets/result.png', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
      { path: '../outside.html', indexStatus: ' ', worktreeStatus: 'M', staged: false, modified: true, untracked: false, conflict: false },
    ],
  },
}

async function mountPanel(overrides: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingArtifactPreviewPanel, {
    workspacePath: '/Users/milksu/code/milksu',
    environment,
    ...overrides,
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return host
}

describe('CodingArtifactPreviewPanel', () => {
  it('suggests safe changed artifacts and renders HTML through a sandboxed preview', async () => {
    const host = await mountPanel()
    const text = host.textContent ?? ''
    expect(text).toContain('docs/report.md')
    expect(text).toContain('site/index.html')
    expect(text).toContain('assets/result.png')
    expect(text).not.toContain('../outside.html')
    expect(text).toContain('HTML 会移除活动内容')
    expect(text).toContain('无脚本、无网络')

    const htmlSuggestion = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('site/index.html'))
    expect(htmlSuggestion).toBeDefined()
    htmlSuggestion!.click()
    await settle()

    expect(invokeCommand).toHaveBeenCalledWith(
      'get_coding_artifact_preview',
      {
        workspacePath: '/Users/milksu/code/milksu',
        relativePath: 'site/index.html',
      },
    )
    expect(host.textContent).toContain('site/index.html')
    expect(host.textContent).toContain('HTML')
    expect(host.textContent).toContain('2.0 KiB')
    const iframe = host.querySelector<HTMLIFrameElement>(
      'iframe[title="Coding HTML 产物预览"]',
    )
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('')
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(iframe?.getAttribute('srcdoc')).not.toContain('<script>')
    expect(iframe?.getAttribute('srcdoc')).toContain('Agent report')
  })
})
