// @vitest-environment jsdom
// 回归测试：侧栏状态位五选一、严格互斥（待决策 > 运行中 > 后台任务 > 红叉 > 未读）。
// 守的是 β.166 之后的真机反馈：后台任务蓝格子曾和未读小圆点并排糊在一起；
// 红叉曾压过"正在跑"，让人以为任务停了。这里用真实 AppSidebar 渲染取证。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useUiLocale', () => ({
  useT: () => (zh: string) => zh,
  useUiLocale: () => 'zh',
}))
vi.mock('@/desktop', () => ({ invokeCommand: vi.fn(async () => null) }))
// 运行中的九格 loader 换成好断言的壳；决策/后台/未读三类标记用真组件。
vi.mock('@/components/AgentPixelLoader', async () => {
  const React = await import('react')
  return { default: () => React.createElement('span', { 'data-testid': 'agent-pixel-loader' }) }
})

import AppSidebar from '@/components/AppSidebar'
import type { Conversation, Message } from '@/types'

function conversation(overrides: Partial<Conversation> & { id: string }): Conversation {
  return { title: overrides.id, createdAt: 1_700_000_000_000, messages: [], ...overrides }
}

const TASK = conversation({ id: 'c-task', title: '直属任务' })

function askMessage(): Message {
  return {
    id: 'm-ask',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolName: 'milksu_ask',
    approvalRequestId: 'req-1',
    approvalState: 'pending',
  }
}

function baseProps(): ComponentProps<typeof AppSidebar> {
  return {
    activeSection: 'chat',
    activeConversationId: null,
    conversations: [TASK],
    accountStatus: { configured: true, authenticated: true, state: 'active' },
    themeMode: 'light',
    codingContextOpen: true,
  }
}

let root: Root
let host: HTMLElement

function row(title: string) {
  const rows = [...document.querySelectorAll('.agent-sidebar-item')]
  const el = rows.find(item => item.textContent?.includes(title))
  if (!el) throw new Error(`没有找到行：${title}`)
  return el as HTMLElement
}

async function renderSidebar(props: Partial<ComponentProps<typeof AppSidebar>>) {
  await act(async () => {
    root.render(<AppSidebar {...baseProps()} {...props} />)
  })
}

beforeEach(() => {
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('侧栏状态位互斥', () => {
  it('后台任务收编进状态位：只在没有待决策/运行中时亮，且不再并排', async () => {
    await renderSidebar({ backgroundTasks: { 'c-task': [{ id: 't1' }] } })
    const taskRow = row(TASK.title)
    // 就在状态位里。
    expect(taskRow.querySelectorAll('.coding-session-status .agent-pixel--bg-task')).toHaveLength(1)
    // 整行只有一个后台标记（旧的并排渲染已删）。
    expect(taskRow.querySelectorAll('.agent-pixel--bg-task')).toHaveLength(1)
  })

  it('运行中压过后台任务与红叉', async () => {
    await renderSidebar({
      runningConversationIds: ['c-task'],
      problemConversationIds: ['c-task'],
      backgroundTasks: { 'c-task': [{ id: 't1' }] },
    })
    const taskRow = row(TASK.title)
    expect(taskRow.querySelector('[data-testid="agent-pixel-loader"]')).toBeTruthy()
    expect(taskRow.querySelector('.agent-pixel--bg-task')).toBeNull()
    expect(taskRow.querySelector('.agent-pixel--problem')).toBeNull()
  })

  it('后台任务压过红叉', async () => {
    await renderSidebar({
      problemConversationIds: ['c-task'],
      backgroundTasks: { 'c-task': [{ id: 't1' }] },
    })
    const taskRow = row(TASK.title)
    expect(taskRow.querySelector('.agent-pixel--bg-task')).toBeTruthy()
    expect(taskRow.querySelector('.agent-pixel--problem')).toBeNull()
  })

  it('待决策压过运行中', async () => {
    const asking = conversation({ id: 'c-task', title: '直属任务', messages: [askMessage()] })
    await act(async () => {
      root.render(
        <AppSidebar
          {...baseProps()}
          conversations={[asking]}
          runningConversationIds={['c-task']}
        />,
      )
    })
    const taskRow = row('直属任务')
    expect(taskRow.querySelector('.agent-pixel--decision')).toBeTruthy()
    expect(taskRow.querySelector('[data-testid="agent-pixel-loader"]')).toBeNull()
  })

  it('红叉只在一切静止时亮：running=true 时 problem=true 不显示红叉', async () => {
    await renderSidebar({ runningConversationIds: ['c-task'], problemConversationIds: ['c-task'] })
    expect(row(TASK.title).querySelector('.agent-pixel--problem')).toBeNull()
    // 同一会话停下来、一切静止后，红叉才亮（未读也压不过它）。
    await renderSidebar({ problemConversationIds: ['c-task'] })
    expect(row(TASK.title).querySelector('.agent-pixel--problem')).toBeTruthy()
    expect(row(TASK.title).querySelector('.agent-pixel__cell--unread')).toBeNull()
  })
})

describe('未读方形白点形态', () => {
  it('运行→静止后是一个方形白点：DOM 里只有这一个方块，没有网格/空位，旧圆点没了', async () => {
    await renderSidebar({ runningConversationIds: ['c-task'] })
    await renderSidebar({ runningConversationIds: [] })

    const taskRow = row(TASK.title)
    const mark = taskRow.querySelector('.agent-pixel__cell--unread') as HTMLElement
    expect(mark).toBeTruthy()
    // 复用九格单格的样式 token（尺寸/圆角）——但它本身不是九格网格。
    expect(mark.classList.contains('agent-pixel__cell')).toBe(true)
    expect(mark.classList.contains('agent-pixel')).toBe(false)
    expect(mark.getAttribute('role')).toBe('status')
    expect(mark.getAttribute('aria-label')).toBe('有新消息')
    // DOM 里只有这一个方块：状态位内没有 3×3 网格、没有周围 8 个空位。
    const status = taskRow.querySelector('.coding-session-status') as HTMLElement
    expect(status.children).toHaveLength(1)
    expect(status.children[0]).toBe(mark)
    expect(taskRow.querySelectorAll('.agent-pixel')).toHaveLength(0)
    expect(taskRow.querySelectorAll('.agent-pixel__cell--hole')).toHaveLength(0)
    // 旧的小圆点必须消失。
    expect(taskRow.querySelector('.coding-session-complete')).toBeNull()
  })

  it('未读方块复用单格尺寸与圆角，颜色走主题 primary、静止不动画', () => {
    const rawCss = readFileSync(resolve(process.cwd(), 'src/styles/agent-conversation.css'), 'utf8')
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const ruleBody = (selector: string) => {
      const start = css.indexOf(selector)
      if (start < 0) return ''
      const open = css.indexOf('{', start)
      const close = css.indexOf('}', open)
      return open < 0 || close < 0 ? '' : css.slice(open + 1, close)
    }
    // 尺寸/圆角来自九格单格 token（复用，不在未读规则里另写）。
    const base = ruleBody('.agent-pixel__cell {')
    expect(base).toContain('width: 4px')
    expect(base).toContain('height: 4px')
    expect(base).toContain('border-radius: 1px')
    const cell = ruleBody('.agent-pixel__cell--unread {')
    expect(cell).toContain('background: var(--primary)')
    expect(cell).toContain('animation: none')
    expect(cell).toContain('opacity: 1')
  })
})
