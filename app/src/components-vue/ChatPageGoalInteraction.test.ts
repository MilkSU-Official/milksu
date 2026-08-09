// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodingGoalState, Conversation } from '@/types'
import ChatPage from './ChatPage.vue'

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error('desktop runtime unavailable in component test')
  }),
}))

const mountedApps: App[] = []

const activeGoal: CodingGoalState = {
  id: 'goal-1',
  text: '让 MilkSU 完成一次可审查的自举迭代',
  status: 'active',
  startedAt: 1,
  updatedAt: 2,
  iteration: 2,
  tokensUsed: 8_000,
  timeUsedSeconds: 180,
  automaticModelTurns: 2,
  queuedCount: 0,
}

function conversation(goal?: CodingGoalState): Conversation {
  return {
    id: 'conversation-1',
    title: 'Goal interaction',
    createdAt: 1,
    agentGoal: goal,
    messages: [],
  }
}

function mountPage(options: {
  goal?: CodingGoalState
  running?: boolean
} = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const controlledGoals: string[] = []
  let aborts = 0
  const app = createApp(ChatPage, {
    conversation: conversation(options.goal),
    settings: null,
    workspacePath: '',
    running: options.running ?? false,
    aborting: false,
    sessionReady: false,
    resumed: false,
    compacting: false,
    ctfSession: false,
    ensureConversation: () => 'conversation-1',
    onControlGoal: (action: string) => controlledGoals.push(action),
    onAbort: () => {
      aborts += 1
    },
  })
  app.mount(host)
  mountedApps.push(app)
  return {
    host,
    controlledGoals,
    aborts: () => aborts,
  }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('ChatPage Goal interaction', () => {
  it('enters existing goalMode from the Composer slash menu and has no sidebar goal entry', async () => {
    const result = mountPage()
    await nextTick()

    expect(result.host.querySelector('[aria-label="环境信息"]')?.textContent)
      .not.toContain('设为目标')
    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    if (!textarea) throw new Error('missing message textarea')
    textarea.value = '/'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(result.host.querySelector('[aria-label="斜杠命令"]')).not.toBeNull()

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(textarea.placeholder).toContain('写下一个可持续目标')
    expect(document.activeElement).toBe(textarea)
    expect(result.host.querySelector('[aria-label="持续目标"]')?.textContent)
      .toContain('下一条消息会成为持续目标')
  })

  it('uses interruption to pause a running Goal and Pi commands when it is idle', async () => {
    const running = mountPage({ goal: activeGoal, running: true })
    await nextTick()
    running.host.querySelector<HTMLButtonElement>('[aria-label="暂停目标"]')?.click()
    expect(running.aborts()).toBe(1)
    expect(running.controlledGoals).toEqual([])

    const paused = mountPage({
      goal: { ...activeGoal, status: 'paused' },
      running: false,
    })
    await nextTick()
    paused.host.querySelector<HTMLButtonElement>('[aria-label="继续目标"]')?.click()
    paused.host.querySelector<HTMLButtonElement>('[aria-label="清除当前目标"]')?.click()
    expect(paused.controlledGoals).toEqual(['resume', 'clear'])
  })
})
