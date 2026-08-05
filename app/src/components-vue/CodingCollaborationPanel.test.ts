// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CodingCollaborationPanel from './CodingCollaborationPanel.vue'

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

describe('CodingCollaborationPanel', () => {
  it('prepares explicit writer slots and finishes only after integration', async () => {
    const calls: string[] = []
    const active = {
      schemaVersion: 1,
      conversationId: 'conversation-1',
      workspace: '/workspace',
      baseBranch: 'main',
      baseHead: 'a'.repeat(40),
      phase: 'active',
      active: true,
      canFinish: true,
      worktrees: [{
        id: 'writer-1',
        path: '/runtime/writer-1',
        branch: 'codex/agent-fixture-writer-1',
        baseHead: 'a'.repeat(40),
        head: 'b'.repeat(40),
        dirty: false,
        ahead: 1,
        behind: 0,
        integrated: true,
        available: true,
      }, {
        id: 'writer-2',
        path: '/runtime/writer-2',
        branch: 'codex/agent-fixture-writer-2',
        baseHead: 'a'.repeat(40),
        head: 'c'.repeat(40),
        dirty: false,
        ahead: 1,
        behind: 0,
        integrated: true,
        available: true,
      }],
    }
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          GetCodingCollaboration: async () => ({
            ...active,
            active: false,
            phase: 'completed',
            canFinish: false,
            worktrees: [],
          }),
          PrepareCodingCollaboration: async (
            conversationId: string,
            workspace: string,
            writers: number,
          ) => {
            calls.push(`prepare:${conversationId}:${workspace}:${writers}`)
            return active
          },
          FinishCodingCollaboration: async () => {
            calls.push('finish')
            return {
              ...active,
              active: false,
              phase: 'completed',
              canFinish: false,
            }
          },
        },
      },
    }

    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingCollaborationPanel, {
      conversationId: 'conversation-1',
      workspacePath: '/workspace',
      ensureConversation: () => 'conversation-1',
    })
    app.mount(host)
    mountedApps.push(app)
    await settle()

    const twoWriters = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('2 个 writer'),
    )
    twoWriters?.click()
    await nextTick()
    const prepare = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('准备协作 worktree'),
    )
    prepare?.click()
    await settle()

    expect(calls).toEqual(['prepare:conversation-1:/workspace:2'])
    expect(host.textContent).toContain('codex/agent-fixture-writer-1')
    expect(host.textContent).toContain('已集成')

    const finish = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('安全结束'),
    )
    finish?.click()
    await nextTick()
    const confirm = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('确认安全结束'),
    )
    expect(confirm).not.toBeUndefined()
    expect(calls).toHaveLength(1)
    confirm?.click()
    await settle()
    expect(calls).toEqual([
      'prepare:conversation-1:/workspace:2',
      'finish',
    ])
  })

  it('offers bounded cleanup after worktree preparation is interrupted', async () => {
    const calls: string[] = []
    const interrupted = {
      schemaVersion: 1,
      conversationId: 'conversation-interrupted',
      workspace: '/workspace',
      baseBranch: 'main',
      baseHead: 'a'.repeat(40),
      phase: 'preparing',
      active: false,
      canFinish: true,
      problem: 'Coding collaboration preparation was interrupted',
      worktrees: [{
        id: 'writer-1',
        path: '/runtime/writer-1',
        branch: 'codex/agent-fixture-writer-1',
        baseHead: 'a'.repeat(40),
        head: 'a'.repeat(40),
        dirty: false,
        ahead: 0,
        behind: 0,
        integrated: true,
        available: true,
      }, {
        id: 'writer-2',
        path: '/runtime/writer-2',
        branch: 'codex/agent-fixture-writer-2',
        baseHead: 'a'.repeat(40),
        dirty: false,
        ahead: 0,
        behind: 0,
        integrated: false,
        available: false,
        problem: 'worktree is missing',
      }],
    }
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          GetCodingCollaboration: async () => interrupted,
          FinishCodingCollaboration: async () => {
            calls.push('finish')
            return {
              ...interrupted,
              phase: 'completed',
              canFinish: false,
              problem: '',
            }
          },
        },
      },
    }

    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CodingCollaborationPanel, {
      conversationId: 'conversation-interrupted',
      workspacePath: '/workspace',
      ensureConversation: () => 'conversation-interrupted',
    })
    app.mount(host)
    mountedApps.push(app)
    await settle()

    expect(host.textContent).toContain('需恢复')
    expect(host.textContent).toContain('不会删除冲突的外部分支')
    expect(host.textContent).not.toContain('准备协作 worktree')
    const finish = [...host.querySelectorAll('button')].find(
      button => button.textContent?.includes('安全结束'),
    )
    expect(finish?.hasAttribute('disabled')).toBe(false)
    finish?.click()
    await nextTick()
    const confirm = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.includes('确认安全结束'),
    )
    confirm?.click()
    await settle()
    expect(calls).toEqual(['finish'])
  })
})
