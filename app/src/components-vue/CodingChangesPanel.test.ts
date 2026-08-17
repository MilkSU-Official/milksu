// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingChangesPanel from './CodingChangesPanel.vue'
import type { CodingEnvironmentSnapshot } from '@/codingEnvironmentTypes'

const mountedApps: App[] = []

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  delete (window as unknown as { go?: unknown }).go
  vi.unstubAllGlobals()
})

function cleanEnvironment(overrides: Partial<CodingEnvironmentSnapshot['git']> = {}): CodingEnvironmentSnapshot {
  return {
    workspace: '/workspace',
    workspaceName: 'milksu',
    capturedAt: '2026-08-02T12:00:00Z',
    git: {
      available: true,
      isRepository: true,
      branch: 'codex/self-hosting',
      upstream: 'origin/codex/self-hosting',
      head: '0123456789ab',
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
      ...overrides,
    },
  }
}

async function mountChangesPanel(
  environment: CodingEnvironmentSnapshot,
  focusPath = '',
  options: { desktopRuntime?: boolean } = {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  if (options.desktopRuntime !== false && (
    options.desktopRuntime
    || environment.git.isRepository
    || (environment.git.changes?.length ?? 0) > 0
    || focusPath
  )) {
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          GetCodingDiff: async (path: string) => ({
            path,
            staged: '',
            workingTree: '@@ -1 +1 @@\n-old\n+new\n',
            truncated: false,
          }),
        },
      },
    }
  }
  Element.prototype.scrollIntoView = vi.fn()
  const app = createApp(CodingChangesPanel, {
    workspacePath: '/workspace',
    environment,
    focusPath,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('CodingChangesPanel PR-style file list', () => {
  it('focuses a file requested from the Composer change hover card', async () => {
    const path = 'app/src/App.vue'
    const host = await mountChangesPanel(cleanEnvironment({
      dirty: true,
      changedFiles: 1,
      modified: 1,
      additions: 6,
      deletions: 2,
      changes: [{
        path,
        indexStatus: ' ',
        worktreeStatus: 'M',
        staged: false,
        modified: true,
        untracked: false,
        conflict: false,
        additions: 6,
        deletions: 2,
      }],
    }), path)
    await settle()

    const card = host.querySelector<HTMLElement>(`[data-change-path="${path}"]`)
    expect(card).not.toBeNull()
    expect(card?.className).toContain('ring-1')
    expect(card?.textContent).toContain(path)
  })

  it('labels the panel as 变更 and lists file diffs without delivery chrome', async () => {
    const host = await mountChangesPanel(cleanEnvironment({
      dirty: true,
      changedFiles: 2,
      modified: 2,
      additions: 12,
      deletions: 3,
      changes: [
        {
          path: 'app/src/App.vue',
          indexStatus: ' ',
          worktreeStatus: 'M',
          staged: false,
          modified: true,
          untracked: false,
          conflict: false,
        },
        {
          path: 'app/src/types.ts',
          indexStatus: ' ',
          worktreeStatus: 'M',
          staged: false,
          modified: true,
          untracked: false,
          conflict: false,
        },
      ],
    }))
    await settle()

    expect(host.textContent).toContain('变更')
    expect(host.textContent).toContain('2 文件')
    expect(host.textContent).toContain('app/src/App.vue')
    expect(host.textContent).toContain('app/src/types.ts')
    expect(host.querySelector('[data-change-path="app/src/App.vue"]')).not.toBeNull()
    expect(host.textContent).not.toContain('下一步')
    expect(host.textContent).not.toContain('Gate')
    expect(host.textContent).not.toContain('交付')
    expect(host.textContent).not.toContain('摘要')
    expect(host.textContent).not.toContain('复制 PR 验收')
    expect(host.textContent).not.toContain('准备 PR')
    expect(host.querySelector('[aria-label="Git 交付下一步"]')).toBeNull()
  })

  it('explains browser-preview limits without delivery checklist chrome', async () => {
    const host = await mountChangesPanel(cleanEnvironment({
      available: false,
      isRepository: false,
      problem: 'Git 状态只在 MilkSU 桌面运行时读取。',
    }), '', { desktopRuntime: false })

    expect(host.textContent).toContain('浏览器预览不能读取 Git 状态')
    expect(host.textContent).toContain('打包后的 MilkSU App')
    expect(host.textContent).toContain('重新读取 Git 状态')
    expect(host.textContent).not.toContain('复制 PR 验收')
    expect(host.textContent).not.toContain('Git 交付摘要')
    expect(host.textContent).not.toContain('准备 PR')
  })

  it('keeps desktop-runtime non-repository problems distinct from browser preview', async () => {
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {},
      },
    }
    const host = await mountChangesPanel(cleanEnvironment({
      available: true,
      isRepository: false,
      problem: '当前目录不是 Git 仓库。',
    }))

    expect(host.textContent).toContain('当前目录没有可显示的变更')
    expect(host.textContent).toContain('当前目录不是 Git 仓库。')
    expect(host.textContent).not.toContain('浏览器预览不能读取 Git 状态')
  })

  it('shows a clean empty state when the worktree has no uncommitted changes', async () => {
    const host = await mountChangesPanel(cleanEnvironment())
    await settle()

    expect(host.textContent).toContain('变更')
    expect(host.textContent).toContain('工作区没有未提交变更')
    expect(host.textContent).toContain('codex/self-hosting')
    expect(host.textContent).not.toContain('下一步')
    expect(host.textContent).not.toContain('复制交付摘要')
  })

  it('loads unified diffs for listed files in read-only PR style', async () => {
    const host = await mountChangesPanel(cleanEnvironment({
      dirty: true,
      changedFiles: 1,
      modified: 1,
      additions: 1,
      deletions: 1,
      changes: [{
        path: 'README.md',
        indexStatus: ' ',
        worktreeStatus: 'M',
        staged: false,
        modified: true,
        untracked: false,
        conflict: false,
      }],
    }))
    await settle()

    expect(host.textContent).toContain('README.md')
    expect(host.textContent).toContain('-old')
    expect(host.textContent).toContain('+new')
    expect(host.textContent).not.toContain('暂存此块')
    expect(host.textContent).not.toContain('取消暂存')
  })
})
