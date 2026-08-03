// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingProductLoopPanel from './CodingProductLoopPanel.vue'
import type {
  CodingBrowserStatus,
  CodingComputerUseStatus,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

const dirtyEnvironment: CodingEnvironmentSnapshot = {
  workspace: '/Users/milksu/code/milksu',
  workspaceName: 'milksu',
  capturedAt: '2026-08-04T00:00:00Z',
  git: {
    available: true,
    isRepository: true,
    branch: 'codex/authorized-learning-foundation',
    head: 'abc1234',
    ahead: 0,
    behind: 0,
    changedFiles: 3,
    staged: 0,
    modified: 2,
    untracked: 1,
    conflicts: 0,
    additions: 10,
    deletions: 2,
    dirty: true,
  },
}

const cleanEnvironment: CodingEnvironmentSnapshot = {
  ...dirtyEnvironment,
  git: {
    ...dirtyEnvironment.git,
    changedFiles: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    additions: 0,
    deletions: 0,
    dirty: false,
  },
}

async function mountPanel(
  overrides: Partial<InstanceType<typeof CodingProductLoopPanel>['$props']> = {},
) {
  const onOpenPanel = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingProductLoopPanel, {
    workspacePath: '/Users/milksu/code/milksu',
    environment: dirtyEnvironment,
    messageCount: 4,
    toolMessageCount: 2,
    running: false,
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    browserStatus: null,
    computerUseStatus: null,
    onOpenPanel,
    ...overrides,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, onOpenPanel }
}

describe('CodingProductLoopPanel', () => {
  it('shows product-loop evidence without treating dirty Git as delivered', async () => {
    const { host } = await mountPanel()
    const text = host.textContent ?? ''

    expect(text).toContain('本轮产品闭环')
    expect(text).toContain('只展示当前证据')
    expect(text).toContain('选择任务与仓库')
    expect(text).toContain('Agent 执行')
    expect(text).toContain('用户可见验证')
    expect(text).toContain('Diff 与 Git 交付')
    expect(text).toContain('3 个文件待审阅/暂存/提交')
    expect(text).toContain('3/5')
    expect(host.querySelectorAll('[data-product-loop-state="active"]').length)
      .toBeGreaterThanOrEqual(1)
  })

  it('recognizes visible Browser or Computer Use validation as in progress', async () => {
    const browserStatus: CodingBrowserStatus = {
      enabled: true,
      conversationId: 'conversation',
      sessionId: 'browser-session',
      phase: 'ready',
      initialUrl: 'http://127.0.0.1:1420',
      pages: [],
    }
    const computerUseStatus: CodingComputerUseStatus = {
      available: true,
      enabled: true,
      phase: 'ready',
      target: {
        name: 'Preview',
        bundleId: 'com.example.preview',
        pid: 123,
        windowId: 456,
      },
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    }

    const { host } = await mountPanel({
      browserStatus,
      computerUseStatus,
      environment: cleanEnvironment,
    })

    expect(host.textContent).toContain('Browser 已接入 · Computer Use 已接入')
    expect(host.textContent).toContain('当前 Git 工作区干净')
  })

  it('opens the concrete validation and delivery panels from the checklist', async () => {
    const { host, onOpenPanel } = await mountPanel()
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]

    buttons.find(button => button.textContent?.includes('产物预览'))?.click()
    buttons.find(button => button.textContent?.includes('Browser/App'))?.click()
    buttons.find(button => button.textContent?.includes('Git 交付'))?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('artifacts')
    expect(onOpenPanel).toHaveBeenCalledWith('browser')
    expect(onOpenPanel).toHaveBeenCalledWith('changes')
  })
})
