// @vitest-environment jsdom

import { createApp, nextTick, reactive, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChatActivityGroup from './ChatActivityGroup.vue'
import type { ChatActivityBlock } from '@/lib/chatActivity'
import type { Message } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function tool(
  id: string,
  content: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    role: 'tool',
    content,
    timestamp: 1,
    toolName: 'mcp',
    status: 'done',
    ...extra,
  }
}

describe('ChatActivityGroup', () => {
  it('keeps a user-expanded tool group open when later tools arrive', async () => {
    const activity = reactive<ChatActivityBlock>({
      kind: 'activity',
      id: 'activity:t1',
      running: true,
      messages: [tool('t1', '打开首页', { status: 'running', toolCallId: 'call-1' })],
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      components: { ChatActivityGroup },
      setup: () => ({ activity }),
      template: '<ChatActivityGroup :activity="activity" />',
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const group = host.querySelector<HTMLDetailsElement>('.tool-activity')
    expect(group?.open).toBe(false)
    group?.querySelector('summary')?.click()
    await nextTick()
    expect(group?.open).toBe(true)

    activity.messages = [
      tool('t1', '打开首页', { toolCallId: 'call-1' }),
      tool('t1-result', 'ok', { toolCallId: 'call-1' }),
      tool('t2', '点击播放', { status: 'running', toolCallId: 'call-2' }),
    ]
    activity.running = true
    await nextTick()

    expect(host.querySelector<HTMLDetailsElement>('.tool-activity')?.open).toBe(true)
    expect(host.textContent).toContain('点击播放')
  })
})
