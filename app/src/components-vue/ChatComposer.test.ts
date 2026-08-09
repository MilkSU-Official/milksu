// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChatComposer from './ChatComposer.vue'
import composerControlsSource from './CodingComposerControls.vue?raw'
import type { CodingGoalState } from '@/types'

const mountedApps: App[] = []

function mountComposer(overrides: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const sent: unknown[][] = []
  let consumedGoals = 0
  let startedGoals = 0
  const controlledGoals: string[] = []
  const app = createApp(ChatComposer, {
    running: false,
    aborting: false,
    ctfSession: false,
    goalMode: false,
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    approvalLabel: '替我审批',
    modelKey: 'auto',
    automaticModelLabel: '自动 · DeepSeek · DeepSeek V4 Flash',
    compactModelLabel: 'V4 Flash',
    onSend: (...args: unknown[]) => sent.push(args),
    onConsumeGoal: () => {
      consumedGoals += 1
    },
    onStartGoal: () => {
      startedGoals += 1
    },
    onControlGoal: (action: string) => {
      controlledGoals.push(action)
    },
    ...overrides,
  })
  const vm = app.mount(host) as unknown as { appendDraftText: (text: string) => void }
  mountedApps.push(app)
  return {
    host,
    vm,
    sent,
    consumedGoals: () => consumedGoals,
    startedGoals: () => startedGoals,
    controlledGoals,
  }
}

