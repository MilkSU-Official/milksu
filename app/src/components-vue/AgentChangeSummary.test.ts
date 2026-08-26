// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AgentChangeSummary from './AgentChangeSummary.vue'
import type { CodingGitChange } from '@/codingEnvironmentTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

const sampleChange: CodingGitChange = {
  path: 'app/src/components-vue/ChatComposer.vue',
  indexStatus: ' ',
  worktreeStatus: 'M',
  staged: false,
  modified: true,
  untracked: false,
  conflict: false,
  additions: 18,
  deletions: 4,
}

async function mountSummary(changes: CodingGitChange[] = [sampleChange]) {
  const host = document.createElement('div')
  document.body.append(host)
  const opened: Array<string | undefined> = []
  const app = createApp(AgentChangeSummary, {
    summary: {
      changedFiles: 22,
      additions: 442,
      deletions: 226,
      changes,
    },
    onOpenChanges: (path?: string) => opened.push(path),
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, opened }
}

describe('AgentChangeSummary', () => {
  it('stays on one capsule until click expands the changed files', async () => {
    const { host } = await mountSummary()
    const root = host.querySelector<HTMLElement>('[data-testid="agent-change-summary"]')
    const head = root?.querySelector<HTMLButtonElement>('[aria-label="查看代码变更"]')
    expect(root).not.toBeNull()
    expect(root?.textContent).toContain('22 个文件已更改')
    expect(root?.textContent).toContain('+442')
    expect(root?.textContent).toContain('-226')
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('false')

    root?.dispatchEvent(new Event('mouseenter'))
    await nextTick()
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('true')

    head?.click()
    await nextTick()
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('false')
    head?.click()
    await nextTick()
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('true')
    expect(root?.textContent).toContain('ChatComposer.vue')
    expect(root?.textContent).toContain('+18')
    expect(root?.textContent).toContain('-4')

    head?.click()
    await nextTick()
    expect(root?.querySelector('.agent-task-rows__more')?.getAttribute('data-open')).toBe('false')
  })

  it('opens a file from an expanded row without opening on the capsule click', async () => {
    const { host, opened } = await mountSummary()
    host.querySelector<HTMLButtonElement>('[aria-label="查看代码变更"]')?.click()
    await nextTick()

    host.querySelector<HTMLButtonElement>(
      '[aria-label="在变更中打开 app/src/components-vue/ChatComposer.vue"]',
    )?.click()
    expect(opened).toEqual([
      'app/src/components-vue/ChatComposer.vue',
    ])
  })

  it('keeps the hover panel in a bounded scroller instead of growing with every file', async () => {
    const many = Array.from({ length: 72 }, (_, index) => ({
      ...sampleChange,
      path: `src/file-${index + 1}.ts`,
    }))
    const { host } = await mountSummary(many)
    const root = host.querySelector<HTMLElement>('[data-testid="agent-change-summary"]')
    root?.dispatchEvent(new Event('mouseenter'))
    await nextTick()
    const panel = root?.querySelector<HTMLElement>('.agent-task-rows__more')
    expect(panel?.getAttribute('data-open')).toBe('true')
    expect(panel?.querySelectorAll('.agent-diff-chip')).toHaveLength(72)
  })

  it('renders nothing without a dirty Git summary', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(AgentChangeSummary, { summary: undefined })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.querySelector('[data-testid="agent-change-summary"]')).toBeNull()
  })
})
