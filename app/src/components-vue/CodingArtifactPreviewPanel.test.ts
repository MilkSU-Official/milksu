// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingArtifactPreviewPanel from './CodingArtifactPreviewPanel.vue'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const hasDesktopRuntime = vi.fn(() => true)
const invokeCommand = vi.fn(async (command: string, args?: unknown) => {
  if (command === 'get_coding_artifact_preview') {
    const relativePath = (args as { relativePath?: string } | undefined)?.relativePath
    if (relativePath === 'docs/report.md') {
      return {
        relativePath,
        kind: 'markdown',
        mediaType: 'text/markdown; charset=utf-8',
        content: '# Agent report\n\n- verified markdown\n- OPENAI_API_KEY=sk-artifact-secret12345',
        sizeBytes: 35,
      } satisfies CodingArtifactPreview
    }
    if (relativePath === 'site/index.html') {
      return {
        relativePath,
        kind: 'html',
        mediaType: 'text/html; charset=utf-8',
        content: '<main><h1>Agent report</h1><p>Bearer artifact-token-12345</p><script>fetch("https://leak.invalid")</script></main>',
        sizeBytes: 2048,
      } satisfies CodingArtifactPreview
    }
    if (relativePath === 'assets/result.png') {
      return {
        relativePath,
        kind: 'image',
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        sizeBytes: 12,
      } satisfies CodingArtifactPreview
    }
    throw new Error('artifact preview escapes the Coding workspace')
  }
  throw new Error(`unexpected command ${command}: ${JSON.stringify(args)}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => hasDesktopRuntime(),
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
  hasDesktopRuntime.mockReturnValue(true)
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
  const onPreviewed = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingArtifactPreviewPanel, {
    workspacePath: '/Users/milksu/code/milksu',
    environment,
    onPreviewed,
    ...overrides,
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return { host, onPreviewed }
}

describe('CodingArtifactPreviewPanel', () => {
  it('suggests safe changed artifacts and renders HTML through a sandboxed preview', async () => {
    const { host, onPreviewed } = await mountPanel()
    const text = host.textContent ?? ''
    expect(text).toContain('docs/report.md')
    expect(text).toContain('site/index.html')
    expect(text).toContain('assets/result.png')
    expect(text).not.toContain('../outside.html')
    expect(text).toContain('下一步')
    expect(text).toContain('预览第一个候选产物')
    expect(text).toContain('3 个可预览候选')
    expect(text).toContain('预览候选')
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
    expect(host.textContent).toContain('把当前预览作为用户可见证据')
    expect(host.textContent).toContain('如需真实交互，再补 Browser 或 Computer Use 证据')
    const iframe = host.querySelector<HTMLIFrameElement>(
      'iframe[title="Coding HTML 产物预览"]',
    )
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('')
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(iframe?.getAttribute('srcdoc')).not.toContain('<script>')
    expect(iframe?.getAttribute('srcdoc')).toContain('Agent report')
    expect(iframe?.getAttribute('srcdoc')).toContain('Bearer [credential redacted]')
    expect(iframe?.getAttribute('srcdoc')).not.toContain('artifact-token-12345')
    expect(onPreviewed).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'site/index.html',
      kind: 'html',
    }))
  })

  it('renders Markdown and image previews from workspace-relative suggestions', async () => {
    const { host, onPreviewed } = await mountPanel()

    const markdownSuggestion = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('docs/report.md'))
    markdownSuggestion!.click()
    await settle()
    expect(invokeCommand).toHaveBeenLastCalledWith(
      'get_coding_artifact_preview',
      {
        workspacePath: '/Users/milksu/code/milksu',
        relativePath: 'docs/report.md',
      },
    )
    expect(host.textContent).toContain('Markdown')
    expect(host.textContent).toContain('Agent report')
    expect(host.textContent).toContain('verified markdown')
    expect(host.textContent).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(host.textContent).not.toContain('sk-artifact-secret12345')
    expect(onPreviewed).toHaveBeenLastCalledWith(expect.objectContaining({
      relativePath: 'docs/report.md',
      kind: 'markdown',
    }))

    const imageSuggestion = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('assets/result.png'))
    imageSuggestion!.click()
    await settle()
    expect(invokeCommand).toHaveBeenLastCalledWith(
      'get_coding_artifact_preview',
      {
        workspacePath: '/Users/milksu/code/milksu',
        relativePath: 'assets/result.png',
      },
    )
    const image = host.querySelector<HTMLImageElement>('img[alt="assets/result.png"]')
    expect(host.textContent).toContain('图片')
    expect(host.textContent).toContain('12 B')
    expect(image?.src).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(onPreviewed).toHaveBeenLastCalledWith(expect.objectContaining({
      relativePath: 'assets/result.png',
      kind: 'image',
    }))
  })

  it('rejects unsafe or unsupported manual paths before calling the backend', async () => {
    const { host } = await mountPanel()
    const htmlSuggestion = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('site/index.html'))
    htmlSuggestion!.click()
    await settle()
    expect(host.textContent).toContain('site/index.html')

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="工作区产物相对路径"]',
    )
    const form = host.querySelector('form')
    if (!input || !form) throw new Error('missing artifact preview form')
    input.value = '../outside.md'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(invokeCommand).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('请输入工作区内支持的 Markdown、HTML、PNG、JPEG、GIF 或 WebP 相对路径')
    expect(host.querySelector('iframe[title="Coding HTML 产物预览"]')).toBeNull()
    expect(host.textContent).toContain('预览 Agent 交付的普通产物')

    input.value = 'notes.txt'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(invokeCommand).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('请输入工作区内支持的 Markdown、HTML、PNG、JPEG、GIF 或 WebP 相对路径')
  })

  it('explains browser-preview limitations without faking workspace artifact contents', async () => {
    hasDesktopRuntime.mockReturnValue(false)
    const { host, onPreviewed } = await mountPanel()

    expect(host.textContent).toContain('当前是浏览器预览')
    expect(host.textContent).toContain('真实读取工作区产物需要 MilkSU 桌面运行时')
    expect(host.textContent).toContain('打开桌面 App 验收产物')
    expect(host.textContent).toContain('桌面 App 中验收')

    const markdownSuggestion = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('docs/report.md'))
    markdownSuggestion?.click()
    await settle()

    expect(invokeCommand).not.toHaveBeenCalled()
    expect(onPreviewed).not.toHaveBeenCalled()
    expect(host.textContent).toContain('浏览器预览不能读取工作区文件')
    expect(host.textContent).toContain('打包后的 MilkSU App')
    expect(host.textContent).not.toContain('verified markdown')
  })
})
