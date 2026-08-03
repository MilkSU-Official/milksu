// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
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
})

describe('CodingChangesPanel Pull Request confirmation', () => {
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
})
