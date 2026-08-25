// @vitest-environment jsdom

import { createApp, nextTick, reactive, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatActivityGroup from './ChatActivityGroup.vue'
import {
  chatActivityOpenEntryIds,
  createChatActivityExpansionState,
  setChatActivityEntryOpen,
  type ChatActivityExpansionState,
} from '@/lib/chatActivityExpansion'
import type { ChatActivityBlock } from '@/lib/chatActivity'
import type { Message } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
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

async function settleToggle() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await nextTick()
}

function mountControlledGroup(activity: ChatActivityBlock) {
  const expansion = ref<ChatActivityExpansionState>(createChatActivityExpansionState())
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { ChatActivityGroup },
    setup: () => ({
      activity,
      expansion,
      openEntries: (activityId: string) => chatActivityOpenEntryIds(expansion.value, activityId),
      toggleEntry(activityId: string, entryId: string, open: boolean) {
        expansion.value = setChatActivityEntryOpen(expansion.value, activityId, entryId, open)
      },
    }),
    template: `<ChatActivityGroup
      :activity="activity"
      :open="false"
      :open-entry-ids="openEntries(activity.id)"
      @toggle-entry="(entryId, open) => toggleEntry(activity.id, entryId, open)"
    />`,
  })
  app.mount(host)
  mountedApps.push(app)
  return { host, expansion }
}

describe('ChatActivityGroup', () => {
  it('shows tool chips without expanding and keeps them when later tools arrive', async () => {
    const activity = reactive<ChatActivityBlock>({
      kind: 'activity',
      id: 'activity:t1',
      running: true,
      messages: [tool('t1', '打开首页', { status: 'running', toolCallId: 'call-1' })],
    })
    const { host } = mountControlledGroup(activity)
    await nextTick()

    expect(host.querySelector('.agent-chip')).not.toBeNull()
    expect(host.textContent).toContain('打开首页')
    expect(host.querySelector('.ak-loading')).not.toBeNull()

    activity.messages = [
      tool('t1', '打开首页', { toolCallId: 'call-1' }),
      tool('t1-result', 'ok', { toolCallId: 'call-1' }),
      tool('t2', '点击播放', { status: 'running', toolCallId: 'call-2' }),
    ]
    activity.running = true
    await nextTick()

    expect(host.textContent).toContain('点击播放')
    expect(host.textContent).not.toContain('打开首页')
    expect(host.querySelectorAll('.tool-activity-entry').length).toBe(1)
  })

  it('keeps a manually collapsed entry collapsed while results stream in', async () => {
    const activity = reactive<ChatActivityBlock>({
      kind: 'activity',
      id: 'activity:t1',
      running: true,
      messages: [tool('t1', '打开首页', { status: 'running', toolCallId: 'call-1' })],
    })
    const { host } = mountControlledGroup(activity)
    await nextTick()

    const entry = host.querySelector<HTMLDetailsElement>('.tool-activity-entry')
    entry?.querySelector('summary')?.click()
    await settleToggle()
    entry?.querySelector('summary')?.click()
    await settleToggle()
    expect(entry?.open).toBe(false)

    activity.messages = [
      tool('t1', '打开首页', { toolCallId: 'call-1' }),
      tool('t1-result', 'ok', { toolCallId: 'call-1' }),
    ]
    activity.running = false
    await nextTick()

    expect(host.querySelector('.tool-activity-entry')).toBeNull()
  })

  it('keeps an expanded tool entry open and restores it after remount', async () => {
    const activity = reactive<ChatActivityBlock>({
      kind: 'activity',
      id: 'activity:t1',
      running: true,
      messages: [
        tool('t1', '打开首页', { toolCallId: 'call-1', status: 'running' }),
      ],
    })
    const { host, expansion } = mountControlledGroup(activity)
    await nextTick()

    const entry = host.querySelector<HTMLDetailsElement>('.tool-activity-entry')
    entry?.querySelector('summary')?.click()
    await settleToggle()
    expect(entry?.open).toBe(true)

    activity.messages = [
      tool('t1', '打开首页', { toolCallId: 'call-1' }),
      tool('t1-result', 'ok', { toolCallId: 'call-1' }),
    ]
    activity.running = false
    await nextTick()
    expect(host.querySelector<HTMLDetailsElement>('.tool-activity-entry')?.open).toBe(true)
    expect(host.textContent).toContain('ok')

    const savedExpansion = expansion.value
    for (const app of mountedApps.splice(0)) app.unmount()
    host.remove()
    const rebuilt = mountControlledGroup(activity)
    rebuilt.expansion.value = savedExpansion
    await nextTick()
    await nextTick()

    const rebuiltEntry = rebuilt.host.querySelector<HTMLDetailsElement>('.tool-activity-entry')
    expect(rebuiltEntry?.open).toBe(true)
    expect(rebuilt.host.textContent).toContain('ok')
  })

  it('reveals the expanded entry with a local scroll into view', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const activity = reactive<ChatActivityBlock>({
      kind: 'activity',
      id: 'activity:t1',
      running: true,
      messages: [
        tool('t1', '打开首页', { toolCallId: 'call-1', status: 'running' }),
      ],
    })
    const { host } = mountControlledGroup(activity)
    await nextTick()

    host.querySelector<HTMLDetailsElement>('.tool-activity-entry')?.querySelector('summary')?.click()
    await settleToggle()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

    scrollIntoView.mockClear()
    host.querySelector<HTMLDetailsElement>('.tool-activity-entry')?.querySelector('summary')?.click()
    await settleToggle()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