const activeGoal: CodingGoalState = {
  id: 'goal-1',
  text: '完成 M4 自举链路并保留验证证据',
  status: 'active',
  startedAt: 1,
  updatedAt: 2,
  iteration: 4,
  tokenBudget: 100_000,
  tokensUsed: 12_500,
  timeUsedSeconds: 300,
  automaticModelTurns: 4,
  queuedCount: 0,
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('ChatComposer', () => {
  it('keeps only mode, permission, and model controls in the Coding composer', async () => {
    const { host } = mountComposer()
    await nextTick()

    expect(host.querySelectorAll('[aria-label="Coding 执行模式"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="Coding 权限策略"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="选择本任务模型"]')).toHaveLength(1)
    expect(host.querySelector('[aria-label="添加文件或图片"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="消息"]')?.getAttribute('placeholder') ?? '')
      .toBe('描述你想让 MilkSU 完成的任务')
    expect(host.querySelector('[aria-label="消息"]')?.hasAttribute('aria-controls')).toBe(false)
    expect(host.textContent).not.toContain('架构图')
    expect(host.textContent).not.toContain('能力')
    expect(host.textContent).not.toContain('目标')
  })

  it('keeps the three bottom choosers on one hover language and shows full approval labels', async () => {
    const { host } = mountComposer()
    await nextTick()

    const mode = host.querySelector('[aria-label="Coding 执行模式"]')
    const permission = host.querySelector('[aria-label="Coding 权限策略"]')
    const model = host.querySelector('[aria-label="选择本任务模型"]')
    expect(mode?.className).toContain('composer-control')
    expect(mode?.className).toContain('composer-mode')
    expect(permission?.className).toContain('composer-control')
    expect(permission?.className).toContain('composer-permission')
    expect(model?.className).toContain('composer-control')
    expect(model?.className).toContain('composer-model')
    expect(permission?.textContent ?? '').toContain('替我审批')
    expect(permission?.textContent ?? '').not.toContain('替我…')
    expect(permission?.getAttribute('title')).toBe('替我审批')

    expect(composerControlsSource).toContain('background-color: var(--btn-ghost-hover) !important;')
    expect(composerControlsSource).toContain('min-width: 7.75rem;')
    expect(composerControlsSource).toContain('.composer-permission__label')
    expect(composerControlsSource).toContain('overflow: visible')
    expect(composerControlsSource).toContain('width: auto;')
    expect(composerControlsSource).not.toMatch(/(?:^|\n)\.composer-permission \{[\s\S]*?\n\s*width: 7\.5rem;/)
  })

  it('submits a goal without exposing goal controls in the Composer', async () => {
    const result = mountComposer({ goalMode: true })
    await nextTick()

    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    expect(textarea).not.toBeNull()
    if (!textarea) return
    textarea.value = '完成发布回归'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([
      ['/goal 完成发布回归', '完成发布回归', []],
    ])
    expect(result.consumedGoals()).toBe(1)
  })

  it('opens an accessible slash menu and selects Goal without sending slash text', async () => {
    const result = mountComposer()
    await nextTick()

    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    expect(textarea).not.toBeNull()
    if (!textarea) return
    textarea.value = '/'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const menu = result.host.querySelector('[role="listbox"][aria-label="斜杠命令"]')
    const goal = result.host.querySelector<HTMLButtonElement>(
      '#coding-slash-command-goal[role="option"]',
    )
    expect(menu).not.toBeNull()
    expect(goal?.textContent).toContain('目标')
    expect(goal?.textContent).toContain('设置要持续追求的目标')
    expect(goal?.getAttribute('aria-selected')).toBe('true')
    expect(textarea.getAttribute('aria-expanded')).toBe('true')
    expect(textarea.getAttribute('aria-controls')).toBe('coding-slash-command-menu')
    expect(textarea.getAttribute('aria-activedescendant')).toBe('coding-slash-command-goal')

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(result.startedGoals()).toBe(1)
    expect(result.sent).toEqual([])
    expect(textarea.value).toBe('')
    expect(textarea.getAttribute('aria-expanded')).toBe('false')
    expect(textarea.hasAttribute('aria-controls')).toBe(false)
  })

  it('dismisses the slash menu with Escape and disables a second active goal', async () => {
    const dismissed = mountComposer()
    await nextTick()
    const textarea = dismissed.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    if (!textarea) throw new Error('missing message textarea')
    textarea.value = '/'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(dismissed.host.querySelector('[role="listbox"]')).toBeNull()
    expect(textarea.value).toBe('/')

    const existing = mountComposer({ goal: activeGoal })
    await nextTick()
    const existingTextarea = existing.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    if (!existingTextarea) throw new Error('missing active-goal textarea')
    existingTextarea.value = '/'
    existingTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const disabledGoal = existing.host.querySelector<HTMLButtonElement>(
      '#coding-slash-command-goal',
    )
    expect(disabledGoal?.disabled).toBe(true)
    expect(disabledGoal?.getAttribute('aria-disabled')).toBe('true')
    expect(disabledGoal?.textContent).toContain('当前已有持续目标')
  })

  it('projects real goal and Git status above the composer with goal controls', async () => {
    const active = mountComposer({
      goal: activeGoal,
      gitSummary: {
        changedFiles: 22,
        additions: 442,
        deletions: 226,
      },
    })
    await nextTick()

    const progress = active.host.querySelector('[aria-label="任务进度摘要"]')
    const goalPanel = active.host.querySelector('[aria-label="持续目标"]')
    expect(progress?.textContent).toContain('第 4 轮')
    expect(progress?.textContent).toContain('22 个文件已更改')
    expect(progress?.textContent).toContain('+442')
    expect(progress?.textContent).toContain('-226')
    expect(goalPanel?.textContent).toContain('进行中')
    expect(goalPanel?.textContent).toContain(activeGoal.text)
    expect(goalPanel?.textContent).toContain('12,500 / 100,000 tokens')

    active.host.querySelector<HTMLButtonElement>('[aria-label="暂停目标"]')?.click()
    active.host.querySelector<HTMLButtonElement>('[aria-label="清除当前目标"]')?.click()
    expect(active.controlledGoals).toEqual(['pause', 'clear'])

    const paused = mountComposer({
      goal: { ...activeGoal, status: 'paused' },
    })
    await nextTick()
    paused.host.querySelector<HTMLButtonElement>('[aria-label="继续目标"]')?.click()
    expect(paused.controlledGoals).toEqual(['resume'])
  })

  it('lets a parent append confirmed context into the draft before sending', async () => {
    const result = mountComposer()
    await nextTick()

    result.vm.appendDraftText('参考相关历史：CVE 同步失败曾由缓存过期导致。')
    await nextTick()

    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    expect(textarea?.value).toContain('参考相关历史')

    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([
      ['参考相关历史：CVE 同步失败曾由缓存过期导致。', '参考相关历史：CVE 同步失败曾由缓存过期导致。', []],
    ])
  })

  it('does not submit Enter while the user is confirming IME composition', async () => {
    const result = mountComposer()
    await nextTick()

    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    expect(textarea).not.toBeNull()
    if (!textarea) return
    textarea.value = 'milksu'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    }))
    await nextTick()

    expect(result.sent).toEqual([])
    expect(textarea.value).toBe('milksu')

    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(result.sent).toEqual([])
    await new Promise(resolve => window.setTimeout(resolve, 0))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(result.sent).toEqual([['milksu', 'milksu', []]])
  })

  it('keeps CTF collaboration actions without leaking Coding controls', async () => {
    const { host } = mountComposer({
      ctfSession: true,
      ctfRole: 'solver',
      ctfMode: 'coach',
    })
    await nextTick()

    expect(host.querySelector('[aria-label="Coding 执行模式"]')).toBeNull()
    expect(host.querySelector('[aria-label="Coding 权限策略"]')).toBeNull()
    expect(host.querySelector('[aria-label="选择本任务模型"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="添加文件或图片"]')).toBeNull()
    const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    if (!textarea) throw new Error('missing CTF textarea')
    textarea.value = '/'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(host.querySelector('[aria-label="斜杠命令"]')).toBeNull()
    expect(host.querySelector('[aria-label="CTF 快捷协作"]')?.textContent)
      .toContain('梳理题面')
    expect(host.querySelector('[aria-label="CTF 快捷协作"]')?.textContent)
      .toContain('重新规划')
  })

  it('allows one stop request and shows the pending acknowledgement state', async () => {
    const stopped: unknown[][] = []
    const running = mountComposer({
      running: true,
      onAbort: (...args: unknown[]) => stopped.push(args),
    })
    await nextTick()

    const stop = running.host.querySelector<HTMLButtonElement>('[aria-label="停止 Agent"]')
    expect(stop).not.toBeNull()
    stop?.click()
    expect(stopped).toEqual([[]])

    const aborting = mountComposer({
      running: true,
      aborting: true,
      onAbort: (...args: unknown[]) => stopped.push(args),
    })
    await nextTick()

    const pending = aborting.host.querySelector<HTMLButtonElement>(
      '[aria-label="正在停止 Agent"]',
    )
    expect(pending?.disabled).toBe(true)
    pending?.click()
    expect(stopped).toEqual([[]])
  })
})
