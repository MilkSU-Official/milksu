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
  vi.unstubAllGlobals()
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
    changes: [
      {
        path: 'docs/report.md',
        indexStatus: ' ',
        worktreeStatus: 'M',
        staged: false,
        modified: true,
        untracked: false,
        conflict: false,
      },
      {
        path: 'preview/result.html',
        indexStatus: '?',
        worktreeStatus: '?',
        staged: false,
        modified: false,
        untracked: true,
        conflict: false,
      },
      {
        path: '../outside.png',
        indexStatus: '?',
        worktreeStatus: '?',
        staged: false,
        modified: false,
        untracked: true,
        conflict: false,
      },
      {
        path: 'src/main.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
        staged: false,
        modified: true,
        untracked: false,
        conflict: false,
      },
    ],
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
  const onCompactContext = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingProductLoopPanel, {
    workspacePath: '/Users/milksu/code/milksu',
    environment: dirtyEnvironment,
    messageCount: 4,
    toolMessageCount: 2,
    running: false,
    resumed: false,
    compacting: false,
    compactedAt: undefined,
    compactionError: '',
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    browserStatus: null,
    computerUseStatus: null,
    onOpenPanel,
    onCompactContext,
    ...overrides,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, onOpenPanel, onCompactContext }
}

describe('CodingProductLoopPanel', () => {
  it('shows product-loop evidence without treating dirty Git as delivered', async () => {
    const { host } = await mountPanel()
    const text = host.textContent ?? ''
    const developerGate = host.querySelector<HTMLDetailsElement>('[aria-label="Coding 开发者验收后台"]')
    const developerSummary = developerGate?.querySelector('summary')

    expect(host.querySelector('[aria-label="Coding 开发者验收"]')).not.toBeNull()
    expect(developerGate).not.toBeNull()
    expect(developerGate?.hasAttribute('open')).toBe(false)
    expect(developerSummary?.textContent).toContain('开发者验收')
    expect(developerSummary?.textContent).toContain('默认折叠')
    expect(developerSummary?.textContent).toContain('普通任务入口保持在下方')
    expect(developerGate?.querySelector('[aria-label="Coding 合并状态"]')).not.toBeNull()
    expect(text).toContain('本轮产品闭环')
    expect(text).toContain('只展示当前证据')
    expect(text).toContain('合并状态')
    expect(text).toContain('待补证明')
    const developerDetails = host.querySelector<HTMLDetailsElement>('[aria-label="Coding 开发者验收详情"]')
    expect(developerDetails).not.toBeNull()
    expect(developerDetails?.hasAttribute('open')).toBe(false)
    expect(text).toContain('还差 4 项')
    expect(text).toContain('核对自动化输出、做一次用户可见验证、验证失败/继续路径、收口 Git 交付')
    expect(host.querySelector('[aria-label="Coding 待补证明"]')).not.toBeNull()
    expect(text).toContain('选择任务与仓库')
    expect(text).toContain('Agent 执行')
    expect(text).toContain('消息存在不等于任务已经完成')
    expect(text).toContain('用户可见验证')
    expect(text).toContain('失败/继续')
    expect(text).toContain('尚未触发中断/失败继续')
    expect(text).toContain('产物预览可检查 2 个')
    expect(text).toContain('docs/report.md')
    expect(text).toContain('preview/result.html')
    expect(text).not.toContain('../outside.png')
    expect(text).toContain('Diff 与 Git 交付')
    expect(text).toContain('3 个文件待审阅/暂存/提交')
    expect(text).toContain('权限：Go / 替我审批')
    expect(text).not.toContain('workspace-auto')
    expect(text).toContain('验收记录')
    expect(text).toContain('用户验收清单')
    expect(text).toContain('1. 确认任务和仓库')
    expect(text).toContain('2. 核对自动化输出')
    expect(text).toContain('不能把任意工具消息算作自动化完成')
    expect(text).toContain('3. 做一次用户可见验证')
    expect(text).toContain('4. 验证失败/继续路径')
    expect(text).toContain('5. 收口 Git 交付')
    expect(text).toContain('打开预览')
    expect(text).toContain('生成恢复点')
    expect(text).toContain('打开变更')
    expect(text).toContain('至少留下一个用户可见证据')
    expect(text).toContain('窄自动化')
    expect(text).toContain('待核对')
    expect(text).toContain('2 条工具记录')
    expect(text).toContain('用户可见验证')
    expect(text).toContain('真实 App 验收')
    expect(text).toContain('未证明')
    expect(text).toContain('当前只有组件/构建证据')
    expect(text).toContain('Computer Use')
    expect(text).toContain('未检测')
    expect(text).toContain('打开 Browser/App 面板检测系统权限')
    expect(text).toContain('Computer Use 快速接入')
    expect(text).not.toContain('推荐小自举任务')
    expect(text).not.toContain('打包 MilkSU App 验收')
    expect(text).not.toContain('未修问题登记')
    expect(text).not.toContain('复制登记格式')
    expect(text).toContain('Git 交付')
    expect(text).toContain('1/6')
    expect(text).toContain('下一步验收动作')
    expect(text).toContain('补用户可见验证')
    expect(text).toContain('已有可预览产物候选')
    expect(host.querySelectorAll('[data-product-loop-state="active"]').length)
      .toBeGreaterThanOrEqual(1)
    expect(host.querySelectorAll('[data-missing-acceptance-state]').length).toBe(4)
    expect(host.querySelector('[aria-label="Coding 待补证明"]')?.textContent)
      .toContain('2. 核对自动化输出')
    expect(host.querySelector('[aria-label="Coding 待补证明"]')?.textContent)
      .toContain('3. 做一次用户可见验证')
    expect(host.querySelector('[aria-label="Coding 待补证明"]')?.textContent)
      .toContain('4. 验证失败/继续路径')
    expect(host.querySelector('[aria-label="Coding 待补证明"]')?.textContent)
      .toContain('5. 收口 Git 交付')
    expect(host.querySelector('[aria-label="Coding 待补证明"]')?.textContent)
      .not.toContain('1. 确认任务和仓库')
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

    expect(host.textContent).toContain('产物预览可检查 2 个')
    expect(host.textContent).toContain('Browser 已接入')
    expect(host.textContent).toContain('Computer Use 已接入')
    expect(host.textContent).toContain('真实 App 验收')
    expect(host.textContent).toContain('可执行')
    expect(host.textContent).toContain('仍需实际截图、DOM、控制台或窗口操作证据')
    expect(host.textContent).toContain('Computer Use')
    expect(host.textContent).toContain('已接入')
    expect(host.textContent).toContain('Preview · PID 123 · Window 456')
    expect(host.textContent).toContain('当前 Git 工作区干净且没有待 push 提交')
  })

  it('does not count committed-but-unpushed work as delivered', async () => {
    const { host } = await mountPanel({
      environment: {
        ...cleanEnvironment,
        git: {
          ...cleanEnvironment.git,
          ahead: 2,
        },
      },
    })

    expect(host.textContent).toContain('本地领先 2 个提交，仍需 push')
    expect(host.textContent).toContain('进行中')
    expect(host.querySelectorAll('[data-product-loop-state="active"]').length)
      .toBeGreaterThanOrEqual(1)
  })

  it('renders and copies a handoff summary for the next Agent', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    const { host } = await mountPanel({
      environment: {
        ...cleanEnvironment,
        git: {
          ...cleanEnvironment.git,
          ahead: 1,
        },
      },
      approvalPolicy: 'full-auto',
    })

    expect(host.textContent).toContain('接力棒摘要')
    expect(host.textContent).toContain('# MilkSU Coding 接力棒')
    expect(host.textContent).toContain('工作区：/Users/milksu/code/milksu')
    expect(host.textContent).toContain('权限：Go / 完全访问')
    expect(host.textContent).not.toContain('权限：go / full-auto')
    expect(host.textContent).toContain('可见验证：产物预览可检查 2 个')
    expect(host.textContent).toContain('docs/report.md、preview/result.html')
    expect(host.textContent).toContain('验收记录：')
    expect(host.textContent).toContain('用户验收清单：')
    expect(host.textContent).toContain('进行中 3. 做一次用户可见验证')
    expect(host.textContent).toContain('合并状态：待补证明')
    expect(host.textContent).toContain('窄自动化：待核对')
    expect(host.textContent).toContain('真实 App 验收：未证明')
    expect(host.textContent).toContain('恢复/继续：待补')
    expect(host.textContent).toContain('本地领先 1 个提交，待 push')
    expect(host.textContent).toContain('下一步：补用户可见验证')

    const copy = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('复制接力棒'))
    copy?.click()
    await Promise.resolve()
    await nextTick()

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('MilkSU Coding 接力棒'))
    expect(host.textContent).toContain('已复制')
  })

  it('opens the concrete validation and delivery panels from the checklist', async () => {
    const { host, onOpenPanel } = await mountPanel()
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]

    buttons.find(button => button.textContent?.includes('产物预览'))?.click()
    buttons.find(button => button.textContent?.includes('Browser / Computer Use'))?.click()
    buttons.find(button => button.textContent?.includes('Git 交付'))?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('artifacts')
    expect(onOpenPanel).toHaveBeenCalledWith('browser')
    expect(onOpenPanel).toHaveBeenCalledWith('changes')
  })

  it('opens concrete panels directly from unfinished acceptance checklist items', async () => {
    const { host, onOpenPanel, onCompactContext } = await mountPanel()
    const checklist = [...host.querySelectorAll<HTMLElement>('[data-acceptance-state]')]

    checklist.find(item => item.textContent?.includes('做一次用户可见验证'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    checklist.find(item => item.textContent?.includes('验证失败/继续路径'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    checklist.find(item => item.textContent?.includes('收口 Git 交付'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('artifacts')
    expect(onCompactContext).toHaveBeenCalledOnce()
    expect(onOpenPanel).toHaveBeenCalledWith('changes')
  })

  it('opens concrete panels directly from the short missing-proof list', async () => {
    const { host, onOpenPanel, onCompactContext } = await mountPanel()
    const missing = [...host.querySelectorAll<HTMLElement>('[data-missing-acceptance-state]')]

    expect(missing).toHaveLength(4)
    missing.find(item => item.textContent?.includes('核对自动化输出'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    missing.find(item => item.textContent?.includes('做一次用户可见验证'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    missing.find(item => item.textContent?.includes('验证失败/继续路径'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    missing.find(item => item.textContent?.includes('收口 Git 交付'))
      ?.querySelector<HTMLButtonElement>('button')
      ?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('terminal')
    expect(onOpenPanel).toHaveBeenCalledWith('artifacts')
    expect(onCompactContext).toHaveBeenCalledOnce()
    expect(onOpenPanel).toHaveBeenCalledWith('changes')
  })

  it('opens the Browser/App panel directly from the Computer Use quick connection card', async () => {
    const { host, onOpenPanel } = await mountPanel()
    const quickCard = host.querySelector<HTMLElement>('[aria-label="Computer Use 快速接入"]')
    const open = [...(quickCard?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => button.textContent?.includes('检测'))

    expect(quickCard?.textContent).toContain('未检测')
    expect(quickCard?.textContent).toContain('打开 Browser/App 面板检测系统权限')
    open?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('browser')
  })

  it('opens the recommended next verification panel when available', async () => {
    const { host, onOpenPanel } = await mountPanel({
      messageCount: 4,
      toolMessageCount: 0,
      environment: {
        ...dirtyEnvironment,
        git: {
          ...dirtyEnvironment.git,
          changes: [],
        },
      },
    })

    expect(host.textContent).toContain('运行测试或构建')
    const open = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '打开')
    open?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('terminal')
  })

  it('does not skip visible validation just because previewable artifacts exist', async () => {
    const { host, onOpenPanel } = await mountPanel()

    expect(host.textContent).toContain('补用户可见验证')
    expect(host.textContent).toContain('已有可预览产物候选')
    const open = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '打开')
    open?.click()
    await nextTick()

    expect(onOpenPanel).toHaveBeenCalledWith('artifacts')
  })

  it('treats an opened artifact preview as visible validation evidence and offers a recovery point action', async () => {
    const { host, onCompactContext } = await mountPanel({
      artifactPreviewEvidence: {
        relativePath: 'preview/result.html',
        kind: 'html',
      },
    })

    expect(host.textContent).toContain('已预览 HTML：preview/result.html')
    expect(host.textContent).toContain('真实 App 验收')
    expect(host.textContent).toContain('已验证')
    expect(host.textContent).toContain('已打开产物预览：preview/result.html')
    expect(host.querySelector('[data-acceptance-state="done"]')?.textContent)
      .toContain('确认任务和仓库')
    expect(host.textContent).toContain('下一步验收动作')
    expect(host.textContent).toContain('验收恢复/继续')
    expect(host.textContent).toContain('生成恢复点')
    expect(host.textContent).toContain('可见验证：产物预览可检查 2 个')
    expect(host.textContent).toContain('已预览 HTML：preview/result.html')

    const compact = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('生成恢复点'))
    compact?.click()
    await nextTick()

    expect(onCompactContext).toHaveBeenCalledOnce()
  })

  it('does not mark the loop merge-ready from clean Git plus messages alone', async () => {
    const { host } = await mountPanel({
      environment: cleanEnvironment,
      resumed: true,
      artifactPreviewEvidence: {
        relativePath: 'preview/result.html',
        kind: 'html',
      },
    })

    expect(host.textContent).toContain('合并状态')
    expect(host.textContent).toContain('待补证明')
    expect(host.textContent).toContain('核对自动化输出')
    expect(host.textContent).toContain('收口 Git 交付')
    expect(host.textContent).toContain('仍未证明本轮实际产生、提交并推送过变更')
    expect(host.textContent).not.toContain('合并就绪')
    expect(host.textContent).not.toContain('当前证据满足这张产品闭环验收清单')
  })

  it('marks Git delivery done only after matching push evidence and a synced clean workspace', async () => {
    const { host } = await mountPanel({
      environment: cleanEnvironment,
      resumed: true,
      artifactPreviewEvidence: {
        relativePath: 'preview/result.html',
        kind: 'html',
      },
      gitDeliveryEvidence: {
        action: 'push',
        branch: 'codex/authorized-learning-foundation',
        upstream: 'origin/codex/authorized-learning-foundation',
        head: 'abc1234',
        capturedAt: '2026-08-04T10:00:00Z',
        message: 'pushed codex/authorized-learning-foundation',
      },
    })

    expect(host.textContent).toContain('已推送当前 HEAD abc1234')
    expect(host.textContent).toContain('工作区干净且没有待 push 提交')
    expect([...host.querySelectorAll('[data-acceptance-state="done"]')]
      .some(item => item.textContent?.includes('5. 收口 Git 交付')))
      .toBe(true)
    expect(host.textContent).toContain('Git 交付')
    expect(host.textContent).toContain('可交付')
  })

  it('does not reuse stale Git delivery evidence for a different HEAD', async () => {
    const { host } = await mountPanel({
      environment: cleanEnvironment,
      resumed: true,
      artifactPreviewEvidence: {
        relativePath: 'preview/result.html',
        kind: 'html',
      },
      gitDeliveryEvidence: {
        action: 'push',
        branch: 'codex/authorized-learning-foundation',
        upstream: 'origin/codex/authorized-learning-foundation',
        head: 'old9999',
        capturedAt: '2026-08-04T10:00:00Z',
        message: 'pushed old head',
      },
    })

    expect(host.textContent).toContain('最近一次 Git 交付证据不匹配当前分支或 HEAD')
    expect([...host.querySelectorAll('[data-acceptance-state="done"]')]
      .some(item => item.textContent?.includes('5. 收口 Git 交付')))
      .toBe(false)
    expect(host.textContent).not.toContain('合并就绪')
  })

  it('does not treat a revealed Browser evidence directory as completed validation', async () => {
    const browserStatus: CodingBrowserStatus = {
      enabled: true,
      conversationId: 'conversation',
      sessionId: 'browser-session',
      phase: 'ready',
      initialUrl: 'http://127.0.0.1:1420',
      pages: [],
    }
    const { host } = await mountPanel({
      browserStatus,
      browserEvidence: {
        path: '.milksu/browser-evidence/browser-session',
      },
    })

    expect(host.textContent).toContain('浏览器证据目录已打开：.milksu/browser-evidence/browser-session')
    expect(host.textContent).toContain('真实 App 验收')
    expect(host.textContent).toContain('待核对')
    expect(host.textContent).toContain('目录存在不等于已完成页面验证')
    expect(host.textContent).toContain('核对截图、DOM、Console 或 Network 记录')
    expect(host.textContent).toContain('下一步验收动作')
    expect(host.textContent).toContain('补用户可见验证')
    expect(host.querySelector('[data-acceptance-state="done"]')?.textContent)
      .not.toContain('做一次用户可见验证')
  })

  it('does not treat a locked Computer Use scope as completed GUI validation', async () => {
    const computerUseStatus: CodingComputerUseStatus = {
      available: true,
      enabled: true,
      phase: 'ready',
      target: {
        name: 'Preview',
        bundleId: 'com.example.preview',
        pid: 123,
        windowId: 456,
        windowTitle: '视觉回归',
      },
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    }
    const { host } = await mountPanel({
      computerUseStatus,
      computerUseEvidence: {
        name: 'Preview',
        bundleId: 'com.example.preview',
        pid: 123,
        windowId: 456,
        windowTitle: '视觉回归',
      },
    })

    expect(host.textContent).toContain('Computer Use Scope 已锁定：Preview · PID 123 · Window 456')
    expect(host.textContent).toContain('真实 App 验收')
    expect(host.textContent).toContain('待操作')
    expect(host.textContent).toContain('已锁定可见 App Scope：Preview · com.example.preview · PID 123 · Window 456')
    expect(host.textContent).toContain('这证明会话边界，不等于已完成 GUI 操作')
    expect(host.textContent).toContain('仍需一次真实窗口操作证据')
    expect(host.textContent).toContain('下一步验收动作')
    expect(host.textContent).toContain('补用户可见验证')
    expect(host.querySelector('[data-acceptance-state="done"]')?.textContent)
      .not.toContain('做一次用户可见验证')
  })

  it('treats a completed Computer Use operation envelope as visible App validation', async () => {
    const { host } = await mountPanel({
      computerUseOperationEvidence: {
        action: 'click',
        targetName: 'TextEdit',
        bundleId: 'com.apple.TextEdit',
        pid: 789,
        windowId: 321,
        windowTitle: 'Untitled',
        durationMs: 54,
        summary: 'click · TextEdit · com.apple.TextEdit · PID 789 · Window 321 · Untitled',
      },
    })

    expect(host.textContent).toContain('Computer Use 已执行：click · TextEdit')
    expect(host.textContent).toContain('真实 App 验收')
    expect(host.textContent).toContain('已验证')
    expect(host.textContent).toContain('已完成 Computer Use click：TextEdit · com.apple.TextEdit · PID 789 · Window 321')
    expect([...host.querySelectorAll('[data-acceptance-state="done"]')]
      .some(item => item.textContent?.includes('做一次用户可见验证')))
      .toBe(true)
    expect(host.textContent).toContain('下一步验收动作')
    expect(host.textContent).toContain('验收恢复/继续')
  })

  it('marks resumed sessions as recovery evidence', async () => {
    const { host } = await mountPanel({
      resumed: true,
    })

    expect(host.textContent).toContain('失败/继续')
    expect(host.textContent).toContain('本会话已从恢复点继续')
    expect(host.textContent).toContain('2/6')
  })

  it('shows a compacted context as a recovery point without pretending resume was proven', async () => {
    const compactedAt = new Date('2026-08-04T08:30:00Z').getTime()
    const { host } = await mountPanel({
      compactedAt,
      artifactPreviewEvidence: {
        relativePath: 'docs/report.md',
        kind: 'markdown',
      },
    })

    expect(host.textContent).toContain('失败/继续')
    expect(host.textContent).toContain('已生成上下文恢复点')
    expect(host.textContent).toContain('还需实际继续一次来证明不会重复已完成步骤')
    expect(host.textContent).toContain('进行中')
    expect(host.textContent).toContain('下一步验收动作')
    expect(host.textContent).toContain('收口 Git 交付')
  })

  it('surfaces compaction failure as a recovery blocker', async () => {
    const { host } = await mountPanel({
      compactionError: 'token budget exceeded',
    })

    expect(host.textContent).toContain('上下文压缩失败：token budget exceeded')
    expect(host.querySelectorAll('[data-product-loop-state="blocked"]').length)
      .toBeGreaterThanOrEqual(1)
  })
})
