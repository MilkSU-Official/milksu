// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatComposer from './ChatComposer.vue'
import composerControlsSource from './CodingComposerControls.vue?raw'
import composerSource from './ChatComposer.vue?raw'
import type { CodingGoalState } from '@/types'

const mountedApps: App[] = []

function composerEditor(host: HTMLElement) {
  const editor = host.querySelector<HTMLElement>('[aria-label="消息"]')
  if (!editor) throw new Error('missing message editor')
  return editor
}

function setComposerText(editor: HTMLElement, text: string) {
  const node = document.createTextNode(text)
  editor.replaceChildren(node)
  const range = document.createRange()
  range.setStart(node, text.length)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}

function mountComposer(overrides: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const sent: unknown[][] = []
  let consumedGoals = 0
  let startedGoals = 0
  const controlledGoals: string[] = []
  const executionModes: string[] = []
  const slashCommandActions: string[] = []
  const openedChanges: Array<string | undefined> = []
  const cancelledGuidance: number[] = []
  const editedGuidance: number[] = []
  const app = createApp(ChatComposer, {
    running: false,
    aborting: false,
    ctfSession: false,
    goalMode: false,
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    approvalLabel: '替我审批',
    modelKey: 'auto',
    automaticModelLabel: 'Default · DeepSeek · DeepSeek V4 Flash',
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
    onChangeExecutionMode: (mode: string) => {
      executionModes.push(mode)
    },
    onRunSlashCommand: (command: string) => {
      slashCommandActions.push(command)
    },
    onOpenChanges: (path?: string) => {
      openedChanges.push(path)
    },
    onCancelQueuedGuidance: (index: number) => {
      cancelledGuidance.push(index)
    },
    onEditQueuedGuidance: (index: number) => {
      editedGuidance.push(index)
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
    executionModes,
    slashCommandActions,
    openedChanges: () => openedChanges,
    cancelledGuidance,
    editedGuidance,
    setProp(name: string, value: unknown) {
      if (!app._instance) throw new Error('missing root component instance')
      ;(app._instance.props as Record<string, unknown>)[name] = value
    },
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
  Reflect.deleteProperty(window, 'milksu')
})

describe('ChatComposer', () => {
  it('keeps permission and model visible while moving task additions behind one plus menu', async () => {
    const { host } = mountComposer()
    await nextTick()

    expect(host.querySelectorAll('[aria-label="Coding 执行模式"]')).toHaveLength(0)
    expect(host.querySelectorAll('[aria-label="Coding 权限策略"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="选择本任务模型"]')).toHaveLength(1)
    expect(host.querySelector('[aria-label="添加内容与工具"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="消息"]')?.getAttribute('data-placeholder') ?? '')
      .toBe('描述你想让 MilkSU 完成的任务')
    expect(host.querySelector('[aria-label="消息"]')?.hasAttribute('aria-controls')).toBe(false)
    expect(host.textContent).not.toContain('架构图')
    expect(host.textContent).not.toContain('能力')
    expect(host.textContent).not.toContain('目标')
  })

  it('keeps the two bottom choosers on one hover language and shows full approval labels', async () => {
    const { host } = mountComposer()
    await nextTick()

    const permission = host.querySelector('[aria-label="Coding 权限策略"]')
    const model = host.querySelector('[aria-label="选择本任务模型"]')
    expect(permission?.className).toContain('composer-control')
    expect(permission?.className).toContain('composer-permission')
    expect(model?.className).toContain('composer-control')
    expect(model?.className).toContain('composer-model')
    expect(permission?.textContent ?? '').toContain('替我审批')
    expect(permission?.textContent ?? '').not.toContain('替我…')
    expect(permission?.getAttribute('title')).toBe('替我审批')

    expect(composerControlsSource).toContain('background-color: var(--btn-ghost-hover) !important;')
    expect(composerControlsSource).toMatch(/(?:^|\n)\.composer-permission \{[\s\S]*?\n\s*width: fit-content;/)
    expect(composerControlsSource).not.toContain('min-width: 7.75rem;')
    expect(composerControlsSource).not.toContain('min-width: 7.5rem;')
    expect(composerControlsSource).toContain('.composer-permission__label')
    expect(composerControlsSource).toContain('overflow: visible')
    expect(composerControlsSource).toContain('.composer-model {')
    expect(composerControlsSource).toContain('width: fit-content;')
    expect(composerControlsSource).toContain('flex: 0 1 auto;')
    expect(composerControlsSource).toContain('margin-left: auto;')
    expect(composerControlsSource).not.toContain('flex: 1 1 12rem;')
    // Closed trigger and every option show a keyword-matched vendor mark.
    expect(composerControlsSource).toContain('ModelVendorIcon')
    expect(composerControlsSource).toContain('triggerModelText')
    expect(composerControlsSource).not.toContain('aria-label="Coding 执行模式"')
    expect(composerControlsSource).not.toMatch(/\.composer-mode\s*\{/)
    expect(composerControlsSource).not.toMatch(/(?:^|\n)\.composer-permission \{[\s\S]*?\n\s*width: 7\.5rem;/)
  })

  it('submits a goal without exposing goal controls in the Composer', async () => {
    const result = mountComposer({ goalMode: true })
    await nextTick()

    const textarea = composerEditor(result.host)
    setComposerText(textarea, '完成发布回归')
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

    const textarea = composerEditor(result.host)
    setComposerText(textarea, '/')
    await nextTick()

    const menu = result.host.querySelector('[role="listbox"][aria-label="斜杠命令"]')
    const goal = result.host.querySelector<HTMLButtonElement>(
      '#coding-slash-command-goal[role="option"]',
    )
    expect(menu).not.toBeNull()
    expect(goal?.textContent).toContain('目标')
    expect(goal?.textContent).toContain('设置一个持续追踪的目标')
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
    expect(textarea.textContent).toBe('')
    expect(textarea.getAttribute('aria-expanded')).toBe('false')
    expect(textarea.hasAttribute('aria-controls')).toBe(false)
  })

  it('offers common Coding Agent commands as thin actions over current product capabilities', async () => {
    const result = mountComposer({ workspaceReady: true })
    await nextTick()
    const textarea = composerEditor(result.host)
    setComposerText(textarea, '/')
    await nextTick()

    const commandIds = [...result.host.querySelectorAll('[role="option"]')]
      .map(option => option.id.replace('coding-slash-command-', ''))
    expect(commandIds).toEqual([
      'goal',
      'new',
      'plan',
      'understand',
      'test',
      'review',
      'fix',
      'summary',
      'compact',
      'model',
      'permissions',
      'status',
      'diff',
      'mcp',
      'browser-use',
      'computer-use',
    ])
    // Product task actions live only in the slash menu (no sidebar duplicate).
    expect(new Set(commandIds).size).toBe(commandIds.length)
    expect(commandIds.filter(id => id === 'review')).toHaveLength(1)

    // Arrow to "plan" (index 2) and activate it.
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(result.executionModes).toEqual(['plan'])
    expect(result.slashCommandActions).toEqual([])
    expect(textarea.textContent).toBe('')

  })

  it('exposes task state, browsers, reviewed Skills, MCP, and Computer Use from plus', async () => {
    const result = mountComposer({
      workspaceReady: true,
      availableSkills: [
        'frontend-visual-qa',
        'product-design',
        'archify',
        'custom-reviewed',
      ],
      selectedMcpServers: ['github'],
    })
    await nextTick()

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    expect(document.body.textContent).toContain('本机文件或图片')
    expect(document.body.textContent).toContain('项目目录')
    expect(document.body.textContent).toContain('选择后以只读附件交给 Agent')
    expect(document.body.textContent).toContain('目标')
    expect(document.body.textContent).toContain('计划模式')
    expect(document.body.textContent).toContain('浏览器')
    expect(document.body.textContent).toContain('Browser Use')
    expect(document.body.textContent).toContain('Computer Use')
    expect(document.body.textContent).toContain('前端视觉验收')
    expect(document.body.textContent).toContain('产品设计')
    expect(document.body.textContent).toContain('架构图')
    expect(document.body.textContent).toContain('custom-reviewed')
    expect(document.body.textContent).toContain('项目 MCP')
    expect(document.body.textContent).toContain('1 个已接入：github')

    const sandboxBrowserItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('浏览器'))
    sandboxBrowserItem?.click()
    await nextTick()
    expect(result.slashCommandActions).toEqual(['browser'])

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const planItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('计划模式'))
    planItem?.click()
    await nextTick()
    expect(result.executionModes).toEqual(['plan'])

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const browserItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('Browser Use'))
    browserItem?.click()
    await nextTick()
    expect(composerEditor(result.host).querySelector('[data-composer-scope-token="browser-use"]'))
      .not.toBeNull()

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const computerUseItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('Computer Use'))
    computerUseItem?.click()
    await nextTick()
    expect(composerEditor(result.host).querySelector('[data-composer-scope-token="computer-use"]'))
      .not.toBeNull()
    expect(result.slashCommandActions).toEqual(['browser', 'browser-use', 'computer-use'])

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const mcpItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('项目 MCP'))
    mcpItem?.click()
    await nextTick()
    expect(result.slashCommandActions).toEqual(['browser', 'browser-use', 'computer-use', 'mcp'])
  })

  it('imports pasted files as an ordered attachment rail with preview and removal', async () => {
    const first = {
      id: 'a'.repeat(64), name: 'first.png', mediaType: 'image/png', size: 8,
      sha256: 'a'.repeat(64),
    }
    const second = {
      id: 'b'.repeat(64), name: 'notes.txt', mediaType: 'text/plain', size: 5,
      sha256: 'b'.repeat(64),
    }
    const invoke = vi.fn(async (method: string) => {
      if (method === 'ImportCodingAttachments') return [first, second]
      if (method === 'PreviewCodingAttachment') return {
        name: first.name,
        mediaType: first.mediaType,
        size: first.size,
        kind: 'image',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      }
      return []
    })
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: { invoke },
    })
    const result = mountComposer()
    await nextTick()
    const editor = composerEditor(result.host)
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [
          new File(['image'], 'first.png', { type: 'image/png' }),
          new File(['notes'], 'notes.txt', { type: 'text/plain' }),
        ],
        getData: () => '',
      },
    })
    editor.dispatchEvent(paste)
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'ImportCodingAttachments',
        [expect.any(Array)],
      )
    })
    await nextTick()

    const rail = result.host.querySelector('[aria-label="待发送附件"]')
    expect(paste.defaultPrevented).toBe(true)
    expect(rail?.textContent).toContain('first.png')
    expect(rail?.textContent).toContain('notes.txt')
    expect(rail?.textContent?.indexOf('first.png')).toBeLessThan(
      rail?.textContent?.indexOf('notes.txt') ?? -1,
    )
    expect(invoke).toHaveBeenCalledWith('ImportCodingAttachments', [expect.arrayContaining([
      expect.objectContaining({ name: 'first.png', mediaType: 'image/png' }),
      expect.objectContaining({ name: 'notes.txt', mediaType: 'text/plain' }),
    ])])

    result.host.querySelector<HTMLButtonElement>('[aria-label="预览 first.png"]')?.click()
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('PreviewCodingAttachment', [first])
    })
    await vi.waitFor(() => {
      expect(result.host.querySelector<HTMLImageElement>('img[alt="first.png"]')?.src)
        .toContain('data:image/png;base64,aW1hZ2U=')
    })

    result.host.querySelector<HTMLButtonElement>('[aria-label="移除 first.png"]')?.click()
    await nextTick()
    expect(rail?.textContent).not.toContain('first.png')
    expect(rail?.textContent).toContain('notes.txt')
  })

  it('makes the whole local attachment menu row invoke the native chooser', async () => {
    const invoke = vi.fn(async () => [])
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: { invoke },
    })
    const result = mountComposer()
    await nextTick()
    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(value => value.textContent?.includes('本机文件或图片'))
    item?.click()
    await nextTick()
    expect(invoke).toHaveBeenCalledWith('ChooseCodingAttachments', [])
  })

  it('does not add a second workspace-authorization layer after cwd is fixed', async () => {
    const chosen: unknown[][] = []
    const result = mountComposer({
      workspaceLocked: true,
      onChooseWorkspace: (...args: unknown[]) => chosen.push(args),
    })
    await nextTick()

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const directoryItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('其他项目目录'))
    expect(directoryItem).toBeUndefined()
    expect(chosen).toHaveLength(0)
  })

  it('adds a reviewed Pi Skill to the draft and expands it only when the user sends', async () => {
    const result = mountComposer({
      workspaceReady: true,
      availableSkills: ['frontend-visual-qa'],
    })
    await nextTick()

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()
    const skillItem = [...document.querySelectorAll<HTMLDivElement>('[role="menuitem"]')]
      .find(item => item.textContent?.includes('前端视觉验收'))
    skillItem?.click()
    await nextTick()

    const editor = composerEditor(result.host)
    expect(editor.querySelector('[data-composer-skill-token="frontend-visual-qa"]'))
      .not.toBeNull()
    expect(result.sent).toEqual([])
    expect(result.slashCommandActions).toEqual([])

    editor.append(document.createTextNode('检查设置页的窄屏布局'))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([[
      '/skill:frontend-visual-qa 检查设置页的窄屏布局',
      '使用 前端视觉验收\n检查设置页的窄屏布局',
      [],
    ]])
    expect(editor.querySelector('[data-composer-skill-token]')).toBeNull()
  })

  it('does not offer a disabled reviewed Skill in the composer menu', async () => {
    const result = mountComposer({
      workspaceReady: true,
      availableSkills: ['integrate-api'],
    })
    await nextTick()

    result.host.querySelector<HTMLButtonElement>('[aria-label="添加内容与工具"]')?.click()
    await nextTick()

    expect(document.body.textContent).toContain('API 集成')
    expect(document.body.textContent).not.toContain('产品设计')
  })

  it('filters slash commands and emits an existing product action instead of sending command text', async () => {
    const result = mountComposer({ workspaceReady: true })
    await nextTick()
    const textarea = composerEditor(result.host)
    setComposerText(textarea, '/diff')
    await nextTick()

    const options = result.host.querySelectorAll('[role="option"]')
    expect([...options].map(option => option.id)).toContain('coding-slash-command-diff')
    expect(options[0]?.id).toBe('coding-slash-command-diff')

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(result.slashCommandActions).toEqual(['diff'])
    expect(result.sent).toEqual([])
  })

  it('turns Browser Use and Computer Use into removable inline input state', async () => {
    const result = mountComposer({ workspaceReady: true, browserUseReady: true })
    await nextTick()
    const editor = composerEditor(result.host)
    setComposerText(editor, '请帮我 /browser-use')
    await nextTick()

    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    const token = editor.querySelector<HTMLElement>('[data-composer-scope-token="browser-use"]')
    expect(token).not.toBeNull()
    expect(token?.textContent).toContain('Browser Use')
    expect(result.slashCommandActions).toEqual(['browser-use'])
    expect(result.sent).toEqual([])

    editor.append(document.createTextNode('看看这个页面'))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([
      ['请帮我 看看这个页面', '请帮我 看看这个页面', [], 'browser-use'],
    ])
    expect(editor.querySelector('[data-composer-scope-token]')).toBeNull()

    setComposerText(editor, '/computer-use')
    await nextTick()
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    const remove = editor.querySelector<HTMLButtonElement>('[aria-label="移除 /computer-use"]')
    expect(remove).not.toBeNull()
    remove?.click()
    await nextTick()
    expect(editor.querySelector('[data-composer-scope-token]')).toBeNull()
  })

  it('does not send an unlocked Scope and clears stale Scope after keyboard deletion', async () => {
    const blocked = mountComposer({ workspaceReady: true })
    await nextTick()
    const blockedEditor = composerEditor(blocked.host)
    setComposerText(blockedEditor, '/browser-use')
    blockedEditor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    blockedEditor.append(document.createTextNode('检查这个页面'))
    blockedEditor.dispatchEvent(new Event('input', { bubbles: true }))
    blocked.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(blocked.sent).toEqual([])
    expect(blockedEditor.textContent).toContain('检查这个页面')
    expect(blocked.host.textContent).toContain('Browser Use 需要已选项目')

    const deleted = mountComposer({ workspaceReady: true, browserUseReady: true })
    await nextTick()
    const deletedEditor = composerEditor(deleted.host)
    setComposerText(deletedEditor, '/browser-use')
    deletedEditor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    deletedEditor.querySelector('[data-composer-scope-token]')?.remove()
    deletedEditor.append(document.createTextNode('普通消息'))
    deletedEditor.dispatchEvent(new Event('input', { bubbles: true }))
    deleted.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()
    expect(deleted.sent).toEqual([['普通消息', '普通消息', []]])
  })

  it('keeps a Computer Use submission and sends it after automatic activation completes', async () => {
    const result = mountComposer({ computerUseReady: false })
    await nextTick()
    const editor = composerEditor(result.host)
    setComposerText(editor, '/computer-use')
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }))
    await nextTick()
    editor.append(document.createTextNode('检查这个窗口'))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([])
    expect(editor.textContent).toContain('检查这个窗口')
    expect(result.slashCommandActions).toEqual(['computer-use', 'computer-use'])

    result.setProp('computerUseReady', true)
    await nextTick()
    await nextTick()

    expect(result.sent).toEqual([
      ['检查这个窗口', '检查这个窗口', [], 'computer-use'],
    ])
    expect(editor.textContent).toBe('')
  })

  it('dismisses the slash menu with Escape and disables a second active goal', async () => {
    const dismissed = mountComposer()
    await nextTick()
    const textarea = composerEditor(dismissed.host)
    setComposerText(textarea, '/')
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(dismissed.host.querySelector('[role="listbox"]')).toBeNull()
    expect(textarea.textContent).toBe('/')

    const existing = mountComposer({ goal: activeGoal })
    await nextTick()
    const existingTextarea = composerEditor(existing.host)
    setComposerText(existingTextarea, '/')
    await nextTick()
    const disabledGoal = existing.host.querySelector<HTMLButtonElement>(
      '#coding-slash-command-goal',
    )
    expect(disabledGoal?.disabled).toBe(true)
    expect(disabledGoal?.getAttribute('aria-disabled')).toBe('true')
    expect(disabledGoal?.textContent).toContain('当前已有持续目标')
  })

  it('does not render the goal chip when only Git progress exists without a goal', async () => {
    const result = mountComposer({
      gitSummary: {
        changedFiles: 3,
        additions: 10,
        deletions: 2,
        changes: [],
      },
    })
    await nextTick()

    expect(result.host.querySelector('[aria-label="持续目标"]')).toBeNull()
    expect(result.host.querySelector('[aria-label="任务进度摘要"]')).not.toBeNull()
    expect(result.host.querySelector('[aria-label="任务进度摘要"]')?.textContent)
      .toContain('代码')
  })

  it('closes the goal popover with Escape from keyboard focus and with outside pointer clicks', async () => {
    const result = mountComposer({ goal: activeGoal })
    await nextTick()

    const chip = result.host.querySelector<HTMLButtonElement>('.chat-composer__chip--goal')
    const panel = result.host.querySelector<HTMLElement>('.chat-composer__goal-panel')
    expect(chip).not.toBeNull()
    expect(panel?.style.display).toBe('none')

    chip?.focus()
    chip?.click()
    await nextTick()
    expect(panel?.style.display).not.toBe('none')

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(panel?.style.display).toBe('none')

    chip?.click()
    await nextTick()
    expect(panel?.style.display).not.toBe('none')

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(panel?.style.display).toBe('none')
  })

  it('collapses the goal chip to an icon and lets the progress pill shrink in narrow containers', () => {
    const source = composerSource.replace(/\r\n/g, '\n')
    const narrowBlockStart = source.indexOf('@container chat-main (max-width: 36rem)')
    expect(narrowBlockStart).toBeGreaterThan(-1)
    const narrowBlock = source.slice(narrowBlockStart)

    expect(narrowBlock).toContain('.chat-composer__chip--goal {\n    width: 2rem;')
    expect(narrowBlock).toContain(
      '.chat-composer__chip--goal .chat-composer__chip__label,\n'
      + '  .chat-composer__chip--goal .chat-composer__chip__chevron {\n'
      + '    display: none;\n  }',
    )
    expect(narrowBlock).toContain('.chat-composer__progress-pill {\n    min-width: 0;')
  })

  it('projects real goal and Git status above the composer with goal controls', async () => {
    const active = mountComposer({
      goal: activeGoal,
      gitSummary: {
        changedFiles: 22,
        additions: 442,
        deletions: 226,
        changes: [{
          path: 'app/src/components-vue/ChatComposer.vue',
          indexStatus: ' ',
          worktreeStatus: 'M',
          staged: false,
          modified: true,
          untracked: false,
          conflict: false,
          additions: 18,
          deletions: 4,
        }],
      },
    })
    await nextTick()

    const progress = active.host.querySelector('[aria-label="任务进度摘要"]')
    const goalPanel = active.host.querySelector('[aria-label="持续目标"]')
    expect(progress?.textContent).toContain('第 4 轮')
    expect(progress?.textContent).toContain('代码')
    expect(progress?.textContent).toContain('+442')
    expect(progress?.textContent).toContain('-226')
    const changeTrigger = active.host.querySelector<HTMLButtonElement>('[aria-label="查看代码变更"]')
    changeTrigger?.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }))
    await new Promise(resolve => window.setTimeout(resolve, 160))
    await nextTick()
    const fileAction = document.querySelector<HTMLButtonElement>(
      '[aria-label="在变更中打开 app/src/components-vue/ChatComposer.vue"]',
    )
    expect(fileAction?.textContent).toContain('+18')
    expect(fileAction?.textContent).toContain('-4')
    fileAction?.click()
    changeTrigger?.click()
    expect(active.openedChanges()).toEqual([
      'app/src/components-vue/ChatComposer.vue',
      undefined,
    ])
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

    result.vm.appendDraftText('参考上文：CVE 同步失败曾由缓存过期导致。')
    await nextTick()

    const textarea = composerEditor(result.host)
    expect(textarea.textContent).toContain('参考上文')

    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([
      ['参考上文：CVE 同步失败曾由缓存过期导致。', '参考上文：CVE 同步失败曾由缓存过期导致。', []],
    ])
  })

  it('does not submit Enter while the user is confirming IME composition', async () => {
    const result = mountComposer()
    await nextTick()

    const textarea = composerEditor(result.host)
    setComposerText(textarea, 'milksu')
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    }))
    await nextTick()

    expect(result.sent).toEqual([])
    expect(textarea.textContent).toBe('milksu')

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
    const textarea = composerEditor(host)
    setComposerText(textarea, '/')
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

  it('sends text as Pi guidance while a turn is running and shows its queue', async () => {
    const running = mountComposer({
      running: true,
      queuedGuidance: ['先保留当前修改，再检查失败测试。'],
    })
    await nextTick()

    expect(running.host.querySelector('[aria-label="待应用引导"]')?.textContent)
      .toContain('当前工具调用结束后应用')
    const editor = composerEditor(running.host)
    setComposerText(editor, '不要改 API，先补回归测试。')
    await nextTick()

    expect(running.host.querySelector('[aria-label="停止 Agent"]')).toBeNull()
    const guide = running.host.querySelector<HTMLButtonElement>('[aria-label="发送引导"]')
    expect(guide).not.toBeNull()
    guide?.click()
    await nextTick()

    expect(running.sent).toEqual([[
      '不要改 API，先补回归测试。',
      '不要改 API，先补回归测试。',
      [],
    ]])
    expect(editor.textContent).toBe('')
  })

  it('offers separate retract and retract-for-edit actions for each queued message', async () => {
    const running = mountComposer({
      running: true,
      queuedGuidance: ['先保留当前修改。', '再检查失败测试。'],
    })
    await nextTick()

    const edit = running.host.querySelector<HTMLButtonElement>(
      '[aria-label="编辑排队消息 1"]',
    )
    const cancel = running.host.querySelector<HTMLButtonElement>(
      '[aria-label="撤回排队消息 2"]',
    )
    expect(edit?.title).toBe('撤回并编辑')
    expect(cancel?.title).toBe('撤回')

    edit?.click()
    cancel?.click()
    expect(running.editedGuidance).toEqual([0])
    expect(running.cancelledGuidance).toEqual([1])
  })

  it('restores withdrawn guidance into the composer during an active turn', async () => {
    const running = mountComposer({ running: true })
    await nextTick()

    running.vm.appendDraftText('改完这一条再重新排队。')
    await nextTick()

    expect(composerEditor(running.host).textContent).toBe('改完这一条再重新排队。')
  })
})
