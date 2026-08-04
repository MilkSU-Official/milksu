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

async function mountChangesPanel(environment: CodingEnvironmentSnapshot) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingChangesPanel, {
    workspacePath: '/workspace',
    environment,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('CodingChangesPanel Pull Request confirmation', () => {
  it('explains browser-preview Git delivery limits without pretending the workspace was inspected', async () => {
    const host = await mountChangesPanel(cleanEnvironment({
      available: false,
      isRepository: false,
      problem: 'Git 状态只在 MilkSU 桌面运行时读取。',
    }))

    expect(host.textContent).toContain('浏览器预览不能读取 Git 状态')
    expect(host.textContent).toContain('只能验证 Git 交付面板的文案和入口')
    expect(host.textContent).toContain('真实 Diff/Hunk、stage、commit、push 和 PR')
    expect(host.textContent).toContain('打包后的 MilkSU App')
    expect(host.querySelector('[aria-label="Git 交付下一步"]')).not.toBeNull()
    expect(host.textContent).toContain('打开桌面 App 验收 Git')
    expect(host.textContent).toContain('重新读取 Git 状态')
    expect(host.textContent).toContain('PR 发布验收')
    expect(host.textContent).toContain('Push 只证明 Git 远端同步')
    expect(host.textContent).toContain('复制 PR 验收')
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

    expect(host.textContent).toContain('当前目录不可交付')
    expect(host.textContent).toContain('当前目录不是 Git 仓库。')
    expect(host.textContent).toContain('选择 Git 仓库')
    expect(host.textContent).not.toContain('浏览器预览不能读取 Git 状态')
  })

  it('renders and copies a bounded Git delivery summary', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    const host = await mountChangesPanel(cleanEnvironment())

    expect(host.textContent).toContain('Git 交付摘要')
    expect(host.textContent).toContain('# MilkSU Git 交付摘要')
    expect(host.textContent).toContain('状态：已收口')
    expect(host.textContent).toContain('分支：codex/self-hosting')
    expect(host.textContent).toContain('HEAD：0123456789ab')
    expect(host.textContent).toContain('下一步：可作为本轮 Git 交付证据')
    expect(host.textContent).toContain('PR 发布验收')
    expect(host.textContent).toContain('单独确认')
    expect(host.textContent).toContain('Push 只证明 Git 远端同步')
    expect(host.textContent).toContain('复制 PR 验收')

    const copy = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('复制交付摘要'))
    copy?.click()
    await settle()

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('MilkSU Git 交付摘要'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('状态：已收口'))
    expect(host.textContent).toContain('已复制')
  })

  it('copies a PR publication acceptance checklist without claiming push is enough', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    const host = await mountChangesPanel(cleanEnvironment())

    const copy = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('复制 PR 验收'))
    copy?.click()
    await settle()

    expect(writeText).toHaveBeenCalledOnce()
    const copied = String((writeText.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '')
    expect(copied).toContain('继续 MilkSU Git / PR 交付验收')
    expect(copied).toContain('Git 状态：已收口')
    expect(copied).toContain('分支：codex/self-hosting')
    expect(copied).toContain('点击“准备 PR”')
    expect(copied).toContain('MilkSU-Official/milksu 私有仓库')
    expect(copied).toContain('一次性确认 token 不能出现在 UI、日志、错误或复制文本里')
    expect(copied).toContain('不得向引用的开源项目')
    expect(copied).toContain('创建后读回 PR number、URL、state、draft')
    expect(copied).toContain('不要把 push 当成 PR 已发布')
    expect(copied).toContain('不要读取、输出或迁移 Provider/API Key')
    expect(copied).not.toContain('preview-token')
    expect(host.textContent).toContain('已复制')
  })

  it('keeps committed-but-unpushed work visible in the delivery summary', async () => {
    const host = await mountChangesPanel(cleanEnvironment({ ahead: 2 }))

    expect(host.textContent).toContain('状态：提交待推送')
    expect(host.textContent).toContain('同步：ahead 2 / behind 0')
    expect(host.textContent).toContain('下一步：push 到授权远端')
  })

  it('surfaces the current Git delivery next step without expanding the summary', async () => {
    const dirty = await mountChangesPanel(cleanEnvironment({
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
      ],
    }))

    expect(dirty.querySelector('[aria-label="Git 交付下一步"]')).not.toBeNull()
    expect(dirty.textContent).toContain('审阅 Diff 并暂存')
    expect(dirty.textContent).toContain('2 个文件有变更')
    expect(dirty.textContent).toContain('全部暂存')

    const staged = await mountChangesPanel(cleanEnvironment({
      dirty: true,
      staged: 1,
      changedFiles: 1,
      additions: 4,
      deletions: 1,
      changes: [
        {
          path: 'docs/developer/product-loop-sprint.md',
          indexStatus: 'M',
          worktreeStatus: ' ',
          staged: true,
          modified: false,
          untracked: false,
          conflict: false,
        },
      ],
    }))

    expect(staged.textContent).toContain('提交已暂存变更')
    expect(staged.textContent).toContain('请先填写提交说明')
    expect(staged.textContent).toContain('等待提交说明')

    const pushed = await mountChangesPanel(cleanEnvironment({ ahead: 2 }))
    expect(pushed.textContent).toContain('推送当前分支')
    expect(pushed.textContent).toContain('ahead 2')
    expect(pushed.textContent).toContain('推送 2')

    const clean = await mountChangesPanel(cleanEnvironment())
    expect(clean.textContent).toContain('准备草稿 PR')
    expect(clean.textContent).toContain('工作区干净且已同步')
    expect(clean.textContent).toContain('一次性确认')
  })

  it('previews the immutable target before a separate publish call', async () => {
    const calls: string[] = []
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          PrepareCodingPullRequest: async () => {
            calls.push('prepare')
            return {
              repository: 'MilkSU-Official/milksu',
              repositoryUrl: 'https://github.com/MilkSU-Official/milksu',
              private: true,
              remote: 'origin',
              sourceBranch: 'codex/self-hosting',
              headCommit: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              suggestedTitle: 'feat: self host',
              draft: true,
              confirmationToken: 'preview-token',
              expiresAt: '2026-08-02T12:05:00Z',
            }
          },
          PublishCodingPullRequest: async (
            _workspace: string,
            token: string,
          ) => {
            calls.push(`publish:${token}`)
            return {
              repository: 'MilkSU-Official/milksu',
              sourceBranch: 'codex/self-hosting',
              headCommit: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              number: 42,
              url: 'https://github.com/MilkSU-Official/milksu/pull/42',
              state: 'OPEN',
              draft: true,
              created: true,
              verified: true,
            }
          },
        },
      },
    }
    const environment: CodingEnvironmentSnapshot = {
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
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingChangesPanel, {
      workspacePath: '/workspace',
      environment,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const prepare = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('准备 PR'),
    )
    expect(prepare).not.toBeUndefined()
    prepare?.click()
    await settle()

    expect(calls).toEqual(['prepare'])
    expect(document.body.textContent).toContain('MilkSU-Official/milksu')
    expect(document.body.textContent).toContain('codex/self-hosting')
    expect(document.body.textContent).toContain('0123456789abcdef0123456789abcdef01234567')
    expect(document.body.textContent).toContain('main')
    expect(document.body.textContent).not.toContain('preview-token')

    const confirm = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('确认创建草稿 PR'),
    )
    expect(confirm).not.toBeUndefined()
    expect(calls).toEqual(['prepare'])
    confirm?.click()
    await settle()

    expect(calls).toEqual(['prepare', 'publish:preview-token'])
    expect(document.body.textContent).toContain('已创建并验证草稿 PR #42')
  })

  it('clears the one-time preview when the backend rejects an expired publication', async () => {
    const calls: string[] = []
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          PrepareCodingPullRequest: async () => {
            calls.push('prepare')
            return {
              repository: 'MilkSU-Official/milksu',
              repositoryUrl: 'https://github.com/MilkSU-Official/milksu',
              private: true,
              remote: 'origin',
              sourceBranch: 'codex/self-hosting',
              headCommit: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              suggestedTitle: 'feat: self host',
              draft: true,
              confirmationToken: 'expired-token',
              expiresAt: '2026-08-02T12:05:00Z',
            }
          },
          PublishCodingPullRequest: async (
            _workspace: string,
            token: string,
          ) => {
            calls.push(`publish:${token}`)
            throw new Error('Pull Request preview expired; prepare it again.')
          },
        },
      },
    }
    const environment: CodingEnvironmentSnapshot = {
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
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingChangesPanel, {
      workspacePath: '/workspace',
      environment,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const prepare = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('准备 PR'),
    )
    prepare?.click()
    await settle()
    expect(document.body.textContent).toContain('MilkSU-Official/milksu')

    const confirm = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('确认创建草稿 PR'),
    )
    expect(confirm).not.toBeUndefined()
    confirm?.click()
    await settle()

    expect(calls).toEqual(['prepare', 'publish:expired-token'])
    expect(document.body.textContent).toContain('Pull Request preview expired')
    expect(document.body.textContent).not.toContain('确认创建草稿 PR')
    expect(document.body.textContent).not.toContain('expired-token')
  })

  it('redacts the one-time confirmation token from PR publication errors', async () => {
    const calls: string[] = []
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          PrepareCodingPullRequest: async () => {
            calls.push('prepare')
            return {
              repository: 'MilkSU-Official/milksu',
              repositoryUrl: 'https://github.com/MilkSU-Official/milksu',
              private: true,
              remote: 'origin',
              sourceBranch: 'codex/self-hosting',
              headCommit: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              suggestedTitle: 'feat: self host',
              draft: true,
              confirmationToken: 'preview-token-leaked-by-backend',
              expiresAt: '2026-08-02T12:05:00Z',
            }
          },
          PublishCodingPullRequest: async (
            _workspace: string,
            token: string,
          ) => {
            calls.push(`publish:${token}`)
            throw new Error(`refused token ${token}; prepare again`)
          },
        },
      },
    }
    const environment: CodingEnvironmentSnapshot = {
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
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingChangesPanel, {
      workspacePath: '/workspace',
      environment,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const prepare = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('准备 PR'),
    )
    prepare?.click()
    await settle()
    const confirm = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('确认创建草稿 PR'),
    )
    confirm?.click()
    await settle()

    expect(calls).toEqual(['prepare', 'publish:preview-token-leaked-by-backend'])
    expect(document.body.textContent).toContain('refused token [confirmation token redacted]')
    expect(document.body.textContent).not.toContain('preview-token-leaked-by-backend')
    expect(document.body.textContent).not.toContain('确认创建草稿 PR')
  })

  it('rejects an unauthorized PR preview before showing confirmation', async () => {
    const calls: string[] = []
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          PrepareCodingPullRequest: async () => {
            calls.push('prepare')
            return {
              repository: 'openai/codex',
              repositoryUrl: 'https://github.com/openai/codex',
              private: false,
              remote: 'origin',
              sourceBranch: 'codex/self-hosting',
              headCommit: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              suggestedTitle: 'feat: self host',
              draft: true,
              confirmationToken: 'unauthorized-preview-token',
              expiresAt: '2026-08-02T12:05:00Z',
            }
          },
          PublishCodingPullRequest: async () => {
            calls.push('publish')
            throw new Error('publish should not be called')
          },
        },
      },
    }
    const environment: CodingEnvironmentSnapshot = {
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
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingChangesPanel, {
      workspacePath: '/workspace',
      environment,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const prepare = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('准备 PR'),
    )
    prepare?.click()
    await settle()

    expect(calls).toEqual(['prepare'])
    expect(document.body.textContent).toContain('Pull Request 发布只允许当前授权的 MilkSU 私有仓库')
    expect(document.body.textContent).not.toContain('确认创建草稿 PR')
    expect(document.body.textContent).not.toContain('unauthorized-preview-token')
    expect(document.body.textContent).not.toContain('openai/codex')
  })

  it('clears a previous PR result before showing a newly prepared preview', async () => {
    const calls: string[] = []
    let prepareCount = 0
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          PrepareCodingPullRequest: async () => {
            prepareCount += 1
            calls.push(`prepare:${prepareCount}`)
            return {
              repository: 'MilkSU-Official/milksu',
              repositoryUrl: 'https://github.com/MilkSU-Official/milksu',
              private: true,
              remote: 'origin',
              sourceBranch: `codex/self-hosting-${prepareCount}`,
              headCommit: prepareCount === 1
                ? '0123456789abcdef0123456789abcdef01234567'
                : '1123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              suggestedTitle: `feat: self host ${prepareCount}`,
              draft: true,
              confirmationToken: `preview-token-${prepareCount}`,
              expiresAt: '2026-08-02T12:05:00Z',
            }
          },
          PublishCodingPullRequest: async (
            _workspace: string,
            token: string,
          ) => {
            calls.push(`publish:${token}`)
            return {
              repository: 'MilkSU-Official/milksu',
              sourceBranch: 'codex/self-hosting-1',
              headCommit: '0123456789abcdef0123456789abcdef01234567',
              targetBranch: 'main',
              number: 42,
              url: 'https://github.com/MilkSU-Official/milksu/pull/42',
              state: 'OPEN',
              draft: true,
              created: true,
              verified: true,
            }
          },
        },
      },
    }
    const environment: CodingEnvironmentSnapshot = {
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
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingChangesPanel, {
      workspacePath: '/workspace',
      environment,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const prepare = () => [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('准备 PR'),
    )
    prepare()?.click()
    await settle()
    const confirm = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('确认创建草稿 PR'),
    )
    confirm?.click()
    await settle()
    expect(document.body.textContent).toContain('已创建并验证草稿 PR #42')

    const done = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('完成'),
    )
    done?.click()
    await settle()
    prepare()?.click()
    await settle()

    expect(calls).toEqual([
      'prepare:1',
      'publish:preview-token-1',
      'prepare:2',
    ])
    expect(document.body.textContent).toContain('codex/self-hosting-2')
    expect(document.body.textContent).toContain('1123456789abcdef0123456789abcdef01234567')
    expect(document.body.textContent).not.toContain('已创建并验证草稿 PR #42')
    expect(document.body.textContent).not.toContain('preview-token-2')
  })
})
